import "server-only"

import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm"

import { initializeDatabase } from "@/lib/db/client"
import {
  academyHolidays,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
  sessionRecurrenceRules,
  sessionSeries,
} from "@/lib/db/schema"
import {
  compareSessionSeries,
  compareSessionSlots,
} from "@/lib/sessions/domain"
import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"
import type { AcademyHolidayRecord } from "@/lib/sessions/holiday-types"
import type {
  SessionAssignment,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

export function listSessionSeries(): TrainingSessionSeries[] {
  const db = initializeDatabase()
  const seriesRows = db.select().from(sessionSeries).orderBy(asc(sessionSeries.startsOn)).all()
  const rules = db.select().from(sessionRecurrenceRules)
    .orderBy(asc(sessionRecurrenceRules.weekday)).all()

  return seriesRows.map((series) => ({
    id: series.id,
    title: series.title,
    programme: series.programme,
    batch: series.batch,
    venue: series.venue,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    status: series.status,
    slots: rules.filter((rule) => rule.seriesId === series.id).map((rule) => ({
      id: rule.id,
      weekday: rule.weekday,
      startTime: rule.startTime,
      durationMinutes: rule.durationMinutes,
    })).sort(compareSessionSlots),
  })).sort(compareSessionSeries)
}

function occurrenceRecords(
  from: string,
  to: string,
  seriesIds?: readonly string[],
): TrainingSessionOccurrence[] {
  if (seriesIds && !seriesIds.length) return []
  const db = initializeDatabase()
  const occurrences = db.select().from(sessionOccurrences).where(and(
    gte(sessionOccurrences.occurrenceDate, from),
    lte(sessionOccurrences.occurrenceDate, to),
    seriesIds ? inArray(sessionOccurrences.seriesId, [...seriesIds]) : undefined,
  )).orderBy(asc(sessionOccurrences.startsAt), asc(sessionOccurrences.id)).all().map((occurrence) => ({
    id: occurrence.id,
    seriesId: occurrence.seriesId,
    occurrenceDate: occurrence.occurrenceDate,
    startsAt: occurrence.startsAt.toISOString(),
    durationMinutes: occurrence.durationMinutes,
    venue: occurrence.venue,
    status: occurrence.status,
    replacementForOccurrenceId: occurrence.replacementForOccurrenceId,
  }))
  return resolveOccurrenceEligibilityDates(db, occurrences)
}

/**
 * Closures overlapping a window, for surfaces that already load occurrences over
 * the same range. Kept separate from the occurrence read because the register
 * spans a whole year and a closure is one small row per date, not per session.
 */
export function listAcademyHolidaysInWindow(from: string, to: string): AcademyHolidayRecord[] {
  return initializeDatabase().select({
    dateKey: academyHolidays.dateKey,
    id: academyHolidays.id,
    label: academyHolidays.label,
  }).from(academyHolidays).where(and(
    gte(academyHolidays.dateKey, from),
    lte(academyHolidays.dateKey, to),
  )).orderBy(asc(academyHolidays.dateKey)).all()
}

export function listSessionOccurrences(from: string, to: string): TrainingSessionOccurrence[] {
  return occurrenceRecords(from, to)
}

export function listSessionOccurrencesForSeries(
  from: string,
  to: string,
  seriesIds: readonly string[],
): TrainingSessionOccurrence[] {
  return occurrenceRecords(from, to, seriesIds)
}

/**
 * The two keys a backfill confirmation counts, for occurrences that are still
 * scheduled and have already begun. The window has to reach back to the
 * academy's first session -- an assignment may be backdated to the player's
 * training start -- so what is narrowed instead is everything the caller would
 * have discarded anyway: the cancelled rows, the sessions still ahead, and the
 * five columns a count never reads. Lineage is resolved for the rest, since the
 * eligible date of a replacement is its source's.
 */
export function listStartedScheduledOccurrenceKeys(
  from: string,
  to: string,
  startedBy: Date,
): Array<Pick<TrainingSessionOccurrence, "eligibilityDate" | "seriesId">> {
  const db = initializeDatabase()
  const occurrences = db.select({
    id: sessionOccurrences.id,
    seriesId: sessionOccurrences.seriesId,
    occurrenceDate: sessionOccurrences.occurrenceDate,
    replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
  }).from(sessionOccurrences).where(and(
    gte(sessionOccurrences.occurrenceDate, from),
    lte(sessionOccurrences.occurrenceDate, to),
    lte(sessionOccurrences.startsAt, startedBy),
    eq(sessionOccurrences.status, "scheduled"),
  )).orderBy(asc(sessionOccurrences.startsAt), asc(sessionOccurrences.id)).all()

  return resolveOccurrenceEligibilityDates(db, occurrences)
    .map(({ eligibilityDate, seriesId }) => ({ eligibilityDate, seriesId }))
}

function assignmentRecords({
  playerIds,
  seriesIds,
}: {
  playerIds?: readonly string[]
  seriesIds?: readonly string[]
} = {}): SessionAssignment[] {
  if ((playerIds && !playerIds.length) || (seriesIds && !seriesIds.length)) return []
  const database = initializeDatabase()
  const rows = database.select().from(sessionAssignments)
    .where(and(
      playerIds ? inArray(sessionAssignments.accountId, [...playerIds]) : undefined,
      seriesIds ? inArray(sessionAssignments.seriesId, [...seriesIds]) : undefined,
    ))
    .orderBy(asc(sessionAssignments.effectiveFrom), asc(sessionAssignments.id)).all()
  const assignmentIds = rows.map((assignment) => assignment.id)
  const weekdays = assignmentIds.length
    ? database.select().from(sessionAssignmentWeekdays)
        .where(inArray(sessionAssignmentWeekdays.assignmentId, assignmentIds))
        .orderBy(asc(sessionAssignmentWeekdays.weekday)).all()
    : []
  const weekdaysByAssignment = weekdays.reduce<Map<string, number[]>>((map, item) => {
    const current = map.get(item.assignmentId) ?? []
    current.push(item.weekday)
    map.set(item.assignmentId, current)
    return map
  }, new Map())

  return rows.map((assignment) => ({
    id: assignment.id,
    playerId: assignment.accountId,
    seriesId: assignment.seriesId,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    weekdays: weekdaysByAssignment.get(assignment.id) ?? [],
  }))
}

export function listSessionAssignments(): SessionAssignment[] {
  return assignmentRecords()
}

export function listSessionAssignmentsForSeries(
  seriesIds: readonly string[],
): SessionAssignment[] {
  return assignmentRecords({ seriesIds })
}

export function listSessionAssignmentsForPlayers(
  playerIds: readonly string[],
): SessionAssignment[] {
  return assignmentRecords({ playerIds })
}

function attendanceRecords({
  occurrenceIds,
  playerId,
}: {
  occurrenceIds?: readonly string[]
  playerId?: string
} = {}): SessionAttendanceRecords {
  if (occurrenceIds && !occurrenceIds.length) return {}
  const database = initializeDatabase()
  const selection = {
    occurrenceId: sessionAttendanceRecords.occurrenceId,
    playerId: sessionAttendanceRecords.accountId,
    choice: sessionAttendanceRecords.choice,
  }
  const rows = database.select(selection).from(sessionAttendanceRecords).where(and(
    occurrenceIds
      ? inArray(sessionAttendanceRecords.occurrenceId, [...occurrenceIds])
      : undefined,
    playerId ? eq(sessionAttendanceRecords.accountId, playerId) : undefined,
    ne(sessionAttendanceRecords.choice, "cleared"),
  )).all()

  return rows.reduce<SessionAttendanceRecords>((records, row) => {
    if (row.choice === "cleared") return records
    records[row.occurrenceId] ??= {}
    records[row.occurrenceId][row.playerId] = row.choice
    return records
  }, {})
}

export function listSessionAttendanceRecordsForOccurrences(
  occurrenceIds: readonly string[],
): SessionAttendanceRecords {
  return attendanceRecords({ occurrenceIds })
}

export function listSessionAttendanceRecordsForPlayer(
  playerId: string,
): SessionAttendanceRecords {
  return attendanceRecords({ playerId })
}

export function listSessionOccurrencesByIds(
  occurrenceIds: readonly string[],
): TrainingSessionOccurrence[] {
  if (!occurrenceIds.length) return []
  const database = initializeDatabase()
  const occurrences = database.select().from(sessionOccurrences)
    .where(inArray(sessionOccurrences.id, [...occurrenceIds]))
    .orderBy(asc(sessionOccurrences.startsAt), asc(sessionOccurrences.id)).all()
    .map((occurrence) => ({
      id: occurrence.id,
      seriesId: occurrence.seriesId,
      occurrenceDate: occurrence.occurrenceDate,
      startsAt: occurrence.startsAt.toISOString(),
      durationMinutes: occurrence.durationMinutes,
      venue: occurrence.venue,
      status: occurrence.status,
      replacementForOccurrenceId: occurrence.replacementForOccurrenceId,
    }))
  return resolveOccurrenceEligibilityDates(database, occurrences)
}

export function sessionPortalWindow(referenceDate: string) {
  const year = Number(referenceDate.slice(0, 4))
  return { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` }
}

export function findScheduledOccurrence(occurrenceId: string) {
  return initializeDatabase().select().from(sessionOccurrences)
    .where(eq(sessionOccurrences.id, occurrenceId)).get()
}
