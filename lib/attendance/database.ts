import "server-only"

import { and, eq, inArray, isNull, like } from "drizzle-orm"

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

export function getPlayerAttendanceInput(
  accountId: string,
  month: string,
  referenceDate: string,
  referenceInstant?: string,
  database?: SmbaDatabaseExecutor,
): MonthlyAttendanceInput | null {
  const db = database ?? initializeDatabase()
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
  }).from(sessionOccurrences).where(like(sessionOccurrences.occurrenceDate, `${month}%`)).all()
  const occurrences = resolveOccurrenceEligibilityDates(db, occurrenceRows)

  const records: AttendanceDomainRecord[] = db.select({
    occurrenceId: sessionAttendanceRecords.occurrenceId,
    choice: sessionAttendanceRecords.choice,
  })
    .from(sessionAttendanceRecords)
    .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId))
    .where(and(
      eq(sessionAttendanceRecords.accountId, accountId),
      like(sessionOccurrences.occurrenceDate, `${month}%`),
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
      like(sessionOccurrences.occurrenceDate, `${month}%`),
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
