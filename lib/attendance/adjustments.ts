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

export type KeepAttendanceAdjustmentInput = VoidAttendanceAdjustmentInput

export type ReconcileAttendanceAdjustmentReviewInput = {
  database: SmbaDatabase
  playerId: string
  completedOn: string
  lostFinalPresence: boolean
  now: Date
}

export type AttendanceAdjustmentReviewTarget =
  Omit<ReconcileAttendanceAdjustmentReviewInput, "database" | "now">

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

/*
 * Make-ups recorded before `completion_occurrence_id` existed name a date, not a
 * session, so each one stands for "one of the sessions the player attended that
 * day". Blocking the whole date whenever one exists stopped a player who trained
 * twice that day from using the second session at all. A date is full only
 * when every Present the player has on it is already spoken for -- by a dated
 * make-up or by one linked to an exact session.
 */
function legacyMakeupsFillCompletionDate(
  database: SmbaDatabaseExecutor,
  playerId: string,
  completedOn: string,
) {
  const sameDay = database.select({
    completionOccurrenceId: attendanceAdjustments.completionOccurrenceId,
  }).from(attendanceAdjustments).where(and(
    eq(attendanceAdjustments.playerId, playerId),
    eq(attendanceAdjustments.completedOn, completedOn),
    isNull(attendanceAdjustments.voidedAt),
  )).all()
  const legacyCount = sameDay.filter((item) => !item.completionOccurrenceId).length
  if (!legacyCount) return false
  const linkedCount = sameDay.length - legacyCount
  const presentSessions = database.select({ id: sessionAttendanceRecords.id })
    .from(sessionAttendanceRecords)
    .innerJoin(
      sessionOccurrences,
      eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId),
    ).where(and(
      eq(sessionAttendanceRecords.accountId, playerId),
      eq(sessionAttendanceRecords.choice, "present"),
      eq(sessionOccurrences.occurrenceDate, completedOn),
      eq(sessionOccurrences.status, "scheduled"),
    )).all().length
  return presentSessions - linkedCount - legacyCount < 1
}

function playerHasPresenceForAdjustment(
  database: SmbaDatabaseExecutor,
  adjustment: AttendanceAdjustmentRecord,
) {
  if (adjustment.completionOccurrenceId) {
    return Boolean(database.select({ id: sessionAttendanceRecords.id })
      .from(sessionAttendanceRecords).where(and(
        eq(sessionAttendanceRecords.accountId, adjustment.playerId),
        eq(sessionAttendanceRecords.occurrenceId, adjustment.completionOccurrenceId),
        eq(sessionAttendanceRecords.choice, "present"),
      )).get())
  }
  return Boolean(database.select({ id: sessionAttendanceRecords.id })
    .from(sessionAttendanceRecords)
    .innerJoin(
      sessionOccurrences,
      eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId),
    ).where(and(
      eq(sessionAttendanceRecords.accountId, adjustment.playerId),
      eq(sessionAttendanceRecords.choice, "present"),
      eq(sessionOccurrences.occurrenceDate, adjustment.completedOn),
    )).get())
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

      // A Present that proved one make-up and was later changed to Absent leaves
      // that make-up in review; the same session must not then also be offered
      // up as a fresh absence to make up.
      if (activeAdjustmentForCompletion(tx, playerId, sourceOccurrenceId)) {
        operationalActionError(
          "BUSINESS_RULE",
          "This session is where the player made up another missed session, so it cannot also be the missed session.",
          "sourceOccurrenceId",
        )
      }

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

      if (legacyMakeupsFillCompletionDate(tx, playerId, completedOn)) {
        operationalActionError(
          "CONFLICT",
          "An older make-up already uses this player's attendance on this date. Void it before using this session.",
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

    // `reviewRequiredAt` is left as it was: a voided make-up is never shown as
    // needing review, and keeping the stamp records that it was in review when
    // the coach voided it.
    return tx.update(attendanceAdjustments).set({
      voidedByAccountId: coachId,
      voidedAt: now,
    }).where(and(
      eq(attendanceAdjustments.id, adjustment.id),
      isNull(attendanceAdjustments.voidedAt),
    )).returning().get()
  }, { behavior: "immediate" })
}

