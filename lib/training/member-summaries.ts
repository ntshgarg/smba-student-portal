import "server-only"

import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm"

import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  concessions,
  feeAgreements,
  financialCharges,
  trainingChanges,
} from "@/lib/db/schema"
import { loadChargeViews } from "@/lib/finance/repository"
import { isFinanceActive } from "@/lib/finance/service"
import { getAcademyDateKey } from "@/lib/format"
import { nextMonthStartOf } from "@/lib/training/changes"
import { feeChangeStartsOn } from "@/lib/training/fees"
import { loadThisMonthFeeBases } from "@/lib/training/this-month-fee"
import type { ThisMonthFeeBasis } from "@/lib/training/this-month-fee-plan"

/*
 * What the Members directory shows on each player's record about their
 * training changes and fees, for every player in four queries rather than the
 * fee record page's per-player read: the directory lists dozens of players and
 * production reads are network round trips.
 */

export type MemberScheduledChange = {
  academyPlan: string | null
  batch: string | null
  effectiveOn: string
  id: string
  kind: "change" | "end"
  level: string | null
  monthlyFeePaise: number | null
  seriesId: string | null
  stopFees: boolean
  weekdays: number[]
}

export type MemberFeeSummary = {
  activeAgreementId: string | null
  activeAgreementRevision: number | null
  concession: {
    endsPeriod: string | null
    id: string
    revision: number
    startsPeriod: string | null
    value: number
    valueKind: "fixed" | "percentage"
  } | null
  /** The 1st of the month a fee change made today would start from. */
  feeChangeStartsOn: string
  monthlyFeePaise: number | null
  nextMonthFeePaise: number | null
  thisMonth: {
    amountPaise: number
    /**
     * What a level, batch or plan change this month would do to this month's
     * fee, for lib/training/this-month-fee-plan.ts. Null when no plan covers
     * the month.
     */
    basis: ThisMonthFeeBasis | null
    dueDate: string
    receivedPaise: number
  } | null
}

export type MemberTrainingSummary = {
  failed: { effectiveOn: string; reason: string } | null
  fee: MemberFeeSummary | null
  scheduled: MemberScheduledChange | null
}

export type MemberTrainingSummaries = {
  financeActive: boolean
  nextMonthStart: string
  summaries: Record<string, MemberTrainingSummary>
  today: string
}

function covers(
  agreement: { effectiveFrom: string; effectiveTo: string | null },
  dateKey: string,
) {
  return agreement.effectiveFrom <= dateKey && (!agreement.effectiveTo || agreement.effectiveTo >= dateKey)
}

