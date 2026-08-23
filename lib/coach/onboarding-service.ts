import "server-only"

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"

import { operationalActionError } from "@/lib/actions/operational-result"
import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabase } from "@/lib/db/client"
import {
  accounts,
  attendanceAdjustments,
  feeAgreements,
  financialCharges,
  monthlyReports,
  payments,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
} from "@/lib/db/schema"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanIsValid,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

export type SaveOnboardingAssessmentInput = {
  academyPlan: AcademyPlan
  batch: TrainingBatch
  expectedRevision: number
  level: TrainingProgramme
  playerId: string
  trainingStartOn: string
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
  if (!isValidDateKey(input.trainingStartOn)) {
    operationalActionError("INVALID_INPUT", "Choose a valid training start date.", "trainingStartOn")
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

    const assignments = tx.select({
      effectiveFrom: sessionAssignments.effectiveFrom,
    }).from(sessionAssignments)
      .where(and(
        eq(sessionAssignments.accountId, input.playerId),
        isNull(sessionAssignments.effectiveTo),
      ))
      .orderBy(asc(sessionAssignments.effectiveFrom))
      .all()
    const earliestAssignment = assignments[0]
    if (earliestAssignment && input.trainingStartOn > earliestAssignment.effectiveFrom) {
      operationalActionError(
        "BUSINESS_RULE",
        "Reset the unfinished session assignment before moving the training start date later.",
        "trainingStartOn",
      )
    }
    if (assignments.length && (
      player.level !== input.level
      || player.batch !== input.batch
      || player.academyPlan !== input.academyPlan
    )) {
      operationalActionError(
        "BUSINESS_RULE",
        "Reset the unfinished session assignment before changing the assessment.",
        "academyPlan",
      )
    }

    const update = tx.update(playerEnrollments).set({
      academyPlan: input.academyPlan,
      batch: input.batch,
      level: input.level,
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      trainingStartConfirmedAt: now,
      trainingStartConfirmedByAccountId: coachId,
      trainingStartOn: input.trainingStartOn,
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
      trainingStartOn: input.trainingStartOn,
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

    const dependencyExists = Boolean(
      tx.select({ id: sessionAttendanceRecords.id }).from(sessionAttendanceRecords)
        .where(eq(sessionAttendanceRecords.accountId, playerId)).get()
      || tx.select({ id: attendanceAdjustments.id }).from(attendanceAdjustments)
        .where(eq(attendanceAdjustments.playerId, playerId)).get()
      || tx.select({ id: feeAgreements.id }).from(feeAgreements)
        .where(eq(feeAgreements.playerAccountId, playerId)).get()
      || tx.select({ id: financialCharges.id }).from(financialCharges)
        .where(eq(financialCharges.playerAccountId, playerId)).get()
      || tx.select({ id: payments.id }).from(payments)
        .where(eq(payments.playerAccountId, playerId)).get()
      || tx.select({ id: monthlyReports.id }).from(monthlyReports)
        .where(eq(monthlyReports.accountId, playerId)).get()
    )
    if (dependencyExists) {
      operationalActionError(
        "BUSINESS_RULE",
        "This assignment already has academy records and cannot be reset.",
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
