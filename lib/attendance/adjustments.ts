import "server-only"

import { randomUUID } from "node:crypto"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { operationalActionError } from "@/lib/actions/operational-result"
import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { initializeDatabase, type SmbaDatabase } from "@/lib/db/client"
import {
  accounts,
  attendanceAdjustments,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
} from "@/lib/db/schema"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"
import { occurrenceHasStarted } from "@/lib/sessions/occurrence-time"

export type AttendanceAdjustmentRecord = typeof attendanceAdjustments.$inferSelect

type DatabaseOption = {
  database?: SmbaDatabase
}

export type PublishMakeupAttendanceAdjustmentInput = DatabaseOption & {
  coachId: string
  playerId: string
  sourceOccurrenceId: string
  completedOn: string
  reason?: string | null
  now?: Date
}

export type VoidAttendanceAdjustmentInput = DatabaseOption & {
  adjustmentId: string
  coachId: string
  now?: Date
}

export type ReconcileAttendanceAdjustmentReviewInput = {
  database: SmbaDatabase
  playerId: string
  completedOn: string
  lostFinalPresence: boolean
  now: Date
}

function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeReason(reason: string | null | undefined) {
  const normalized = reason?.trim()
  return normalized ? normalized : null
}

function assertApprovedCoach(database: SmbaDatabase, coachId: string) {
  requireHeadAdminAccess(coachId, { database })
}

function assertApprovedPlayer(database: SmbaDatabase, playerId: string) {
  const player = database.select({ id: accounts.id }).from(accounts).where(and(
    eq(accounts.id, playerId),
    eq(accounts.role, "player"),
    eq(accounts.approvalStatus, "approved"),
    isNull(accounts.archivedAt),
  )).get()
  if (!player) {
    operationalActionError("NOT_FOUND", "Approved player was not found.", "playerId")
  }
}

function assertSourceIsEligibleAbsence({
  database,
  now,
  playerId,
  sourceOccurrenceId,
}: {
  database: SmbaDatabase
  now: Date
  playerId: string
  sourceOccurrenceId: string
}) {
  const sourceRow = database.select().from(sessionOccurrences)
    .where(eq(sessionOccurrences.id, sourceOccurrenceId)).get()
  const source = sourceRow
    ? resolveOccurrenceEligibilityDates(database, [sourceRow])[0]
    : null
  if (!source || source.status !== "scheduled" || !occurrenceHasStarted(source, now)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a completed scheduled session.",
      "sourceOccurrenceId",
    )
  }

  const attendance = database.select({ choice: sessionAttendanceRecords.choice })
    .from(sessionAttendanceRecords).where(and(
      eq(sessionAttendanceRecords.accountId, playerId),
      eq(sessionAttendanceRecords.occurrenceId, sourceOccurrenceId),
    )).get()
  if (attendance?.choice !== "absent") {
    operationalActionError(
      "BUSINESS_RULE",
      "Only a saved absence can be reconciled.",
      "sourceOccurrenceId",
    )
  }

  const enrollment = database.select({ joinedAt: playerEnrollments.joinedAt })
    .from(playerEnrollments).where(eq(playerEnrollments.accountId, playerId)).get()
  const joinedOn = enrollment ? getIndiaDateKey(enrollment.joinedAt) : null
  if (!joinedOn || !playerWasEnrolledForOccurrence(joinedOn, source)) {
    operationalActionError(
      "BUSINESS_RULE",
      "The player was not enrolled for the missed session.",
      "sourceOccurrenceId",
    )
  }

  const assignments = database.select().from(sessionAssignments).where(and(
    eq(sessionAssignments.accountId, playerId),
    eq(sessionAssignments.seriesId, source.seriesId),
  )).all()
  const assignmentIds = assignments.map((assignment) => assignment.id)
  const assignedWeekdays = assignmentIds.length
    ? database.select().from(sessionAssignmentWeekdays).where(inArray(
        sessionAssignmentWeekdays.assignmentId,
        assignmentIds,
      )).all()
    : []
  const assignment = assignments.find((item) => assignmentCoversOccurrence({
    ...item,
    weekdays: assignedWeekdays
      .filter((weekday) => weekday.assignmentId === item.id)
      .map((weekday) => weekday.weekday),
  }, source))
  if (!assignment) {
    operationalActionError(
      "BUSINESS_RULE",
      "The absence is not from an assigned session day.",
      "sourceOccurrenceId",
    )
  }

  return source
}

export function listAttendanceAdjustments({
  database = initializeDatabase(),
  includeVoided = false,
  playerId,
}: DatabaseOption & {
  includeVoided?: boolean
  playerId?: string
} = {}): AttendanceAdjustmentRecord[] {
  if (playerId && includeVoided) {
    return database.select().from(attendanceAdjustments)
      .where(eq(attendanceAdjustments.playerId, playerId))
      .orderBy(desc(attendanceAdjustments.publishedAt), desc(attendanceAdjustments.id)).all()
  }
  if (playerId) {
    return database.select().from(attendanceAdjustments).where(and(
      eq(attendanceAdjustments.playerId, playerId),
      isNull(attendanceAdjustments.voidedAt),
    )).orderBy(desc(attendanceAdjustments.publishedAt), desc(attendanceAdjustments.id)).all()
  }
  if (includeVoided) {
    return database.select().from(attendanceAdjustments)
      .orderBy(desc(attendanceAdjustments.publishedAt), desc(attendanceAdjustments.id)).all()
  }
  return database.select().from(attendanceAdjustments)
    .where(isNull(attendanceAdjustments.voidedAt))
    .orderBy(desc(attendanceAdjustments.publishedAt), desc(attendanceAdjustments.id)).all()
}