/**
 * The way out of "Requires review" that keeps the player's credit. Until now a
 * flagged make-up could only be voided -- restoring the absence -- or cleared
 * as a side effect of re-saving a mark, and a holiday declared on the completed
 * date left no mark that could be re-saved, so the flag stayed for good.
 *
 * Keeping still needs the evidence a make-up rests on: a saved Present on the
 * session it was completed at (any Present that day for an older, date-only
 * make-up). Without it the coach is told to restore that mark or void.
 */
export function keepAttendanceAdjustment({
  adjustmentId,
  coachId,
  database = initializeDatabase(),
}: KeepAttendanceAdjustmentInput): AttendanceAdjustmentRecord {
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
      operationalActionError(
        "CONFLICT",
        "This make-up has already been voided.",
        "adjustmentId",
      )
    }
    if (!adjustment.reviewRequiredAt) return adjustment
    if (!playerHasPresenceForAdjustment(tx, adjustment)) {
      operationalActionError(
        "BUSINESS_RULE",
        "The player is no longer marked Present at the session this make-up was completed at. Mark them Present there again, or void the make-up.",
        "adjustmentId",
      )
    }

    return tx.update(attendanceAdjustments).set({ reviewRequiredAt: null })
      .where(and(
        eq(attendanceAdjustments.id, adjustment.id),
        isNull(attendanceAdjustments.voidedAt),
      )).returning().get()
  }, { behavior: "immediate" })
}

/*
 * One reconcile for a whole register instead of one per changed player. The
 * caller is `saveSessionAttendanceRecords`, which runs this inside `immediate`
 * while a coach waits courtside, and production speaks to libSQL over the
 * network with the synchronous driver: the per-pair version cost one blocking
 * round trip per (player, date) even when the player had no adjustment at all
 * -- measured 10 statements for a one-player save and 21 for twelve -- and a
 * player who did have one cost three.
 *
 * Each adjustment is judged only by whether its own completion session still
 * took place and holds a saved Present -- for the legacy rows that predate
 * `completion_occurrence_id`, by any Present on a session still running that
 * date -- and `lostFinalPresence` is still read per (player, date), never
 * shared across pairs. Reads may be hoisted above the writes because the only
 * column written, `reviewRequiredAt`, appears in no predicate here, and because
 * an adjustment row belongs to exactly one (playerId, completedOn) pair, so no
 * pair can see another pair's update.
 *
 * A make-up whose completion session has since been cancelled -- a holiday
 * declared on that day -- is left exactly as it is. The holiday put it in
 * review and only the coach can say whether the player trained: a Present
 * still sitting on the cancelled session must not quietly clear that, and a
 * coach's "Keep" must not be undone by an unrelated save on the same date.
 *
 * A make-up already in review keeps the time it was first flagged rather than
 * being re-stamped by every later save.
 */
