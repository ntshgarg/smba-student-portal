import "server-only"

import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm"

import {
  listAttendanceAdjustments,
  type AttendanceAdjustmentRecord,
} from "@/lib/attendance/adjustments"
import type { AttendanceRegisterSelection } from "@/lib/attendance/register-workspace"
import { academyNow, academyToday } from "@/lib/clock"
import {
  listAttendanceRegisterPlayerRecords,
  listCoachMonthlyReports,
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
  listAcademyHolidaysInWindow,
  listSessionAssignmentsForSeries,
  listSessionAssignments,
  listSessionAssignmentsForPlayers,
  listSessionAttendanceRecordsForPlayer,
  listSessionAttendanceRecordsForOccurrences,
  listSessionOccurrences,
  listSessionOccurrencesByIds,
  listSessionOccurrencesForSeries,
  listSessionSeries,
  listStartedScheduledOccurrenceKeys,
} from "@/lib/sessions/database"
import type { AcademyHolidayRecord } from "@/lib/sessions/holiday-types"
import type {
  SessionAssignment,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

export type CoachSessionWindowSnapshot = {
  // Every coach surface that loads occurrences over a window also needs to know
  // which of those dates the academy was closed on, or a holiday renders as an
  // ordinary gap. Carrying it here means the calendar and the register cannot
  // disagree about the same day.
  academyHolidays: AcademyHolidayRecord[]
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

export type CoachAttendanceRecorderSnapshot = CoachSessionWindowSnapshot & ReturnType<
  typeof listOperationalPlayerRecords
> & {
  attendanceAdjustments: AttendanceAdjustmentRecord[]
  attendanceRecords: SessionAttendanceRecords
}

export type CoachReportWritingSnapshot = CoachAttendanceRecorderSnapshot & {
  reports: ReturnType<typeof listCoachMonthlyReports>
}

export type CoachAttendanceAdjustmentsSnapshot = CoachSessionWindowSnapshot & ReturnType<
  typeof listOperationalPlayerRecords
> & {
  attendanceAdjustments: AttendanceAdjustmentRecord[]
  attendanceRecords: SessionAttendanceRecords
  selectedPlayerId: string | null
}

export type CoachScheduleBackfillOccurrence = Pick<
  TrainingSessionOccurrence,
  "eligibilityDate" | "seriesId"
>

export type CoachScheduleRosterSnapshot = {
  backfillOccurrences: CoachScheduleBackfillOccurrence[]
  sessionAssignments: SessionAssignment[]
  sessionSeries: TrainingSessionSeries[]
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
function getCoachSessionSnapshotForWindow({
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

  return {
    academyHolidays: listAcademyHolidaysInWindow(from, to),
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  }
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

export function getCoachAttendanceRecorderSnapshot(
  dateKey: string,
): CoachAttendanceRecorderSnapshot {
  const sessions = getCoachSessionSnapshotForWindow({ from: dateKey, to: dateKey })
  const occurrenceIds = sessions.sessionOccurrences.map((occurrence) => occurrence.id)
  const playerIds = unique(sessions.sessionAssignments.map((assignment) => assignment.playerId))

  return {
    ...sessions,
    ...listOperationalPlayerRecords(playerIds),
    attendanceAdjustments: listAttendanceAdjustments({
      includeVoided: true,
      sourceOccurrenceIds: occurrenceIds,
    }),
    attendanceRecords: listSessionAttendanceRecordsForOccurrences(occurrenceIds),
  }
}

export function getCoachReportWritingSnapshot(month: string): CoachReportWritingSnapshot {
  const sessions = getCoachCalendarMonthSessionSnapshot(month)
  const occurrenceIds = sessions.sessionOccurrences.map((occurrence) => occurrence.id)

  return {
    ...sessions,
    ...listOperationalPlayerRecords(),
    attendanceAdjustments: listAttendanceAdjustments({
      includeVoided: true,
      sourceOccurrenceIds: occurrenceIds,
    }),
    attendanceRecords: listSessionAttendanceRecordsForOccurrences(occurrenceIds),
    reports: listCoachMonthlyReports(month),
  }
}

export function getCoachAttendanceAdjustmentsSnapshot({
  adjustmentId,
  playerId,
}: {
  adjustmentId?: string
  playerId?: string
} = {}): CoachAttendanceAdjustmentsSnapshot {
  const players = listOperationalPlayerRecords()
  const attendanceAdjustments = listAttendanceAdjustments({ includeVoided: true })
  const adjustmentPlayerId = attendanceAdjustments.find(
    (adjustment) => adjustment.id === adjustmentId,
  )?.playerId
  const requestedPlayerId = adjustmentPlayerId ?? playerId
  const selectedPlayerId = players.members.some((member) => member.id === requestedPlayerId)
    ? requestedPlayerId ?? null
    : null
  const attendanceRecords = selectedPlayerId
    ? listSessionAttendanceRecordsForPlayer(selectedPlayerId)
    : {}
  const occurrenceIds = unique([
    ...Object.keys(attendanceRecords),
    ...attendanceAdjustments.flatMap((adjustment) => [
      adjustment.sourceOccurrenceId,
      ...(adjustment.completionOccurrenceId ? [adjustment.completionOccurrenceId] : []),
    ]),
  ])

  return {
    ...players,
    // Adjustments are read by id, not over a date window, and this screen never
    // draws a calendar. Nothing here can show a closure, so nothing loads one.
    academyHolidays: [],
    attendanceAdjustments,
    attendanceRecords,
    selectedPlayerId,
    sessionAssignments: selectedPlayerId
      ? listSessionAssignmentsForPlayers([selectedPlayerId])
      : [],
    sessionOccurrences: listSessionOccurrencesByIds(occurrenceIds),
    sessionSeries: listSessionSeries(),
  }
}

export function getCoachScheduleRosterSnapshot(
  referenceDate = academyToday(),
  referenceInstant = academyNow(),
): CoachScheduleRosterSnapshot {
  const sessionSeries = listSessionSeries()
  const earliestStart = sessionSeries.reduce<string | null>(
    (earliest, series) => !earliest || series.startsOn < earliest ? series.startsOn : earliest,
    null,
  )
  const backfillOccurrences = earliestStart
    ? listStartedScheduledOccurrenceKeys(earliestStart, referenceDate, referenceInstant)
    : []

  return {
    backfillOccurrences,
    sessionAssignments: listSessionAssignments(),
    sessionSeries,
  }
}

export function getCoachScheduleMutationSnapshot(): CoachSessionWindowSnapshot {
  return {
    // Deliberately empty, matching `sessionOccurrences` above: this snapshot
    // answers "what schedules exist now", not "what happens on which day".
    academyHolidays: [],
    sessionAssignments: listSessionAssignments(),
    sessionOccurrences: [],
    sessionSeries: listSessionSeries(),
  }
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
    academyHolidays: listAcademyHolidaysInWindow(yearStart, `${selection.year}-12-31`),
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
