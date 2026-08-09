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
