import "server-only"

import { randomUUID } from "node:crypto"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import {
  OperationalActionError,
  operationalActionError,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  initializeDatabase,
  type SmbaDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
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
  completionOccurrenceId: string
  playerId: string
  sourceOccurrenceId: string
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

function assertApprovedPlayer(database: SmbaDatabaseExecutor, playerId: string) {
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

function assertPlayerEligibleForOccurrence({
  database,
  invalidMessage,
  now,
  occurrenceId,
  playerId,
  field,
}: {
  database: SmbaDatabaseExecutor
  invalidMessage: string
  now: Date
  occurrenceId: string
  playerId: string
  field: "completionOccurrenceId" | "sourceOccurrenceId"
}) {
  const sourceRow = database.select().from(sessionOccurrences)
    .where(eq(sessionOccurrences.id, occurrenceId)).get()
  const source = sourceRow
    ? resolveOccurrenceEligibilityDates(database, [sourceRow])[0]
    : null
  if (!source || source.status !== "scheduled" || !occurrenceHasStarted(source, now)) {
    operationalActionError(
      "INVALID_INPUT",
      invalidMessage,
      field,
    )
  }

  const enrollment = database.select({ trainingStartOn: playerEnrollments.trainingStartOn })
    .from(playerEnrollments).where(eq(playerEnrollments.accountId, playerId)).get()
  const joinedOn = enrollment?.trainingStartOn ?? null
  if (!joinedOn || !playerWasEnrolledForOccurrence(joinedOn, source)) {
    operationalActionError(
      "BUSINESS_RULE",
      field === "sourceOccurrenceId"
        ? "The player was not enrolled for the missed session."
        : "The player was not enrolled for the completion session.",
      field,
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
      field === "sourceOccurrenceId"
        ? "The absence is not from an assigned session day."
        : "The completion is not from an assigned session day.",
      field,
    )
  }

  return source
}

function assertSourceIsEligibleAbsence({
  database,
  now,
  playerId,
  sourceOccurrenceId,
}: {
  database: SmbaDatabaseExecutor
  now: Date
  playerId: string
  sourceOccurrenceId: string
}) {
  const source = assertPlayerEligibleForOccurrence({
    database,
    invalidMessage: "Choose a completed scheduled session.",
    now,
    occurrenceId: sourceOccurrenceId,
    playerId,
    field: "sourceOccurrenceId",
  })
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
  return source
}

function assertCompletionIsEligiblePresence({
  completionOccurrenceId,
  database,
  now,
  playerId,
}: {
  completionOccurrenceId: string
  database: SmbaDatabaseExecutor
  now: Date
  playerId: string
}) {
  const completion = assertPlayerEligibleForOccurrence({
    database,
    invalidMessage: "Choose a completed attendance session.",
    now,
    occurrenceId: completionOccurrenceId,
    playerId,
    field: "completionOccurrenceId",
  })
  const attendance = database.select({ choice: sessionAttendanceRecords.choice })
    .from(sessionAttendanceRecords).where(and(
      eq(sessionAttendanceRecords.accountId, playerId),
      eq(sessionAttendanceRecords.occurrenceId, completionOccurrenceId),
    )).get()
  if (attendance?.choice !== "present") {
    operationalActionError(
      "BUSINESS_RULE",
      "Choose a session where this player has saved Present attendance.",
      "completionOccurrenceId",
    )
  }
  return completion
}

function isSamePublishRequest(
  adjustment: AttendanceAdjustmentRecord,
  input: {
    coachId: string
    completionOccurrenceId: string
    playerId: string
    reason: string | null
    sourceOccurrenceId: string
  },
) {
  return adjustment.playerId === input.playerId
    && adjustment.sourceOccurrenceId === input.sourceOccurrenceId
    && adjustment.completionOccurrenceId === input.completionOccurrenceId
    && adjustment.reason === input.reason
    && adjustment.publishedByAccountId === input.coachId
}

function isUniqueConstraintViolation(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  return code === "SQLITE_CONSTRAINT_UNIQUE"
    || error.message.includes("UNIQUE constraint failed")
}

function activeAdjustmentForSource(
  database: SmbaDatabaseExecutor,
  playerId: string,
  sourceOccurrenceId: string,
) {
  return database.select().from(attendanceAdjustments).where(and(
    eq(attendanceAdjustments.playerId, playerId),
    eq(attendanceAdjustments.sourceOccurrenceId, sourceOccurrenceId),
    isNull(attendanceAdjustments.voidedAt),
  )).get()
}

function activeAdjustmentForCompletion(
  database: SmbaDatabaseExecutor,
  playerId: string,
  completionOccurrenceId: string,
) {
  return database.select().from(attendanceAdjustments).where(and(
    eq(attendanceAdjustments.playerId, playerId),
    eq(attendanceAdjustments.completionOccurrenceId, completionOccurrenceId),
    isNull(attendanceAdjustments.voidedAt),
  )).get()
}

function activeLegacyAdjustmentForCompletionDate(
  database: SmbaDatabaseExecutor,
  playerId: string,
  completedOn: string,
) {
  return database.select().from(attendanceAdjustments).where(and(
    eq(attendanceAdjustments.playerId, playerId),
    eq(attendanceAdjustments.completedOn, completedOn),
    isNull(attendanceAdjustments.completionOccurrenceId),
    isNull(attendanceAdjustments.voidedAt),
  )).get()
}

function publishConflict(
  field: "completionOccurrenceId" | "sourceOccurrenceId",
): never {
  operationalActionError(
    "CONFLICT",
    field === "sourceOccurrenceId"
      ? "This absence already has a different published adjustment."
      : "This completed session is already linked to another attendance adjustment.",
    field,
  )
}

export function listAttendanceAdjustments({
  database = initializeDatabase(),
  includeVoided = false,
  playerId,
  sourceOccurrenceIds,
}: DatabaseOption & {
  includeVoided?: boolean
  playerId?: string
  sourceOccurrenceIds?: readonly string[]
} = {}): AttendanceAdjustmentRecord[] {
  if (sourceOccurrenceIds && !sourceOccurrenceIds.length) return []
  return database.select().from(attendanceAdjustments).where(and(
    playerId ? eq(attendanceAdjustments.playerId, playerId) : undefined,
    sourceOccurrenceIds
      ? inArray(attendanceAdjustments.sourceOccurrenceId, [...sourceOccurrenceIds])
      : undefined,
    includeVoided ? undefined : isNull(attendanceAdjustments.voidedAt),
  ))
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
  completionOccurrenceId,
  database = initializeDatabase(),
  now = new Date(),
  playerId,
  reason,
  sourceOccurrenceId,
}: PublishMakeupAttendanceAdjustmentInput): AttendanceAdjustmentRecord {
  assertApprovedCoach(database, coachId)
  const normalizedReason = normalizeReason(reason)
  if (normalizedReason && normalizedReason.length > 160) {
    operationalActionError(
      "INVALID_INPUT",
      "Keep the reason within 160 characters.",
      "reason",
    )
  }

  const semanticInput = {
    coachId,
    completionOccurrenceId,
    playerId,
    reason: normalizedReason,
    sourceOccurrenceId,
  }

  try {
    return database.transaction((tx) => {
      const existing = activeAdjustmentForSource(tx, playerId, sourceOccurrenceId)
      if (existing) {
        if (isSamePublishRequest(existing, semanticInput)) return existing
        publishConflict("sourceOccurrenceId")
      }
      assertApprovedPlayer(tx, playerId)

      const source = assertSourceIsEligibleAbsence({
        database: tx,
        now,
        playerId,
        sourceOccurrenceId,
      })
      const completion = assertCompletionIsEligiblePresence({
        completionOccurrenceId,
        database: tx,
        now,
        playerId,
      })
      const completedOn = completion.occurrenceDate
      const today = getIndiaDateKey(now)
      if (completedOn <= source.occurrenceDate) {
        operationalActionError(
          "BUSINESS_RULE",
          "The make-up session must be after the missed session.",
          "completionOccurrenceId",
        )
      }
      if (completedOn > addCalendarDays(source.occurrenceDate, 14)) {
        operationalActionError(
          "BUSINESS_RULE",
          "The make-up session must be within 14 days of the missed session.",
          "completionOccurrenceId",
        )
      }
      if (completedOn > today) {
        operationalActionError(
          "BUSINESS_RULE",
          "A future make-up cannot be published.",
          "completionOccurrenceId",
        )
      }

      if (activeLegacyAdjustmentForCompletionDate(tx, playerId, completedOn)) {
        operationalActionError(
          "CONFLICT",
          "This training date is linked to a legacy adjustment that requires review. Void it before using this session.",
          "completionOccurrenceId",
        )
      }

      const usedCompletion = activeAdjustmentForCompletion(
        tx,
        playerId,
        completionOccurrenceId,
      )
      if (usedCompletion) publishConflict("completionOccurrenceId")

      return tx.insert(attendanceAdjustments).values({
        id: randomUUID(),
        type: "makeup",
        playerId,
        sourceOccurrenceId,
        completedOn,
        completionOccurrenceId,
        reason: normalizedReason,
        publishedByAccountId: coachId,
        publishedAt: now,
        reviewRequiredAt: null,
        voidedByAccountId: null,
        voidedAt: null,
      }).returning().get()
    }, { behavior: "immediate" })
  } catch (error) {
    if (error instanceof OperationalActionError || !isUniqueConstraintViolation(error)) {
      throw error
    }

    const existingSource = activeAdjustmentForSource(database, playerId, sourceOccurrenceId)
    if (existingSource) {
      if (isSamePublishRequest(existingSource, semanticInput)) return existingSource
      publishConflict("sourceOccurrenceId")
    }
    if (activeAdjustmentForCompletion(database, playerId, completionOccurrenceId)) {
      publishConflict("completionOccurrenceId")
    }
    throw error
  }
}

export function voidAttendanceAdjustment({
  adjustmentId,
  coachId,
  database = initializeDatabase(),
  now = new Date(),
}: VoidAttendanceAdjustmentInput): AttendanceAdjustmentRecord {
  assertApprovedCoach(database, coachId)
  return database.transaction((tx) => {
    const adjustment = tx.select().from(attendanceAdjustments)
      .where(eq(attendanceAdjustments.id, adjustmentId)).get()
    if (!adjustment) {
      operationalActionError(
        "NOT_FOUND",
        "The active attendance adjustment was not found.",
        "adjustmentId",
      )
    }
    if (adjustment.voidedAt) {
      if (adjustment.voidedByAccountId === coachId) return adjustment
      operationalActionError(
        "CONFLICT",
        "This adjustment was already voided by another coach.",
        "adjustmentId",
      )
    }

    return tx.update(attendanceAdjustments).set({
      reviewRequiredAt: null,
      voidedByAccountId: coachId,
      voidedAt: now,
    }).where(and(
      eq(attendanceAdjustments.id, adjustment.id),
      isNull(attendanceAdjustments.voidedAt),
    )).returning().get()
  }, { behavior: "immediate" })
}

export function reconcileAttendanceAdjustmentReviewState({
  completedOn,
  database,
  lostFinalPresence,
  now,
  playerId,
}: ReconcileAttendanceAdjustmentReviewInput) {
  const active = database.select().from(attendanceAdjustments).where(and(
    eq(attendanceAdjustments.playerId, playerId),
    eq(attendanceAdjustments.completedOn, completedOn),
    isNull(attendanceAdjustments.voidedAt),
  )).all()

  return active.reduce((changes, adjustment) => {
    const hasOrdinaryPresence = adjustment.completionOccurrenceId
      ? Boolean(database.select({ id: sessionAttendanceRecords.id })
          .from(sessionAttendanceRecords).where(and(
            eq(sessionAttendanceRecords.accountId, playerId),
            eq(sessionAttendanceRecords.occurrenceId, adjustment.completionOccurrenceId),
            eq(sessionAttendanceRecords.choice, "present"),
          )).get())
      : Boolean(database.select({ id: sessionAttendanceRecords.id })
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
      return changes + database.update(attendanceAdjustments)
        .set({ reviewRequiredAt: null })
        .where(eq(attendanceAdjustments.id, adjustment.id)).run().changes
    }
    if (!lostFinalPresence) return changes
    return changes + database.update(attendanceAdjustments)
      .set({ reviewRequiredAt: now })
      .where(eq(attendanceAdjustments.id, adjustment.id)).run().changes
  }, 0)
}