export function listMemberTrainingSummaries(
  playerIds: string[],
  { database = initializeDatabase(), now = new Date() }: { database?: SmbaDatabaseExecutor; now?: Date } = {},
): MemberTrainingSummaries {
  const today = getAcademyDateKey(now)
  const nextMonthStart = nextMonthStartOf(today)
  const thisPeriod = today.slice(0, 7)
  const nextPeriod = nextMonthStart.slice(0, 7)
  const summaries: Record<string, MemberTrainingSummary> = {}
  for (const id of playerIds) summaries[id] = { failed: null, fee: null, scheduled: null }
  const financeActive = isFinanceActive(database)
  if (!playerIds.length) return { financeActive, nextMonthStart, summaries, today }

  const changes = database.select().from(trainingChanges).where(and(
    inArray(trainingChanges.playerAccountId, playerIds),
    inArray(trainingChanges.status, ["scheduled", "failed", "applied"]),
  )).orderBy(desc(trainingChanges.updatedAt)).all()
  const seen = new Set<string>()
  for (const change of changes) {
    const summary = summaries[change.playerAccountId]
    if (change.status === "scheduled") {
      summary.scheduled = {
        academyPlan: change.academyPlan,
        batch: change.batch,
        effectiveOn: change.effectiveOn,
        id: change.id,
        kind: change.kind,
        level: change.level,
        monthlyFeePaise: change.monthlyFeePaise,
        seriesId: change.seriesId,
        stopFees: change.stopFees,
        weekdays: JSON.parse(change.weekdays) as number[],
      }
      continue
    }
    // Only the most recent outcome matters: a failure that was followed by a
    // successful change is history, not something to show.
    if (seen.has(change.playerAccountId)) continue
    seen.add(change.playerAccountId)
    if (change.status === "failed") {
      summary.failed = {
        effectiveOn: change.effectiveOn,
        reason: change.failureReason ?? "The change could not be applied.",
      }
    }
  }

  if (!financeActive) return { financeActive, nextMonthStart, summaries, today }

  const agreements = database.select().from(feeAgreements).where(and(
    inArray(feeAgreements.playerAccountId, playerIds),
    ne(feeAgreements.status, "paused"),
    or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, today)),
  )).all()
  const charges = database.select({
    amountPaise: financialCharges.originalAmountPaise,
    dueDate: financialCharges.dueDate,
    id: financialCharges.id,
    playerId: financialCharges.playerAccountId,
  }).from(financialCharges).where(and(
    inArray(financialCharges.playerAccountId, playerIds),
    eq(financialCharges.type, "monthly_training"),
    eq(financialCharges.billingPeriod, thisPeriod),
    eq(financialCharges.lifecycle, "issued"),
  )).all()
  // Whether this month's fee has any payment decides what a schedule change
  // this month may alter (lib/training/changes.ts), so the form needs it.
  const chargeViews = loadChargeViews(database, charges.map((charge) => charge.id), now)
  const activeConcessions = database.select().from(concessions).where(and(
    inArray(concessions.playerAccountId, playerIds),
    eq(concessions.lifecycle, "active"),
    eq(concessions.mode, "recurring"),
    or(isNull(concessions.endsPeriod), gte(concessions.endsPeriod, nextPeriod)),
  )).all()

  const monthStart = `${thisPeriod}-01`
  const monthAgreements = !charges.length ? [] : database.select({
    agreedMonthlyFeePaise: feeAgreements.agreedMonthlyFeePaise,
    effectiveFrom: feeAgreements.effectiveFrom,
    effectiveTo: feeAgreements.effectiveTo,
    playerAccountId: feeAgreements.playerAccountId,
  }).from(feeAgreements).where(and(
    inArray(feeAgreements.playerAccountId, charges.map((charge) => charge.playerId)),
    ne(feeAgreements.status, "paused"),
  )).all()
  // The plan covering the 1st is the one a change this month corrects
  // (agreementsAround in lib/training/changes.ts).
  const feeBases = loadThisMonthFeeBases(database, charges.flatMap((charge) => {
    const covering = monthAgreements.find((agreement) => (
      agreement.playerAccountId === charge.playerId && covers(agreement, monthStart)
    ))
    return covering
      ? [{ feePaise: covering.agreedMonthlyFeePaise, id: charge.id, originalAmountPaise: charge.amountPaise }]
      : []
  }))

  for (const playerId of playerIds) {
    const own = agreements.filter((agreement) => agreement.playerAccountId === playerId)
    const current = own.find((agreement) => covers(agreement, today)) ?? null
    const next = own.find((agreement) => covers(agreement, nextMonthStart)) ?? null
    const active = own.find((agreement) => agreement.status === "active") ?? null
    const charge = charges.find((item) => item.playerId === playerId)
    const concession = activeConcessions.find((item) => item.playerAccountId === playerId)
    if (!current && !next && !active && !charge) continue
    const waiting = summaries[playerId].scheduled
    const scheduledFee = waiting?.kind === "change" ? waiting.monthlyFeePaise : null
    // Training that ends this month with its fees stopped has no fee next month.
    const feesStop = waiting?.kind === "end" && waiting.stopFees
    summaries[playerId].fee = {
      activeAgreementId: active?.id ?? null,
      activeAgreementRevision: active?.recordRevision ?? null,
      concession: concession
        ? {
          endsPeriod: concession.endsPeriod,
          id: concession.id,
          revision: concession.recordRevision,
          startsPeriod: concession.startsPeriod,
          value: concession.value,
          valueKind: concession.valueKind,
        }
        : null,
      feeChangeStartsOn: active
        ? feeChangeStartsOn({ activePlanFrom: active.effectiveFrom, thisMonthIssued: Boolean(charge), today })
        : nextMonthStart,
      monthlyFeePaise: current?.agreedMonthlyFeePaise ?? null,
      nextMonthFeePaise: feesStop ? null : scheduledFee ?? next?.agreedMonthlyFeePaise ?? null,
      thisMonth: charge
        ? {
          amountPaise: chargeViews.get(charge.id)?.effectiveAmountPaise ?? charge.amountPaise,
          basis: feeBases.get(charge.id) ?? null,
          dueDate: charge.dueDate,
          receivedPaise: chargeViews.get(charge.id)?.receivedPaise ?? 0,
        }
        : null,
    }
  }
  return { financeActive, nextMonthStart, summaries, today }
}
