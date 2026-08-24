import "server-only"

import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm"

import {
  calculateMonthlyAttendance,
  type AttendanceDomainRecord,
  type MonthlyAttendanceInput,
} from "@/lib/attendance/domain"
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

// SQLite only applies its LIKE-to-range optimisation when the indexed column is
// NOCASE-collated. `occurrence_date` is BINARY, so `like(date, '2026-08%')`
// scans every occurrence ever scheduled; the half-open range below covers the
// same YYYY-MM-DD keys and seeks `session_occurrences_date_idx` instead.
function monthDateBounds(month: string) {
  const monthIndex = Number(month.slice(5, 7))
  const rollsIntoNextYear = monthIndex === 12
  const nextYear = Number(month.slice(0, 4)) + (rollsIntoNextYear ? 1 : 0)
  const nextMonthIndex = rollsIntoNextYear ? 1 : monthIndex + 1

  return {
    start: `${month}-01`,
    endExclusive: [
      String(nextYear).padStart(4, "0"),
      String(nextMonthIndex).padStart(2, "0"),
      "01",
    ].join("-"),
  }
}

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

  const occurrenceRows = db.select({
    id: sessionOccurrences.id,
    seriesId: sessionOccurrences.seriesId,
    occurrenceDate: sessionOccurrences.occurrenceDate,
    startsAt: sessionOccurrences.startsAt,
    status: sessionOccurrences.status,
    replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
  }).from(sessionOccurrences).where(occurredInMonth).all()
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
