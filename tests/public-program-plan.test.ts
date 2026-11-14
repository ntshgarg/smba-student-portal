// The homepage planner's price for every level, schedule and days-a-week choice, checked against the fee
// table the academy bills from.
import { describe, expect, it } from "vitest"

import { monthlyFeePaise } from "@/lib/finance/config"
import { programPlan, trainingPrograms } from "@/lib/public/academy"

describe("homepage program planner", () => {
  it("prices every weekday choice from the fee table", () => {
    for (const { title } of trainingPrograms) {
      const plan = programPlan(title, "weekday", 3)
      for (const days of plan.frequencies) {
        const chosen = programPlan(title, "weekday", days)
        const key = `weekday-${days}-day` as keyof (typeof monthlyFeePaise)[typeof title]
        expect(chosen.fee * 100).toBe(monthlyFeePaise[title][key])
        expect(chosen.sessions).toBe(days)
        expect(chosen.onWeekend).toBe(false)
      }
    }
  })

  it("prices weekends as two sessions from the fee table", () => {
    for (const title of ["Beginner", "Intermediate", "Adult"] as const) {
      const plan = programPlan(title, "weekend", 4)
      expect(plan.onWeekend).toBe(true)
      expect(plan.sessions).toBe(2)
      expect(plan.fee * 100).toBe(monthlyFeePaise[title]["weekend-standard"])
    }
  })

  it("keeps Advanced on its one weekday plan whatever was chosen before", () => {
    const plan = programPlan("Advanced", "weekend", 3)
    expect(plan.hasWeekend).toBe(false)
    expect(plan.onWeekend).toBe(false)
    expect(plan.frequencies).toEqual([5])
    expect(plan.daysAWeek).toBe(5)
    expect(plan.fee * 100).toBe(monthlyFeePaise.Advanced["weekday-5-day"])
  })

  it("never shows a zero price", () => {
    for (const { title } of trainingPrograms) {
      for (const schedule of ["weekday", "weekend"] as const) {
        for (const days of [3, 4, 5]) expect(programPlan(title, schedule, days).fee).toBeGreaterThan(0)
      }
    }
  })
})
