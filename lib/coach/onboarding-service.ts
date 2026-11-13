import "server-only"

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"

import { operationalActionError } from "@/lib/actions/operational-result"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabase, SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  accounts,
  attendanceAdjustments,
  feeAgreements,
  financialCharges,
  payments,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionSeries,
  trainingChanges,
} from "@/lib/db/schema"
import { getAcademyDateKey } from "@/lib/format"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanIsValid,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

// What is recorded against players in onboarding, which stops their first schedule being cleared.
const RECORD_KINDS = [
  "marked attendance",
  "attendance correction",
  "Fee Plan",
  "fee",
  "payment",
] as const

export function readOnboardingRecords(
  database: SmbaDatabaseExecutor,
  playerIds: readonly string[],
) {
  const counts = new Map<string, Map<(typeof RECORD_KINDS)[number], number>>()
  if (!playerIds.length) return counts
  const add = (playerId: string, kind: (typeof RECORD_KINDS)[number]) => {
    const forPlayer = counts.get(playerId) ?? new Map()
    forPlayer.set(kind, (forPlayer.get(kind) ?? 0) + 1)
    counts.set(playerId, forPlayer)
  }
  database.select({ playerId: sessionAttendanceRecords.accountId }).from(sessionAttendanceRecords)
    .where(and(
      inArray(sessionAttendanceRecords.accountId, playerIds),
      ne(sessionAttendanceRecords.choice, "cleared"),
    )).all()
    .forEach(({ playerId }) => add(playerId, "marked attendance"))
  database.select({ playerId: attendanceAdjustments.playerId }).from(attendanceAdjustments)
    .where(and(
      inArray(attendanceAdjustments.playerId, playerIds),
      isNull(attendanceAdjustments.voidedAt),
    )).all()
    .forEach(({ playerId }) => add(playerId, "attendance correction"))
  database.select({ playerId: feeAgreements.playerAccountId }).from(feeAgreements)
    .where(inArray(feeAgreements.playerAccountId, playerIds)).all()
    .forEach(({ playerId }) => add(playerId, "Fee Plan"))
  database.select({ playerId: financialCharges.playerAccountId }).from(financialCharges)
    .where(inArray(financialCharges.playerAccountId, playerIds)).all()
    .forEach(({ playerId }) => add(playerId, "fee"))
  database.select({ playerId: payments.playerAccountId }).from(payments)
    .where(inArray(payments.playerAccountId, playerIds)).all()
    .forEach(({ playerId }) => add(playerId, "payment"))
  return counts
}

/** One player's records, in a fixed order, for naming them in a refusal. */
function onboardingRecordsFor(database: SmbaDatabaseExecutor, playerId: string) {
  const counts = readOnboardingRecords(database, [playerId]).get(playerId)
  return RECORD_KINDS.flatMap((label) => {
    const rows = counts?.get(label) ?? 0
    return rows ? [{ label, rows }] : []
  })
}

export type SaveOnboardingAssessmentInput = {
  academyPlan: AcademyPlan
  batch: TrainingBatch
  expectedRevision: number
  level: TrainingProgramme
  playerId: string
}

export function saveOnboardingAssessment({
  coachId,
  database,
  input,
  now = new Date(),
}: {
  coachId: string
  database: SmbaDatabase
  input: SaveOnboardingAssessmentInput
  now?: Date
}) {
  requireHeadAdminAccess(coachId, { database })
  if (!input?.playerId?.trim()) {
    operationalActionError("NOT_FOUND", "Player account was not found.", "playerId")
  }
  if (!academyPlanIsValid(input.academyPlan, input.level, input.batch)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a Training plan that matches the player’s level and batch.",
      "academyPlan",
    )
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    operationalActionError("CONFLICT", "Refresh this onboarding case and try again.")
  }

  return database.transaction((tx) => {
    const player = tx.select({
      academyPlan: playerEnrollments.academyPlan,
      approvalStatus: accounts.approvalStatus,
      archivedAt: accounts.archivedAt,
      batch: playerEnrollments.batch,
      level: playerEnrollments.level,
      onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
      recordRevision: playerEnrollments.recordRevision,
    }).from(accounts)
      .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
      .where(and(
        eq(accounts.id, input.playerId),
        eq(accounts.role, "player"),
      ))
      .get()
    if (!player || player.approvalStatus !== "approved" || player.archivedAt) {
      operationalActionError("NOT_FOUND", "Approved player was not found.", "playerId")
    }
    if (player.onboardingCompletedAt) {
      operationalActionError(
        "BUSINESS_RULE",
        "The training start date is permanent after onboarding is completed.",
        "trainingStartOn",
      )
    }
    if (player.recordRevision !== input.expectedRevision) {
      operationalActionError(
        "CONFLICT",
        "This onboarding case changed elsewhere. Refresh and try again.",
      )
    }

    /*
     * The date guard that used to stand here moved with the date itself, to
     * lib/sessions/service.ts. What stays is the classification: an assignment
     * is made against a specific programme and batch, so changing either out
     * from under it would leave the player rostered onto a schedule their plan
     * no longer matches. Clearing the assignment is the way through, and it is
     * one press away on the Session step.
     */
    const assignments = tx.select({
      effectiveFrom: sessionAssignments.effectiveFrom,
      effectiveTo: sessionAssignments.effectiveTo,
      seriesEndsOn: sessionSeries.endsOn,
      seriesStatus: sessionSeries.status,
    }).from(sessionAssignments)
      .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
      .where(eq(sessionAssignments.accountId, input.playerId))
      .orderBy(asc(sessionAssignments.effectiveFrom))
      .all()
    if (assignments.length && (
      player.level !== input.level
      || player.batch !== input.batch
      || player.academyPlan !== input.academyPlan
    )) {
      // Same rule as the Assessment step's lock; names the Session step's own button.
      const today = getAcademyDateKey(now)
      const running = assignments.some((assignment) => (
        assignment.effectiveTo === null
        && assignment.seriesStatus === "active"
        && (assignment.seriesEndsOn === null || assignment.seriesEndsOn >= today)
      ))
      operationalActionError(
        "BUSINESS_RULE",
        onboardingRecordsFor(tx, input.playerId).length
          ? "Level, batch and Training plan are fixed now that this player has a schedule with "
            + "attendance or fees recorded. Finish onboarding on the Fee Plan step, then change "
            + "them in Members."
          : "Level, batch and Training plan are fixed while this player has a schedule. Use "
            + `${running ? "Clear this assignment" : "Start again"} on the Session step first, `
            + "then change them here.",
        "academyPlan",
      )
    }

    const update = tx.update(playerEnrollments).set({
      academyPlan: input.academyPlan,
      batch: input.batch,
      level: input.level,
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(playerEnrollments.accountId, input.playerId),
      eq(playerEnrollments.recordRevision, input.expectedRevision),
      isNull(playerEnrollments.onboardingCompletedAt),
    )).run()
    if (update.changes !== 1) {
      operationalActionError(
        "CONFLICT",
        "This onboarding case changed elsewhere. Refresh and try again.",
      )
    }

    return {
      playerId: input.playerId,
      recordRevision: input.expectedRevision + 1,
    }
  }, { behavior: "immediate" })
}

