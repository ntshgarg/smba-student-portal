import { describe, expect, it } from "vitest"

import {
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
