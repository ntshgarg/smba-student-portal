import "server-only"

import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import { operationalActionError } from "@/lib/actions/operational-result"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { initializeDatabase, type SmbaDatabase } from "@/lib/db/client"
import {
  feeAgreements,
  financialCharges,
  playerEnrollments,
  trainingChanges,
} from "@/lib/db/schema"
import {
  FinanceServiceError,
  correctFeeAgreementInTransaction,
  createConcession,
  createFeeAgreementInTransaction,
  isFinanceActive,
  reverseConcession,
} from "@/lib/finance/service"
import { getAcademyDateKey } from "@/lib/format"
import { monthStartOf, nextMonthStartOf } from "@/lib/training/changes"

/*
 * Fee changes and concessions made from a player's record in Members. The head
 * coach's rule (23 Sept 2026, kept on 5 Oct): a new fee and a concession start
 * with next month's fee, and fees already issued never change. The one
 * exception is a fee change made on the 1st before that month's fee is issued,
 * which can still take that month.
 */

type FeeContext = {
  coachId: string
  createId?: () => string
  database?: SmbaDatabase
  now?: Date
}

const CONCESSION_REASON = "Concession from the head coach"

function rethrow(error: unknown): never {
  if (error instanceof FinanceServiceError) operationalActionError("BUSINESS_RULE", error.message)
  throw error
}

function monthLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC", year: "numeric" })
    .format(new Date(`${dateKey.slice(0, 7)}-01T00:00:00Z`))
}

export function changeMonthlyFee(
  input: { idempotencyKey: string; monthlyFeePaise: number; playerId: string },
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: FeeContext,
) {
  requireHeadAdminAccess(coachId, { database })
  try {
    return database.transaction((tx) => {
      if (!isFinanceActive(tx)) operationalActionError("BUSINESS_RULE", "Financial tracking is not switched on.")
      const waiting = tx.select({ effectiveOn: trainingChanges.effectiveOn }).from(trainingChanges).where(and(
        eq(trainingChanges.playerAccountId, input.playerId),
        eq(trainingChanges.status, "scheduled"),
        eq(trainingChanges.kind, "change"),
      )).get()
      if (waiting) {
        operationalActionError(
          "CONFLICT",
          `This player's training changes on ${waiting.effectiveOn} with its own fee. Edit that change instead.`,
        )
      }
      const enrollment = tx.select().from(playerEnrollments)
        .where(eq(playerEnrollments.accountId, input.playerId)).get()
      if (!enrollment?.level || !enrollment.batch || !enrollment.academyPlan) {
        operationalActionError("BUSINESS_RULE", "Set this player's level, batch and plan first.")
      }
      const today = getAcademyDateKey(now)
      const thisMonth = monthStartOf(today)
      const active = tx.select().from(feeAgreements).where(and(
        eq(feeAgreements.playerAccountId, input.playerId),
        eq(feeAgreements.status, "active"),
      )).get()
      if (!active) {
        operationalActionError("BUSINESS_RULE", "This player has no fee plan yet. Complete onboarding first.")
      }
      const thisMonthIssued = Boolean(tx.select({ id: financialCharges.id }).from(financialCharges).where(and(
        eq(financialCharges.playerAccountId, input.playerId),
        eq(financialCharges.type, "monthly_training"),
        eq(financialCharges.billingPeriod, thisMonth.slice(0, 7)),
        eq(financialCharges.lifecycle, "issued"),
      )).get())
      const startsOn = today === thisMonth && !thisMonthIssued && active.effectiveFrom < thisMonth
        ? thisMonth
        : nextMonthStartOf(today)

      if (active.effectiveFrom >= startsOn) {
        // A fee change for that month is already waiting; change its amount.
        correctFeeAgreementInTransaction(tx, {
          academyPlan: enrollment.academyPlan,
          agreedMonthlyFeePaise: input.monthlyFeePaise,
          agreementId: active.id,
          batch: enrollment.batch,
          level: enrollment.level,
          reason: `Fee changed from ${monthLabel(startsOn)}`,
        }, { actorId: coachId, createId, now })
      } else {
        createFeeAgreementInTransaction(tx, {
          academyPlan: enrollment.academyPlan,
          agreedMonthlyFeePaise: input.monthlyFeePaise,
          batch: enrollment.batch,
          effectiveFrom: startsOn,
          expectedAgreementRevision: active.recordRevision,
          idempotencyKey: input.idempotencyKey,
          level: enrollment.level,
          playerId: input.playerId,
        }, { actorId: coachId, createId, now })
      }
      return { startsOn }
    }, { behavior: "immediate" })
  } catch (error) {
    return rethrow(error)
  }
}

export type GiveConcessionInput = {
  duration: "one" | "months" | "open"
  months?: number
  mutationId: string
  playerId: string
  value: number
  valueKind: "fixed" | "percentage"
}

function addMonths(period: string, count: number) {
  const [year, month] = period.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1 + count, 1)).toISOString().slice(0, 7)
}

export function giveConcession(
  input: GiveConcessionInput,
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: FeeContext,
) {
  requireHeadAdminAccess(coachId, { database })
  const startsPeriod = nextMonthStartOf(getAcademyDateKey(now)).slice(0, 7)
  let endsPeriod: string | undefined
  if (input.duration === "one") endsPeriod = startsPeriod
  if (input.duration === "months") {
    const months = Number(input.months)
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      operationalActionError("INVALID_INPUT", "Choose between 1 and 24 months.", "months")
    }
    endsPeriod = addMonths(startsPeriod, months - 1)
  }
  if (input.valueKind === "percentage"
    && (!Number.isInteger(input.value) || input.value < 1 || input.value > 100)) {
    operationalActionError("INVALID_INPUT", "Enter a whole percentage from 1 to 100.", "value")
  }
  try {
    const result = createConcession({
      endsPeriod,
      mode: "recurring",
      mutationId: input.mutationId,
      playerId: input.playerId,
      reason: CONCESSION_REASON,
      startsPeriod,
      value: input.valueKind === "percentage" ? input.value * 100 : input.value,
      valueKind: input.valueKind,
    }, { coachId, createId, database, now })
    return { concessionId: result.concession.id, endsPeriod: endsPeriod ?? null, startsPeriod }
  } catch (error) {
    return rethrow(error)
  }
}

export function stopConcession(
  input: { concessionId: string; expectedRevision: number; mutationId: string },
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: FeeContext,
) {
  requireHeadAdminAccess(coachId, { database })
  try {
    reverseConcession({
      concessionId: input.concessionId,
      expectedConcessionRevision: input.expectedRevision,
      mutationId: input.mutationId,
      reason: "Stopped by the head coach",
    }, { coachId, createId, database, now })
  } catch (error) {
    rethrow(error)
  }
}
