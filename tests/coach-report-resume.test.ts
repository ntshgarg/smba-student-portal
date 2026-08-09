import { describe, expect, it } from "vitest"

import {
  parseReportResumePoint,
  persistReportResumePoint,
  REPORT_RESUME_STORAGE_KEY,
  shouldPersistResumeForDirtyTransition,
} from "@/components/coach/reports/report-resume"

describe("coach report resume preference", () => {
  it("preserves the existing storage key and round-trips a resume point", () => {
    const writes = new Map<string, string>()
    const resumePoint = { month: "2026-07", playerId: "player-1" }

    persistReportResumePoint({
      setItem(key, value) {
        writes.set(key, value)
      },
    }, resumePoint)

    expect(REPORT_RESUME_STORAGE_KEY).toBe("smba-coach-report-resume-v1")
    expect(parseReportResumePoint(writes.get(REPORT_RESUME_STORAGE_KEY) ?? null))
      .toEqual(resumePoint)
  })

  it("ignores unavailable or malformed stored preferences", () => {
    expect(parseReportResumePoint(null)).toBeNull()
    expect(parseReportResumePoint("not-json")).toBeNull()
    expect(parseReportResumePoint(JSON.stringify({ month: "2026-07" }))).toBeNull()
  })

  it("persists dirty resume state only on the clean-to-dirty transition", () => {
    expect(shouldPersistResumeForDirtyTransition(false, true)).toBe(true)
    expect(shouldPersistResumeForDirtyTransition(true, true)).toBe(false)
    expect(shouldPersistResumeForDirtyTransition(true, false)).toBe(false)
    expect(shouldPersistResumeForDirtyTransition(false, false)).toBe(false)
  })
})
