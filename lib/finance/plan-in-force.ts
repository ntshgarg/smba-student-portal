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

/**
 * A plan in force on any day from `from` to `to` (both included; a null `to`
 * runs on with no end), as a query condition on fee_agreements. Plans must
 * never overlap, so this is also the overlap check: a plan made, reopened or
 * restored over these days must find no other plan of the player through it.
 */
export function feePlanOverlapsCondition(from: string, to: string | null) {
  return and(
    ne(feeAgreements.status, "paused"),
    to === null ? undefined : lte(feeAgreements.effectiveFrom, to),
    or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, from)),
  )
}

/** feePlanCovers as a query condition on fee_agreements. */
export function feePlanCoversCondition(dateKey: string) {
  return feePlanOverlapsCondition(dateKey, dateKey)
}
