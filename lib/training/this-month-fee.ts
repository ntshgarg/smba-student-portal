import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import type { SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  chargeAdjustments,
  concessionApplications,
  concessions,
  financialAuditEvents,
} from "@/lib/db/schema"
import { calculateChargeLedger } from "@/lib/finance/domain"
import {
  SCHEDULE_CHANGE_CONCESSION_KEY,
  SCHEDULE_CHANGE_FEE_KEY,
  type ThisMonthFeeBasis,
} from "@/lib/training/this-month-fee-plan"

/*
 * Reads what lib/training/this-month-fee-plan.ts needs about this month's fees,
 * for a whole set of charges in three queries: the Members directory asks for
 * every player at once, and production reads are network round trips.
 *
 * The adjustments a schedule change posted are told apart by the idempotency
 * key on their audit event, which only that code writes; the adjustment rows
 * themselves carry no key.
 */
export function loadThisMonthFeeBases(
  database: SmbaDatabaseExecutor,
  charges: { feePaise: number; id: string; originalAmountPaise: number }[],
) {
  const bases = new Map<string, ThisMonthFeeBasis>()
  if (!charges.length) return bases
  const adjustments = database.select().from(chargeAdjustments).where(and(
    inArray(chargeAdjustments.chargeId, charges.map((charge) => charge.id)),
    isNull(chargeAdjustments.reversedAt),
  )).all()
  const adjustmentIds = adjustments.map((adjustment) => adjustment.id)
  const keys = new Map(adjustmentIds.length
    ? database.select({
      entityId: financialAuditEvents.entityId,
      idempotencyKey: financialAuditEvents.idempotencyKey,
    }).from(financialAuditEvents).where(and(
      eq(financialAuditEvents.entityType, "adjustment"),
      eq(financialAuditEvents.eventType, "adjustment_created"),
      inArray(financialAuditEvents.entityId, adjustmentIds),
    )).all().map((row) => [row.entityId, row.idempotencyKey ?? ""])
    : [])
  const percentageByAdjustment = new Map(adjustmentIds.length
    ? database.select({
      adjustmentId: concessionApplications.chargeAdjustmentId,
      value: concessions.value,
    }).from(concessionApplications)
      .innerJoin(concessions, eq(concessions.id, concessionApplications.concessionId))
      .where(and(
        inArray(concessionApplications.chargeAdjustmentId, adjustmentIds),
        isNull(concessionApplications.reversedAt),
        eq(concessions.valueKind, "percentage"),
      )).all().map((row) => [row.adjustmentId, row.value])
    : [])

  for (const charge of charges) {
    const own = adjustments.filter((adjustment) => adjustment.chargeId === charge.id)
    const signed = (adjustment: typeof own[number]) => (
      adjustment.kind === "manual_debit" ? adjustment.amountPaise : -adjustment.amountPaise
    )
    let grossPaise = charge.originalAmountPaise
    let percentageCreditPaise = 0
    const percentages: number[] = []
    for (const adjustment of own) {
      const key = keys.get(adjustment.id) ?? ""
      if (key.startsWith(SCHEDULE_CHANGE_FEE_KEY)) grossPaise += signed(adjustment)
      else if (key.startsWith(SCHEDULE_CHANGE_CONCESSION_KEY)) percentageCreditPaise -= signed(adjustment)
      const percentage = percentageByAdjustment.get(adjustment.id)
      if (adjustment.kind === "concession_credit" && percentage !== undefined) {
        percentages.push(percentage)
        percentageCreditPaise += adjustment.amountPaise
      }
    }
    const { effectiveAmountPaise } = calculateChargeLedger({
      adjustments: own,
      dueDate: "",
      lifecycle: "issued",
      originalAmountPaise: charge.originalAmountPaise,
      payments: [],
    })
    bases.set(charge.id, {
      amountPaise: effectiveAmountPaise,
      feePaise: charge.feePaise,
      grossPaise,
      percentages,
      percentageCreditPaise,
    })
  }
  return bases
}
