import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { feePlanCovers, feePlanInForce } from "@/lib/finance/plan-in-force"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-plan-in-force-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-plan-in-force.db")

/*
 * "Which fee plan applies on this date" was worked out in several places, and
 * "active" was easy to mistake for it. One rule now, in two forms: code
 * (feePlanCovers) and a query condition (feePlanCoversCondition). These pin
 * the rule and prove the two forms agree on every case.
 */
const plans = [
  // November's plan, closed on its last day by a fee change...
  { id: "november", effectiveFrom: "2026-11-01", effectiveTo: "2026-11-30", status: "ended" },
  // ...and the change, "active" but only from December.
  { id: "december", effectiveFrom: "2026-12-01", effectiveTo: null, status: "active" },
  // A plan that never started never applies.
  { id: "never", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31", status: "paused" },
] as const

const dates = ["2026-10-15", "2026-11-01", "2026-11-15", "2026-11-30", "2026-12-01", "2027-03-01"]

describe("the fee plan in force", () => {
  it("is the plan whose days include the date, last day included, whatever is marked active", () => {
    expect(feePlanInForce(plans, "2026-11-15")?.id).toBe("november")
    expect(feePlanInForce(plans, "2026-11-30")?.id).toBe("november")
    expect(feePlanInForce(plans, "2026-12-01")?.id).toBe("december")
    expect(feePlanInForce(plans, "2026-10-15")).toBeNull()
  })

  describe("as a query condition", () => {
    let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
    let schema: typeof import("@/lib/db/schema")
    let condition: typeof import("@/lib/finance/plan-in-force")["feePlanCoversCondition"]
    const playerId = "plan-in-force-player"
    const coachId = "00000000-0000-4000-8000-000000000001"

    beforeAll(async () => {
      schema = await import("@/lib/db/schema")
      condition = (await import("@/lib/finance/plan-in-force")).feePlanCoversCondition
      const { prepareDatabase } = await import("@/lib/db/setup")
      database = prepareDatabase({ seed: true })
      const at = new Date("2026-10-01T10:00:00+05:30")
      database.insert(schema.accounts).values({
        approvalStatus: "approved",
        approvedAt: at,
        approvedByAccountId: coachId,
        createdAt: at,
        fullName: "Plan Rule",
        id: playerId,
        normalizedName: "plan rule",
        requestedRole: "player",
        role: "player",
        updatedAt: at,
      }).run()
      for (const plan of plans) {
        database.insert(schema.feeAgreements).values({
          academyPlan: "weekday-3-day",
          agreedMonthlyFeePaise: 350_000,
          batch: "Weekday",
          createdAt: at,
          createdByAccountId: coachId,
          effectiveFrom: plan.effectiveFrom,
          effectiveTo: plan.effectiveTo,
          id: plan.id,
          level: "Beginner",
          playerAccountId: playerId,
          status: plan.status,
          updatedAt: at,
          updatedByAccountId: coachId,
        }).run()
      }
    })

    afterAll(() => {
      fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    })

    // The overlap check used by creating, restoring and issuing a plan is the
    // same rule over a range of days; each copy it replaced spelled it as below.
    it.each([
      ["2026-10-01", null],
      ["2026-11-01", "2026-11-30"],
      ["2026-11-30", "2026-12-01"],
      ["2026-12-02", null],
      ["2026-09-01", "2026-09-30"],
    ] as const)("finds the plans in force from %s to %s", async (from, to) => {
      const overlaps = (await import("@/lib/finance/plan-in-force")).feePlanOverlapsCondition
      const fromQuery = database.select({ id: schema.feeAgreements.id }).from(schema.feeAgreements)
        .where(and(eq(schema.feeAgreements.playerAccountId, playerId), overlaps(from, to)))
        .all().map((row) => row.id).sort()
      const handWritten = plans.filter((plan) => plan.status !== "paused"
        && (to === null || plan.effectiveFrom <= to)
        && (plan.effectiveTo === null || plan.effectiveTo >= from)).map((plan) => plan.id).sort()
      expect(fromQuery).toEqual(handWritten)
    })

    it.each(dates)("agrees with the code on %s", (dateKey) => {
      const fromQuery = database.select({ id: schema.feeAgreements.id }).from(schema.feeAgreements)
        .where(and(eq(schema.feeAgreements.playerAccountId, playerId), condition(dateKey)))
        .all().map((row) => row.id).sort()
      const fromCode = plans.filter((plan) => feePlanCovers(plan, dateKey)).map((plan) => plan.id).sort()
      expect(fromQuery).toEqual(fromCode)
    })
  })
})
