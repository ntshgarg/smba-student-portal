import { describe, expect, it } from "vitest"

import {
  academyBatchesFor,
  academyPlanAssignmentLimit,
  academyPlanIsValid,
  academyPlanRequiredWeekdayCount,
  academyPlansFor,
} from "@/lib/training/academy-plans"

describe("Academy Plan guardrails", () => {
  it("keeps the public programme options informational and explicit", () => {
    expect(academyPlansFor("Beginner", "Weekday")).toEqual([
      "weekday-3-day",
      "weekday-4-day",
      "weekday-5-day",
    ])
    expect(academyPlansFor("Advanced", "Weekday")).toEqual(["weekday-5-day"])
    expect(academyPlansFor("Adult", "Weekend")).toEqual(["weekend-standard"])
  })

  it("defines exact Weekday coverage while keeping Weekend flexible", () => {
    expect(academyPlanAssignmentLimit("weekday-3-day")).toBe(3)
    expect(academyPlanAssignmentLimit("weekday-4-day")).toBe(4)
    expect(academyPlanAssignmentLimit("weekday-5-day")).toBe(5)
    expect(academyPlanAssignmentLimit("weekend-standard")).toBe(2)
    expect(academyPlanRequiredWeekdayCount("weekday-3-day")).toBe(3)
    expect(academyPlanRequiredWeekdayCount("weekday-4-day")).toBe(4)
    expect(academyPlanRequiredWeekdayCount("weekday-5-day")).toBe(5)
    expect(academyPlanRequiredWeekdayCount("weekend-standard")).toBeNull()
    expect(academyPlanIsValid("weekday-3-day", "Adult", "Weekday")).toBe(true)
    expect(academyPlanIsValid("weekday-3-day", "Advanced", "Weekday")).toBe(false)
  })
})

/*
 * Competitive players train five weekdays. Advanced used to offer a weekend plan
 * as well, and the weekend branch was tested before the level branch, so
 * Advanced + Weekend quietly resolved to it -- at a published price. Both levels
 * now decline the combination outright.
 */
describe("levels that train weekdays only", () => {
  it.each(["Advanced", "Elite"] as const)("offers %s the five-day weekday plan alone", (level) => {
    expect(academyBatchesFor(level)).toEqual(["Weekday"])
    expect(academyPlansFor(level, "Weekday")).toEqual(["weekday-5-day"])
    expect(academyPlanIsValid("weekday-5-day", level, "Weekday")).toBe(true)
    expect(academyPlanIsValid("weekday-3-day", level, "Weekday")).toBe(false)
  })

  it.each(["Advanced", "Elite"] as const)("refuses %s a weekend entirely", (level) => {
    // An empty list is what makes academyPlanIsValid reject the pair, so every
    // caller inherits the refusal without needing its own check.
    expect(academyPlansFor(level, "Weekend")).toEqual([])
    expect(academyPlanIsValid("weekend-standard", level, "Weekend")).toBe(false)
  })

  it("leaves the other levels on both schedules", () => {
    for (const level of ["Beginner", "Intermediate", "Adult"] as const) {
      expect(academyBatchesFor(level)).toEqual(["Weekday", "Weekend"])
      expect(academyPlansFor(level, "Weekend")).toEqual(["weekend-standard"])
    }
  })
})
