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

export function getPlayerAttendanceInput(
  accountId: string,
  month: string,
  referenceDate: string,
  referenceInstant?: string,
  database?: SmbaDatabaseExecutor,
): MonthlyAttendanceInput | null {
  const db = database ?? initializeDatabase()
  const bounds = monthDateBounds(month)
  const occurredInMonth = and(
    gte(sessionOccurrences.occurrenceDate, bounds.start),
    lt(sessionOccurrences.occurrenceDate, bounds.endExclusive),
  )
  const enrollment = db.select({ trainingStartOn: playerEnrollments.trainingStartOn })
    .from(playerEnrollments)
    .where(eq(playerEnrollments.accountId, accountId))
    .get()
  if (!enrollment) return null
  const assignments = db.select({
    id: sessionAssignments.id,
    seriesId: sessionAssignments.seriesId,
    effectiveFrom: sessionAssignments.effectiveFrom,
    effectiveTo: sessionAssignments.effectiveTo,
  }).from(sessionAssignments)
    .where(eq(sessionAssignments.accountId, accountId))
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
  const occurrences = resolveOccurrenceEligibilityDates(db, occurrenceRows)

  const records: AttendanceDomainRecord[] = db.select({
    occurrenceId: sessionAttendanceRecords.occurrenceId,
    choice: sessionAttendanceRecords.choice,
  })
    .from(sessionAttendanceRecords)
    .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId))
    .where(and(
      eq(sessionAttendanceRecords.accountId, accountId),
      occurredInMonth,
    ))
    .all()

  const adjustments = db.select({
    id: attendanceAdjustments.id,
    sourceOccurrenceId: attendanceAdjustments.sourceOccurrenceId,
  })
    .from(attendanceAdjustments)
    .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, attendanceAdjustments.sourceOccurrenceId))
    .where(and(
      eq(attendanceAdjustments.playerId, accountId),
      isNull(attendanceAdjustments.voidedAt),
      occurredInMonth,
    ))
    .all()

  return {
    month,
    referenceDate,
    referenceInstant,
    joinedOn: enrollment.trainingStartOn,
    assignments: assignments.map((assignment) => ({
      seriesId: assignment.seriesId,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
      weekdays: assignmentWeekdays
        .filter((item) => item.assignmentId === assignment.id)
        .map((item) => item.weekday),
    })),
    occurrences: occurrences.map((occurrence) => ({
      ...occurrence,
      startsAt: occurrence.startsAt.toISOString(),
    })),
    records,
    adjustments,
  }
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
