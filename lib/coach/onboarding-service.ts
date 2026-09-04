import "server-only"

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"

import { operationalActionError } from "@/lib/actions/operational-result"
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
    }).from(sessionAssignments)
      .where(eq(sessionAssignments.accountId, input.playerId))
      .orderBy(asc(sessionAssignments.effectiveFrom))
      .all()
    if (assignments.length && (
      player.level !== input.level
      || player.batch !== input.batch
      || player.academyPlan !== input.academyPlan
    )) {
      operationalActionError(
        "BUSINESS_RULE",
        "Clear the player’s session assignment on the Session step before changing the assessment.",
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
    const blockingRecords = [
      {
        label: "marked attendance",
        rows: tx.select({ id: sessionAttendanceRecords.id }).from(sessionAttendanceRecords)
          .where(eq(sessionAttendanceRecords.accountId, playerId)).all().length,
      },
      {
        label: "attendance correction",
        rows: tx.select({ id: attendanceAdjustments.id }).from(attendanceAdjustments)
          .where(eq(attendanceAdjustments.playerId, playerId)).all().length,
      },
      {
        label: "Fee Plan",
        rows: tx.select({ id: feeAgreements.id }).from(feeAgreements)
          .where(eq(feeAgreements.playerAccountId, playerId)).all().length,
      },
      {
        label: "fee",
        rows: tx.select({ id: financialCharges.id }).from(financialCharges)
          .where(eq(financialCharges.playerAccountId, playerId)).all().length,
      },
      {
        label: "payment",
        rows: tx.select({ id: payments.id }).from(payments)
          .where(eq(payments.playerAccountId, playerId)).all().length,
      },
      {
        label: "monthly report",
        rows: tx.select({ id: monthlyReports.id }).from(monthlyReports)
          .where(eq(monthlyReports.accountId, playerId)).all().length,
      },
    ].filter(({ rows }) => rows > 0)

    if (blockingRecords.length) {
      const named = blockingRecords
        .map(({ label, rows }) => `${rows} ${label}${rows === 1 ? "" : "s"}`)
        .join(", ")
        .replace(/, ([^,]*)$/u, " and $1")
      operationalActionError(
        "BUSINESS_RULE",
        `This player already has ${named} on record, and resetting would leave `
          + "them attached to nothing. Change the schedule from the Calendar instead.",
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