export function resetOnboardingSessionAssignment({
  coachId,
  database,
  now = new Date(),
  playerId,
}: {
  coachId: string
  database: SmbaDatabase
  now?: Date
  playerId: string
}) {
  requireHeadAdminAccess(coachId, { database })
  if (!playerId?.trim()) {
    operationalActionError("NOT_FOUND", "Player account was not found.", "playerId")
  }

  return database.transaction((tx) => {
    const enrollment = tx.select({
      onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
    }).from(playerEnrollments)
      .where(eq(playerEnrollments.accountId, playerId))
      .get()
    if (!enrollment) {
      operationalActionError("NOT_FOUND", "Player account was not found.", "playerId")
    }
    if (enrollment.onboardingCompletedAt) {
      operationalActionError(
        "BUSINESS_RULE",
        "Completed onboarding assignments cannot be reset.",
        "playerId",
      )
    }

    /*
     * Naming the records matters more than counting them. "This assignment
     * already has academy records" told a coach that something, somewhere,
     * blocked them -- so a player held up by thirteen marked attendances read
     * identically to one held up by a single fee, and neither pointed anywhere.
     * The refusal is correct (deleting the assignment would orphan these rows);
     * it just has to say what it is protecting.
     */
    const blockingRecords = onboardingRecordsFor(tx, playerId)

    if (blockingRecords.length) {
      const named = blockingRecords
        .map(({ label, rows }) => `${rows} ${label}${rows === 1 ? "" : "s"}`)
        .join(", ")
        .replace(/, ([^,]*)$/u, " and $1")
      operationalActionError(
        "BUSINESS_RULE",
        `This player already has ${named} on record, and clearing their schedule would `
          + "leave them attached to nothing. Finish onboarding with this schedule on the Fee "
          + "Plan step, then change their schedule in Members.",
        "playerId",
      )
    }

    const assignments = tx.select({ id: sessionAssignments.id })
      .from(sessionAssignments)
      .where(eq(sessionAssignments.accountId, playerId))
      .all()
    if (!assignments.length) {
      operationalActionError("NOT_FOUND", "No unfinished assignment was found.", "playerId")
    }
    const assignmentIds = assignments.map(({ id }) => id)
    tx.delete(sessionAssignmentWeekdays)
      .where(inArray(sessionAssignmentWeekdays.assignmentId, assignmentIds))
      .run()
    tx.delete(sessionAssignments)
      .where(inArray(sessionAssignments.id, assignmentIds))
      .run()
    // A booking made in Members would otherwise land on a player with no schedule.
    tx.update(trainingChanges).set({ resolvedAt: now, status: "cancelled", updatedAt: now })
      .where(and(
        eq(trainingChanges.playerAccountId, playerId),
        eq(trainingChanges.status, "scheduled"),
      ))
      .run()
    tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      status: "unassigned",
      trainingStartConfirmedAt: null,
      trainingStartConfirmedByAccountId: null,
      updatedAt: now,
    }).where(and(
      eq(playerEnrollments.accountId, playerId),
      isNull(playerEnrollments.onboardingCompletedAt),
    )).run()

    return { playerId, removedAssignments: assignmentIds.length }
  }, { behavior: "immediate" })
}
