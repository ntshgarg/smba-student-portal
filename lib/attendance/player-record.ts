import "server-only"

import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm"

import { academyNow } from "@/lib/clock"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { initializeDatabase } from "@/lib/db/client"
import {
  academyHolidays,
  attendanceAdjustments,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
  sessionRecurrenceRules,
  sessionSeries,
} from "@/lib/db/schema"
import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"
import type { PlayerAttendanceRecord } from "@/lib/types"

export function getPlayerAttendanceRecord(
  accountId: string,
  referenceInstant = academyNow(),
): PlayerAttendanceRecord | null {
  const database = initializeDatabase()
  const enrollment = database.select({ trainingStartOn: playerEnrollments.trainingStartOn })
    .from(playerEnrollments)
    .where(eq(playerEnrollments.accountId, accountId))
    .get()

  if (!enrollment) return null

  const referenceDate = getIndiaDateKey(referenceInstant)
  const currentYear = Number(referenceDate.slice(0, 4))
  const years = [currentYear - 1, currentYear, currentYear + 1]
  const from = `${years[0]}-01-01`
  const to = `${years[years.length - 1]}-12-31`

  /*
   * Read before the early return below. A player with no assignment still sees
   * a calendar, and the academy being closed is true of the academy, not of
   * their roster.
   */
  const holidays = database.select({
    dateKey: academyHolidays.dateKey,
    label: academyHolidays.label,
  }).from(academyHolidays).where(and(
    gte(academyHolidays.dateKey, from),
    lte(academyHolidays.dateKey, to),
  )).orderBy(asc(academyHolidays.dateKey)).all()

  const assignmentRows = database.select().from(sessionAssignments)
    .where(eq(sessionAssignments.accountId, accountId))
    .orderBy(asc(sessionAssignments.effectiveFrom), asc(sessionAssignments.id))
    .all()
  const assignmentIds = assignmentRows.map((assignment) => assignment.id)
  const assignmentWeekdays = assignmentIds.length
    ? database.select().from(sessionAssignmentWeekdays)
        .where(inArray(sessionAssignmentWeekdays.assignmentId, assignmentIds))
        .orderBy(asc(sessionAssignmentWeekdays.weekday))
        .all()
    : []
  const seriesIds = [...new Set(assignmentRows.map((assignment) => assignment.seriesId))]

  if (!seriesIds.length) {
    return {
      referenceDate,
      referenceInstant: referenceInstant.toISOString(),
      joinedOn: enrollment.trainingStartOn,
      years,
      holidays,
      sessions: [],
      assignments: [],
      occurrences: [],
      records: [],
      adjustments: [],
    }
  }

  const seriesRows = database.select().from(sessionSeries)
    .where(inArray(sessionSeries.id, seriesIds))
    .all()
  const recurrenceRows = database.select().from(sessionRecurrenceRules)
    .where(inArray(sessionRecurrenceRules.seriesId, seriesIds))
    .orderBy(asc(sessionRecurrenceRules.weekday), asc(sessionRecurrenceRules.id))
    .all()
  const occurrenceRows = resolveOccurrenceEligibilityDates(
    database,
    database.select().from(sessionOccurrences)
      .where(and(
        inArray(sessionOccurrences.seriesId, seriesIds),
        gte(sessionOccurrences.occurrenceDate, from),
        lte(sessionOccurrences.occurrenceDate, to),
      ))
      .orderBy(asc(sessionOccurrences.startsAt), asc(sessionOccurrences.id))
      .all(),
  )
  const occurrenceIds = occurrenceRows.map((occurrence) => occurrence.id)
  const attendanceRows = occurrenceIds.length
    ? database.select({
        occurrenceId: sessionAttendanceRecords.occurrenceId,
        choice: sessionAttendanceRecords.choice,
      }).from(sessionAttendanceRecords).where(and(
        eq(sessionAttendanceRecords.accountId, accountId),
        inArray(sessionAttendanceRecords.occurrenceId, occurrenceIds),
        ne(sessionAttendanceRecords.choice, "cleared"),
      )).all()
    : []
  const adjustmentRows = database.select({
    sourceOccurrenceId: attendanceAdjustments.sourceOccurrenceId,
    completedOn: attendanceAdjustments.completedOn,
  }).from(attendanceAdjustments).where(and(
    eq(attendanceAdjustments.playerId, accountId),
    isNull(attendanceAdjustments.voidedAt),
  )).all()
  const occurrenceIdSet = new Set(occurrenceIds)

  return {
    referenceDate,
    referenceInstant: referenceInstant.toISOString(),
    joinedOn: enrollment.trainingStartOn,
    years,
    holidays,
    sessions: seriesRows.map((series) => {
      const slot = recurrenceRows.find((row) => row.seriesId === series.id)
      return {
        id: series.id,
        programme: series.programme,
        batch: series.batch,
        startTime: slot?.startTime ?? "",
        durationMinutes: slot?.durationMinutes ?? 0,
      }
    }),
    assignments: assignmentRows.map((assignment) => ({
      id: assignment.id,
      seriesId: assignment.seriesId,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
      weekdays: assignmentWeekdays
        .filter((row) => row.assignmentId === assignment.id)
        .map((row) => row.weekday),
    })),
    occurrences: occurrenceRows.map((occurrence) => ({
      id: occurrence.id,
      seriesId: occurrence.seriesId,
      occurrenceDate: occurrence.occurrenceDate,
      eligibilityDate: occurrence.eligibilityDate,
      startsAt: occurrence.startsAt.toISOString(),
      durationMinutes: occurrence.durationMinutes,
      status: occurrence.status,
    })),
    records: attendanceRows.flatMap((row) => (
      row.choice === "present" || row.choice === "absent"
        ? [{ occurrenceId: row.occurrenceId, choice: row.choice }]
        : []
    )),
    adjustments: adjustmentRows.flatMap((adjustment) => (
      occurrenceIdSet.has(adjustment.sourceOccurrenceId)
        || (adjustment.completedOn >= from && adjustment.completedOn <= to)
        ? [{
            sourceOccurrenceId: adjustment.sourceOccurrenceId,
            completedOn: adjustment.completedOn,
          }]
        : []
    )),
  }
}
