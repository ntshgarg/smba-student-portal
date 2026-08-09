import "server-only"

import { randomUUID } from "node:crypto"

import { and, eq, isNotNull, isNull, like, max } from "drizzle-orm"

import { getPlayerAttendanceInput } from "@/lib/attendance/database"
import { createAttendanceSnapshotV4 } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabase } from "@/lib/db/client"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  attendanceAdjustments,
  monthlyReports,
  playerEnrollments,
  reportPublications,
  sessionOccurrences,
} from "@/lib/db/schema"
import { getAcademyDateKey, getAcademyMonthKey } from "@/lib/format"
import {
  REPORT_TEXT_MAX_LENGTH,
  type PublishReportInput,
  type ReportMutationCode,
  type ReportMutationField,
  type SaveReportDraftInput,
} from "@/lib/reports/contracts"

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class ReportServiceError extends Error {
  readonly code: ReportMutationCode
  readonly field?: ReportMutationField

  constructor(
    code: ReportMutationCode,
    message: string,
    field?: ReportMutationField,
  ) {
    super(message)
    this.name = "ReportServiceError"
    this.code = code
    this.field = field
  }
}

type ReportServiceContext = {
  coachId: string
  createId?: () => string
  database?: SmbaDatabase
  now?: Date
}

export type ReportServiceResult = {
  publicationId?: string
  reportId: string
  reusedPublication: boolean
  revision?: number
}

function validateSharedInput(input: SaveReportDraftInput, now: Date) {
  if (!input.playerId.trim()) {
    throw new ReportServiceError("INVALID_INPUT", "Choose a player.", "playerId")
  }
  if (!MONTH_PATTERN.test(input.month)) {
    throw new ReportServiceError("INVALID_INPUT", "Choose a valid report month.", "month")
  }
  if (input.month >= getAcademyMonthKey(now)) {
    throw new ReportServiceError(
      "INVALID_INPUT",
      "Reports can be prepared only for completed months.",
      "month",
    )
  }
  if (input.reportText.length > REPORT_TEXT_MAX_LENGTH) {
    throw new ReportServiceError(
      "INVALID_INPUT",
      `Coach feedback cannot exceed ${REPORT_TEXT_MAX_LENGTH.toLocaleString("en-IN")} characters.`,
      "reportText",
    )
  }
}

function requireActivePlayer(
  database: Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0],
  playerId: string,
) {
  const player = database.select({ id: accounts.id })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(
      eq(accounts.id, playerId),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
      eq(playerEnrollments.status, "active"),
    ))
    .get()
  if (!player) {
    throw new ReportServiceError(
      "PLAYER_UNAVAILABLE",
      "Reports are available only for active players.",
      "playerId",
    )
  }
}

function upsertDraft(
  database: Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0],
  input: SaveReportDraftInput,
  coachId: string,
  now: Date,
  createId: () => string,
) {
  return database.insert(monthlyReports).values({
    id: createId(),
    accountId: input.playerId,
    month: input.month,
    draftText: input.reportText,
    updatedByAccountId: coachId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [monthlyReports.accountId, monthlyReports.month],
    set: {
      draftText: input.reportText,
      updatedByAccountId: coachId,
      updatedAt: now,
    },
  }).returning({ id: monthlyReports.id }).get().id
}

export function saveMonthlyReportDraft(
  input: SaveReportDraftInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: ReportServiceContext,
): ReportServiceResult {
  requireHeadAdminAccess(coachId, { database })
  validateSharedInput(input, now)

  return database.transaction((tx) => {
    requireActivePlayer(tx, input.playerId)
    const reportId = upsertDraft(tx, input, coachId, now, createId)
    return { reportId, reusedPublication: false }
  }, { behavior: "immediate" })
}

export function publishMonthlyReport(
  input: PublishReportInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: ReportServiceContext,
): ReportServiceResult {
  requireHeadAdminAccess(coachId, { database })
  validateSharedInput(input, now)
  const reportText = input.reportText.trim()
  if (!reportText) {
    throw new ReportServiceError(
      "INVALID_INPUT",
      "Write the coach’s report before publishing.",
      "reportText",
    )
  }
  if (!UUID_PATTERN.test(input.publicationKey)) {
    throw new ReportServiceError(
      "INVALID_INPUT",
      "The publication request is invalid. Please try again.",
    )
  }

  return database.transaction((tx) => {
    const existingPublication = tx.select({
      accountId: monthlyReports.accountId,
      month: monthlyReports.month,
      publicationId: reportPublications.id,
      reportId: monthlyReports.id,
      reportText: reportPublications.reportText,
      revision: reportPublications.revision,
    }).from(reportPublications)
      .innerJoin(monthlyReports, eq(monthlyReports.id, reportPublications.reportId))
      .where(eq(reportPublications.publicationKey, input.publicationKey))
      .get()

    if (existingPublication) {
      if (existingPublication.accountId !== input.playerId
        || existingPublication.month !== input.month
        || existingPublication.reportText !== reportText) {
        throw new ReportServiceError(
          "PUBLICATION_CONFLICT",
          "This publication request was already used for different report content.",
        )
      }
      return {
        publicationId: existingPublication.publicationId,
        reportId: existingPublication.reportId,
        reusedPublication: true,
        revision: existingPublication.revision,
      }
    }

    requireActivePlayer(tx, input.playerId)
    const requiresAdjustmentReview = Boolean(tx.select({ id: attendanceAdjustments.id })
      .from(attendanceAdjustments)
      .innerJoin(
        sessionOccurrences,
        eq(sessionOccurrences.id, attendanceAdjustments.sourceOccurrenceId),
      )
      .where(and(
        eq(attendanceAdjustments.playerId, input.playerId),
        isNull(attendanceAdjustments.voidedAt),
        isNotNull(attendanceAdjustments.reviewRequiredAt),
        like(sessionOccurrences.occurrenceDate, `${input.month}-%`),
      ))
      .get())
    if (requiresAdjustmentReview && !input.confirmAdjustmentReview) {
      throw new ReportServiceError(
        "ADJUSTMENT_REVIEW_REQUIRED",
        "Review-required attendance adjustments must be confirmed before publishing.",
      )
    }

    const reportId = upsertDraft(
      tx,
      { ...input, reportText },
      coachId,
      now,
      createId,
    )
    const latest = tx.select({ revision: max(reportPublications.revision) })
      .from(reportPublications)
      .where(eq(reportPublications.reportId, reportId))
      .get()
    const revision = (latest?.revision ?? 0) + 1
    const referenceInstant = now.toISOString()
    const attendanceInput = getPlayerAttendanceInput(
      input.playerId,
      input.month,
      getAcademyDateKey(now),
      referenceInstant,
      tx,
    )
    if (!attendanceInput) {
      throw new ReportServiceError(
        "PLAYER_UNAVAILABLE",
        "Player attendance could not be calculated.",
        "playerId",
      )
    }
    const attendanceSnapshot = createAttendanceSnapshotV4({
      ...attendanceInput,
      referenceInstant,
    })
    const publicationId = createId()

    tx.insert(reportPublications).values({
      id: publicationId,
      reportId,
      publicationKey: input.publicationKey,
      revision,
      reportText,
      attendanceSnapshot: JSON.stringify(attendanceSnapshot),
      publishedByAccountId: coachId,
      publishedAt: now,
    }).run()

    return {
      publicationId,
      reportId,
      reusedPublication: false,
      revision,
    }
  }, { behavior: "immediate" })
}