export function listActiveAttendanceAdjustments(
  accountId?: string,
  database = initializeDatabase(),
) {
  return listAttendanceAdjustments({ database, playerId: accountId })
}

export function publishMakeupAttendanceAdjustment({
  coachId,
  completedOn,
  database = initializeDatabase(),
  now = new Date(),
  playerId,
  reason,
  sourceOccurrenceId,
}: PublishMakeupAttendanceAdjustmentInput): AttendanceAdjustmentRecord {
  assertApprovedCoach(database, coachId)
  assertApprovedPlayer(database, playerId)
  if (!isValidDateKey(completedOn)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid completion date.",
      "completedOn",
    )
  }
  const normalizedReason = normalizeReason(reason)
  if (normalizedReason && normalizedReason.length > 160) {
    operationalActionError(
      "INVALID_INPUT",
      "Keep the reason within 160 characters.",
      "reason",
    )
  }

  const source = assertSourceIsEligibleAbsence({
    database,
    now,
    playerId,
    sourceOccurrenceId,
  })
  const today = getIndiaDateKey(now)
  if (completedOn <= source.occurrenceDate) {
    operationalActionError(
      "BUSINESS_RULE",
      "The make-up date must be after the missed session.",
      "completedOn",
    )
  }
  if (completedOn > addCalendarDays(source.occurrenceDate, 14)) {
    operationalActionError(
      "BUSINESS_RULE",
      "The make-up date must be within 14 days of the missed session.",
      "completedOn",
    )
  }
  if (completedOn > today) {
    operationalActionError(
      "BUSINESS_RULE",
      "A future make-up cannot be published.",
      "completedOn",
    )
  }

  const completionOccurrences = database.select().from(sessionOccurrences).where(and(
    eq(sessionOccurrences.occurrenceDate, completedOn),
    eq(sessionOccurrences.status, "scheduled"),
  )).all().filter((occurrence) => occurrenceHasStarted(occurrence, now))
  if (!completionOccurrences.length) {
    operationalActionError(
      "BUSINESS_RULE",
      "No completed academy session was found on this date.",
      "completedOn",
    )
  }

  return database.transaction((tx) => {
    const existing = tx.select({ id: attendanceAdjustments.id })
      .from(attendanceAdjustments).where(and(
        eq(attendanceAdjustments.playerId, playerId),
        eq(attendanceAdjustments.sourceOccurrenceId, sourceOccurrenceId),
        isNull(attendanceAdjustments.voidedAt),
      )).get()
    if (existing) {
      operationalActionError(
        "CONFLICT",
        "This absence already has a published adjustment.",
        "sourceOccurrenceId",
      )
    }

    return tx.insert(attendanceAdjustments).values({
      id: randomUUID(),
      type: "makeup",
      playerId,
      sourceOccurrenceId,
      completedOn,
      completionOccurrenceId: completionOccurrences.length === 1
        ? completionOccurrences[0].id
        : null,
      reason: normalizedReason,
      publishedByAccountId: coachId,
      publishedAt: now,
      reviewRequiredAt: null,
      voidedByAccountId: null,
      voidedAt: null,
    }).returning().get()
  })
}

export function voidAttendanceAdjustment({
  adjustmentId,
  coachId,
  database = initializeDatabase(),
  now = new Date(),
}: VoidAttendanceAdjustmentInput): AttendanceAdjustmentRecord {
  assertApprovedCoach(database, coachId)
  return database.transaction((tx) => {
    const adjustment = tx.select().from(attendanceAdjustments).where(and(
      eq(attendanceAdjustments.id, adjustmentId),
      isNull(attendanceAdjustments.voidedAt),
    )).get()
    if (!adjustment) {
      operationalActionError(
        "NOT_FOUND",
        "The active attendance adjustment was not found.",
        "adjustmentId",
      )
    }

    return tx.update(attendanceAdjustments).set({
      reviewRequiredAt: null,
      voidedByAccountId: coachId,
      voidedAt: now,
    }).where(eq(attendanceAdjustments.id, adjustment.id)).returning().get()
  })
}

export function reconcileAttendanceAdjustmentReviewState({
  completedOn,
  database,
  lostFinalPresence,
  now,
  playerId,
}: ReconcileAttendanceAdjustmentReviewInput) {
  const hasOrdinaryPresence = Boolean(database.select({ id: sessionAttendanceRecords.id })
    .from(sessionAttendanceRecords)
    .innerJoin(
      sessionOccurrences,
      eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId),
    ).where(and(
      eq(sessionAttendanceRecords.accountId, playerId),
      eq(sessionAttendanceRecords.choice, "present"),
      eq(sessionOccurrences.occurrenceDate, completedOn),
    )).get())

  if (hasOrdinaryPresence) {
    return database.update(attendanceAdjustments).set({ reviewRequiredAt: null }).where(and(
      eq(attendanceAdjustments.playerId, playerId),
      eq(attendanceAdjustments.completedOn, completedOn),
      isNull(attendanceAdjustments.voidedAt),
    )).run().changes
  }
  if (!lostFinalPresence) return 0

  return database.update(attendanceAdjustments).set({ reviewRequiredAt: now }).where(and(
    eq(attendanceAdjustments.playerId, playerId),
    eq(attendanceAdjustments.completedOn, completedOn),
    isNull(attendanceAdjustments.voidedAt),
  )).run().changes
}