export function reconcileAttendanceAdjustmentReviewStates({
  database,
  now,
  targets,
}: {
  database: SmbaDatabaseExecutor
  now: Date
  targets: readonly AttendanceAdjustmentReviewTarget[]
}) {
  const pairKey = (playerId: string, completedOn: string) => `${playerId}:${completedOn}`
  const lostFinalPresenceByPair = new Map(targets.map((target) => [
    pairKey(target.playerId, target.completedOn),
    target.lostFinalPresence,
  ]))
  if (!lostFinalPresenceByPair.size) return 0

  const playerIds = [...new Set(targets.map((target) => target.playerId))]
  const completedOnDates = [...new Set(targets.map((target) => target.completedOn))]

  // Two `in` lists are a cross product, so a register that changes player A on
  // one date and player B on another would otherwise sweep in A's adjustment
  // on B's date. Only pairs the caller actually asked for survive.
  const active = database.select().from(attendanceAdjustments).where(and(
    inArray(attendanceAdjustments.playerId, playerIds),
    inArray(attendanceAdjustments.completedOn, completedOnDates),
    isNull(attendanceAdjustments.voidedAt),
  )).all().filter((adjustment) => lostFinalPresenceByPair.has(
    pairKey(adjustment.playerId, adjustment.completedOn),
  ))
  if (!active.length) return 0

  // Two players can complete the same make-up session, so this is a set. One
  // statement answers both questions asked of each completion session: whether
  // it still took place, and which of these players hold a Present on it.
  const completionOccurrenceIds = [...new Set(
    active.map((adjustment) => adjustment.completionOccurrenceId)
      .filter((occurrenceId): occurrenceId is string => Boolean(occurrenceId)),
  )]
  const completionRows = completionOccurrenceIds.length
    ? database.select({
      accountId: sessionAttendanceRecords.accountId,
      occurrenceId: sessionOccurrences.id,
      status: sessionOccurrences.status,
    }).from(sessionOccurrences)
      .leftJoin(sessionAttendanceRecords, and(
        eq(sessionAttendanceRecords.occurrenceId, sessionOccurrences.id),
        eq(sessionAttendanceRecords.choice, "present"),
        inArray(sessionAttendanceRecords.accountId, playerIds),
      ))
      .where(inArray(sessionOccurrences.id, completionOccurrenceIds)).all()
    : []
  const cancelledCompletionIds = new Set(completionRows
    .filter((row) => row.status !== "scheduled")
    .map((row) => row.occurrenceId))
  const presenceByPlayerCompletion = new Set(completionRows.flatMap((row) => (
    row.status === "scheduled" && row.accountId
      ? [pairKey(row.accountId, row.occurrenceId)]
      : []
  )))

  const legacyCompletedOnDates = [...new Set(
    active.filter((adjustment) => !adjustment.completionOccurrenceId)
      .map((adjustment) => adjustment.completedOn),
  )]
  const presenceByPlayerDate = new Set(
    legacyCompletedOnDates.length
      ? database.select({
        accountId: sessionAttendanceRecords.accountId,
        occurrenceDate: sessionOccurrences.occurrenceDate,
      }).from(sessionAttendanceRecords)
        .innerJoin(
          sessionOccurrences,
          eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId),
        ).where(and(
          inArray(sessionAttendanceRecords.accountId, playerIds),
          eq(sessionAttendanceRecords.choice, "present"),
          eq(sessionOccurrences.status, "scheduled"),
          inArray(sessionOccurrences.occurrenceDate, legacyCompletedOnDates),
        )).all().map((row) => pairKey(row.accountId, row.occurrenceDate))
      : [],
  )

  const clearedIds: string[] = []
  const reviewRequiredIds: string[] = []
  active.forEach((adjustment) => {
    if (adjustment.completionOccurrenceId
      && cancelledCompletionIds.has(adjustment.completionOccurrenceId)) return
    const hasOrdinaryPresence = adjustment.completionOccurrenceId
      ? presenceByPlayerCompletion.has(
        pairKey(adjustment.playerId, adjustment.completionOccurrenceId),
      )
      : presenceByPlayerDate.has(pairKey(adjustment.playerId, adjustment.completedOn))
    if (hasOrdinaryPresence) {
      if (adjustment.reviewRequiredAt) clearedIds.push(adjustment.id)
      return
    }
    if (lostFinalPresenceByPair.get(pairKey(adjustment.playerId, adjustment.completedOn))
      && !adjustment.reviewRequiredAt) {
      reviewRequiredIds.push(adjustment.id)
    }
  })

  // The two sets are disjoint by construction -- an adjustment is judged once --
  // so the order these run in cannot decide a review state.
  let changes = 0
  if (clearedIds.length) {
    changes += database.update(attendanceAdjustments).set({ reviewRequiredAt: null })
      .where(inArray(attendanceAdjustments.id, clearedIds)).run().changes
  }
  if (reviewRequiredIds.length) {
    changes += database.update(attendanceAdjustments).set({ reviewRequiredAt: now })
      .where(inArray(attendanceAdjustments.id, reviewRequiredIds)).run().changes
  }
  return changes
}

export function reconcileAttendanceAdjustmentReviewState({
  completedOn,
  database,
  lostFinalPresence,
  now,
  playerId,
}: ReconcileAttendanceAdjustmentReviewInput) {
  return reconcileAttendanceAdjustmentReviewStates({
    database,
    now,
    targets: [{ completedOn, lostFinalPresence, playerId }],
  })
}
