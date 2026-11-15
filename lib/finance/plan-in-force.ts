import { and, gte, isNull, lte, ne, or } from "drizzle-orm"

import { feeAgreements } from "@/lib/db/schema"

/*
 * Which fee plan applies on a date. One rule, written twice only because one
 * copy runs in a database query and the other in code
 * (tests/fee-plan-in-force.test.ts proves they agree):
 *
 * - a paused plan never applies: it never started and never bills;
 * - otherwise a plan applies from its first day to its last day, both
 *   included (effective_to is the LAST day covered -- unlike a schedule
 *   place, whose effective_to is the first day off it);
 * - "active" is not the test. The active plan is the latest one, which after a
 *   fee change starts next month, while this month's plan is "ended" on its
 *   last day and still in force until then.
 */
type PlanDates = { effectiveFrom: string; effectiveTo: string | null; status: string }

export function feePlanCovers(plan: PlanDates, dateKey: string) {
  return plan.status !== "paused"
    && plan.effectiveFrom <= dateKey
    && (plan.effectiveTo === null || plan.effectiveTo >= dateKey)
}

/** The plan in force on a date, among one player's plans. Plans never overlap, so there is at most one. */
export function feePlanInForce<Plan extends PlanDates>(plans: readonly Plan[], dateKey: string): Plan | null {
  return plans.find((plan) => feePlanCovers(plan, dateKey)) ?? null
}

/** feePlanCovers as a query condition on fee_agreements. */
export function feePlanCoversCondition(dateKey: string) {
  return and(
    ne(feeAgreements.status, "paused"),
    lte(feeAgreements.effectiveFrom, dateKey),
    or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, dateKey)),
  )
}
