import { isValidDateKey } from "@/lib/attendance/domain"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import type {
  SessionAssignment,
  TrainingSessionOccurrence,
} from "@/lib/sessions/types"

type AttendanceQueryValue = string | string[] | undefined

export type PlayerAttendanceQuery = {
  date?: AttendanceQueryValue
  from?: AttendanceQueryValue
  occurrence?: AttendanceQueryValue
}

export type PlayerAttendanceSelection = {
  dateKey: string
  fromCalendar: boolean
  occurrenceId: string | null
  requiresCanonicalRedirect: boolean
}

function firstQueryValue(value: AttendanceQueryValue) {
  return Array.isArray(value) ? value[0] : value
}

export function chronologicalOccurrencesForDate(
  occurrences: TrainingSessionOccurrence[],
  dateKey: string,
) {
  return occurrences
    .filter((occurrence) => occurrence.occurrenceDate === dateKey)
    .sort((first, second) => (
      first.startsAt.localeCompare(second.startsAt)
      || first.id.localeCompare(second.id)
    ))
}

export function eligiblePlayerIdsForOccurrence({
  assignments,
  occurrence,
  players,
}: {
  assignments: SessionAssignment[]
  occurrence: TrainingSessionOccurrence
  players: Array<{ id: string; joinedOn: string }>
}) {
  return players
    .filter((player) => (
      playerWasEnrolledForOccurrence(player.joinedOn, occurrence)
      && assignments.some((assignment) => (
        assignment.playerId === player.id
        && assignmentCoversOccurrence(assignment, occurrence)
      ))
    ))
    .map((player) => player.id)
}

export type OccurrenceRosterProgress = {
  eligible: number
  marked: number
}

/**
 * How far each of a day's registers got, for the session picker.
 *
 * Counted rather than reduced to a flag on purpose. A register holding one mark
 * out of thirty is the state most worth distinguishing, and any boolean would
 * put the same reassuring word on it as on a finished one.
 *
 * Only saved marks are counted -- `records` is what the register holds, not what
 * the coach has drafted locally -- so a picker built on this never claims credit
 * for work that has not been sent.
 */
export function rosterProgressForOccurrences({
  assignments,
  occurrences,
  players,
  records,
}: {
  assignments: SessionAssignment[]
  occurrences: TrainingSessionOccurrence[]
  players: Array<{ id: string; joinedOn: string }>
  records: Record<string, Record<string, string> | undefined>
}): Map<string, OccurrenceRosterProgress> {
  return new Map(occurrences.map((occurrence) => {
    const eligible = eligiblePlayerIdsForOccurrence({ assignments, occurrence, players })
    const recorded = records[occurrence.id] ?? {}
    const marked = eligible.reduce(
      (total, playerId) => total + (recorded[playerId] ? 1 : 0),
      0,
    )
    return [occurrence.id, { eligible: eligible.length, marked }]
  }))
}

export function resolvePlayerAttendanceSelection({
  occurrences,
  query,
  today,
}: {
  occurrences: TrainingSessionOccurrence[]
  query: PlayerAttendanceQuery
  today: string
}): PlayerAttendanceSelection {
  const requestedDate = firstQueryValue(query.date)
  const requestedOccurrence = firstQueryValue(query.occurrence)
  const requestedFrom = firstQueryValue(query.from)
  const dateKey = requestedDate && isValidDateKey(requestedDate)
    ? requestedDate
    : today
  const occurrence = requestedOccurrence
    ? occurrences.find((item) => (
      item.id === requestedOccurrence && item.occurrenceDate === dateKey
    ))
    : undefined
  const fromCalendar = requestedFrom === "calendar"
  const occurrenceId = occurrence?.id ?? null
  const canonicalDate = requestedDate === dateKey
  const canonicalOccurrence = requestedOccurrence === undefined
    || requestedOccurrence === occurrenceId
  const canonicalFrom = requestedFrom === undefined || fromCalendar

  return {
    dateKey,
    fromCalendar,
    occurrenceId,
    requiresCanonicalRedirect: !canonicalDate || !canonicalOccurrence || !canonicalFrom,
  }
}

export function playerAttendanceRecordHref({
  dateKey,
  fromCalendar,
  occurrenceId,
}: Omit<PlayerAttendanceSelection, "requiresCanonicalRedirect">) {
  const query = new URLSearchParams({ date: dateKey })
  if (occurrenceId) query.set("occurrence", occurrenceId)
  if (fromCalendar) query.set("from", "calendar")
  return `/coach/attendance/players/record?${query.toString()}`
}
