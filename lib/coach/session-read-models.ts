import "server-only"

import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm"

import type { AttendanceAdjustmentRecord } from "@/lib/attendance/adjustments"
import type { AttendanceRegisterSelection } from "@/lib/attendance/register-workspace"
import {
  listAttendanceRegisterPlayerRecords,
  listOperationalPlayerRecords,
} from "@/lib/coach/database"
import { initializeDatabase } from "@/lib/db/client"
import {
  attendanceAdjustments,
  sessionOccurrences as sessionOccurrenceRows,
} from "@/lib/db/schema"
import {
  assignmentCoversOccurrence,
  calendarWindowForMonth,
} from "@/lib/sessions/domain"
import {
  listSessionAssignmentsForSeries,
  listSessionAttendanceRecordsForOccurrences,
  listSessionOccurrences,
  listSessionOccurrencesForSeries,
  listSessionSeries,
} from "@/lib/sessions/database"
import type {
  SessionAssignment,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

export type CoachSessionWindowSnapshot = {
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
}

export type CoachCalendarMonthSnapshot = CoachSessionWindowSnapshot & ReturnType<
  typeof listOperationalPlayerRecords
>

export type CoachAttendanceRegisterSnapshot = CoachSessionWindowSnapshot & ReturnType<
  typeof listAttendanceRegisterPlayerRecords
> & {
  attendanceAdjustments: AttendanceAdjustmentRecord[]
  attendanceRecords: SessionAttendanceRecords
}

function unique(items: readonly string[]) {
  return [...new Set(items)]
}

function subtractCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function assignmentsCoveringOccurrences(
  assignments: SessionAssignment[],
  occurrences: TrainingSessionOccurrence[],
) {
  const occurrencesBySeries = occurrences.reduce<Map<string, TrainingSessionOccurrence[]>>(
    (map, occurrence) => {
      const current = map.get(occurrence.seriesId) ?? []
      current.push(occurrence)
      map.set(occurrence.seriesId, current)
      return map
    },
    new Map(),
  )

  return assignments.filter((assignment) => (
    (occurrencesBySeries.get(assignment.seriesId) ?? []).some((occurrence) => (
      assignmentCoversOccurrence(assignment, occurrence)
    ))
  ))
}

/**
 * Returns only the occurrence window and roster facts needed by a Calendar month.
 * Replacement lineage remains resolved by the shared session database reader.
 */
export function getCoachSessionSnapshotForWindow({
  from,
  to,
}: {
  from: string
  to: string
}): CoachSessionWindowSnapshot {
  const sessionSeries = listSessionSeries()
  const sessionOccurrences = listSessionOccurrences(from, to)
  const visibleSeriesIds = unique(sessionOccurrences.map((occurrence) => occurrence.seriesId))
  const sessionAssignments = assignmentsCoveringOccurrences(
    listSessionAssignmentsForSeries(visibleSeriesIds),
    sessionOccurrences,
  )

  return { sessionAssignments, sessionOccurrences, sessionSeries }
}

export function getCoachCalendarMonthSnapshot(month: string): CoachCalendarMonthSnapshot {
  const window = calendarWindowForMonth(month)
  const sessions = getCoachSessionSnapshotForWindow(window)
  const playerIds = unique(sessions.sessionAssignments.map((assignment) => assignment.playerId))
  return { ...sessions, ...listOperationalPlayerRecords(playerIds) }
}

export function getCoachCalendarMonthSessionSnapshot(month: string): CoachSessionWindowSnapshot {
  return getCoachSessionSnapshotForWindow(calendarWindowForMonth(month))
}

function listAttendanceRegisterAdjustments({
  from,
  seriesIds,
  to,
}: {
  from: string
  seriesIds: readonly string[]
  to: string
}): AttendanceAdjustmentRecord[] {
  if (!seriesIds.length) return []
  const database = initializeDatabase()
  return database.select({ adjustment: attendanceAdjustments })
    .from(attendanceAdjustments)
    .innerJoin(
      sessionOccurrenceRows,
      eq(sessionOccurrenceRows.id, attendanceAdjustments.sourceOccurrenceId),
    )
    .where(and(
      isNull(attendanceAdjustments.voidedAt),
      inArray(sessionOccurrenceRows.seriesId, [...seriesIds]),
      or(
        and(
          gte(sessionOccurrenceRows.occurrenceDate, from),
          lt(sessionOccurrenceRows.occurrenceDate, to),
        ),
        and(
          gte(attendanceAdjustments.completedOn, from),
          lt(attendanceAdjustments.completedOn, to),
        ),
      ),
    ))
    .orderBy(desc(attendanceAdjustments.publishedAt), desc(attendanceAdjustments.id))
    .all()
    .map((row) => row.adjustment)
}

/**
 * Builds the annual read-only register from one programme/batch slice. The
 * preceding 14 days are retained only so January make-ups can resolve their
 * immutable source occurrence without serializing another academy year.
 */
export function getCoachAttendanceRegisterSnapshot(
  selection: AttendanceRegisterSelection,
  sessionSeries = listSessionSeries(),
): CoachAttendanceRegisterSnapshot {
  const yearStart = `${selection.year}-01-01`
  const nextYearStart = `${selection.year + 1}-01-01`
  const sourceWindowStart = subtractCalendarDays(yearStart, 14)
  const categorySeriesIds = sessionSeries
    .filter((series) => (
      series.programme === selection.programme && series.batch === selection.batch
    ))
    .map((series) => series.id)
  const sessionOccurrences = listSessionOccurrencesForSeries(
    sourceWindowStart,
    `${selection.year}-12-31`,
    categorySeriesIds,
  )
  const categoryOccurrencesInYear = sessionOccurrences.filter((occurrence) => (
    occurrence.occurrenceDate >= yearStart && occurrence.occurrenceDate < nextYearStart
  ))
  const sessionAssignments = listSessionAssignmentsForSeries(categorySeriesIds).filter(
    (assignment) => {
      const overlapsDisplayedYear = assignment.effectiveFrom < nextYearStart
        && (!assignment.effectiveTo || assignment.effectiveTo > yearStart)
      const coversReplacementInDisplayedYear = categoryOccurrencesInYear.some((occurrence) => (
        occurrence.status === "scheduled"
        && assignmentCoversOccurrence(assignment, occurrence)
      ))
      return overlapsDisplayedYear || coversReplacementInDisplayedYear
    },
  )
  const playerIds = unique(sessionAssignments.map((assignment) => assignment.playerId))

  return {
    ...listAttendanceRegisterPlayerRecords(playerIds),
    attendanceAdjustments: listAttendanceRegisterAdjustments({
      from: yearStart,
      seriesIds: categorySeriesIds,
      to: nextYearStart,
    }),
    attendanceRecords: listSessionAttendanceRecordsForOccurrences(
      categoryOccurrencesInYear.map((occurrence) => occurrence.id),
    ),
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  }
}
