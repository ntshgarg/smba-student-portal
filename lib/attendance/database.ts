import "server-only"

import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm"

import {
  calculateMonthlyAttendance,
  type AttendanceDomainRecord,
  type MonthlyAttendanceInput,
} from "@/lib/attendance/domain"
import { monthDateBounds } from "@/lib/date-keys"
import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  attendanceAdjustments,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
} from "@/lib/db/schema"
import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"

/**
 * Each player's month, read for many players at once: the family page reads
 * one, the coach's register reads its whole roster, and both feed the same
 * calculateMonthlyAttendance. A player with no enrolment has no entry.
 */
export function getPlayersAttendanceInputs(
  accountIds: readonly string[],
  month: string,
  referenceDate: string,
  referenceInstant?: string,
  database?: SmbaDatabaseExecutor,
): Map<string, MonthlyAttendanceInput> {
  const inputs = new Map<string, MonthlyAttendanceInput>()
  const ids = [...new Set(accountIds)]
  if (!ids.length) return inputs
  const db = database ?? initializeDatabase()
  const bounds = monthDateBounds(month)
  const occurredInMonth = and(
    gte(sessionOccurrences.occurrenceDate, bounds.start),
    lt(sessionOccurrences.occurrenceDate, bounds.endExclusive),
  )
  const enrollments = db.select({
    accountId: playerEnrollments.accountId,
    trainingStartOn: playerEnrollments.trainingStartOn,
  })
    .from(playerEnrollments)
    .where(inArray(playerEnrollments.accountId, ids))
    .all()
  if (!enrollments.length) return inputs
  const assignments = db.select({
    accountId: sessionAssignments.accountId,
    id: sessionAssignments.id,
    seriesId: sessionAssignments.seriesId,
    effectiveFrom: sessionAssignments.effectiveFrom,
    effectiveTo: sessionAssignments.effectiveTo,
  }).from(sessionAssignments)
    .where(inArray(sessionAssignments.accountId, ids))
    .all()
  const assignmentWeekdays = assignments.length
    ? db.select().from(sessionAssignmentWeekdays).where(inArray(
        sessionAssignmentWeekdays.assignmentId,
        assignments.map((assignment) => assignment.id),
      )).all()
    : []

  // An over-fetch cut, not a correctness fix: `assignmentCoversOccurrence`
  // (lib/sessions/domain.ts) already requires `assignment.seriesId ===
  // occurrence.seriesId`, so a foreign batch's sessions never reached anyone's
  // report - the old read just carried the whole academy's month in memory to
  // throw most of it away. The assignments query above is not date-filtered
  // (`effectiveFrom`/`effectiveTo` are read for the domain, not applied here),
  // so its series set already covers every occurrence that could survive that
  // filter.
  //
  // This predicate needs `session_occurrences_series_date_lookup_idx`. The older
  // `session_occurrences_series_date_idx` is partial on `status = 'scheduled'`
  // and this read wants cancelled occurrences too, so without the unfiltered
  // twin SQLite seeks `series_id` alone and re-checks the month across each
  // series' whole history - slower than the unscoped range it replaced.
  const assignedSeriesIds = [...new Set(assignments.map((assignment) => assignment.seriesId))]
  const occurrenceRows = assignedSeriesIds.length
    ? db.select({
        id: sessionOccurrences.id,
        seriesId: sessionOccurrences.seriesId,
        occurrenceDate: sessionOccurrences.occurrenceDate,
        startsAt: sessionOccurrences.startsAt,
        status: sessionOccurrences.status,
        replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
      }).from(sessionOccurrences).where(and(
        inArray(sessionOccurrences.seriesId, assignedSeriesIds),
        occurredInMonth,
      )).all()
    : []
  const occurrences = resolveOccurrenceEligibilityDates(db, occurrenceRows).map((occurrence) => ({
    ...occurrence,
    startsAt: occurrence.startsAt.toISOString(),
  }))

  const records = db.select({
    accountId: sessionAttendanceRecords.accountId,
    occurrenceId: sessionAttendanceRecords.occurrenceId,
    choice: sessionAttendanceRecords.choice,
  })
    .from(sessionAttendanceRecords)
    .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId))
    .where(and(
      inArray(sessionAttendanceRecords.accountId, ids),
      occurredInMonth,
    ))
    .all()

  const adjustments = db.select({
    playerId: attendanceAdjustments.playerId,
    id: attendanceAdjustments.id,
    sourceOccurrenceId: attendanceAdjustments.sourceOccurrenceId,
  })
    .from(attendanceAdjustments)
    .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, attendanceAdjustments.sourceOccurrenceId))
    .where(and(
      inArray(attendanceAdjustments.playerId, ids),
      isNull(attendanceAdjustments.voidedAt),
      occurredInMonth,
    ))
    .all()

  enrollments.forEach((enrollment) => {
    const accountId = enrollment.accountId
    const playerAssignments = assignments.filter((assignment) => assignment.accountId === accountId)
    const playerSeriesIds = new Set(playerAssignments.map((assignment) => assignment.seriesId))
    inputs.set(accountId, {
      month,
      referenceDate,
      referenceInstant,
      joinedOn: enrollment.trainingStartOn,
      assignments: playerAssignments.map((assignment) => ({
        seriesId: assignment.seriesId,
        effectiveFrom: assignment.effectiveFrom,
        effectiveTo: assignment.effectiveTo,
        weekdays: assignmentWeekdays
          .filter((item) => item.assignmentId === assignment.id)
          .map((item) => item.weekday),
      })),
      occurrences: occurrences.filter((occurrence) => playerSeriesIds.has(occurrence.seriesId)),
      records: records
        .filter((record) => record.accountId === accountId)
        .map(({ occurrenceId, choice }): AttendanceDomainRecord => ({ occurrenceId, choice })),
      adjustments: adjustments
        .filter((adjustment) => adjustment.playerId === accountId)
        .map(({ id, sourceOccurrenceId }) => ({ id, sourceOccurrenceId })),
    })
  })
  return inputs
}

export function getPlayerAttendanceInput(
  accountId: string,
  month: string,
  referenceDate: string,
  referenceInstant?: string,
  database?: SmbaDatabaseExecutor,
): MonthlyAttendanceInput | null {
  return getPlayersAttendanceInputs([accountId], month, referenceDate, referenceInstant, database)
    .get(accountId) ?? null
}

/** Each player's monthly %, by the family page's own rule: the coach's register shows these. */
export function calculatePlayersAttendancePercentForMonth(
  accountIds: readonly string[],
  month: string,
  referenceDate: string,
  referenceInstant?: string,
): Record<string, number | null> {
  const inputs = getPlayersAttendanceInputs(accountIds, month, referenceDate, referenceInstant)
  return Object.fromEntries([...inputs].map(([accountId, input]) => [
    accountId,
    calculateMonthlyAttendance(input).percentage,
  ]))
}

export function calculatePlayerAttendanceForMonth(
  accountId: string,
  month: string,
  referenceDate: string,
  referenceInstant?: string,
) {
  const input = getPlayerAttendanceInput(accountId, month, referenceDate, referenceInstant)
  return input ? calculateMonthlyAttendance(input) : null
}
