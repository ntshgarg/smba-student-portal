import { describe, expect, it } from "vitest"

import { formatReportMonth, getCoachReportState, shiftReportMonth } from "@/lib/coach/report-utils"
import type { CoachMonthlyReportRecord } from "@/lib/coach/types"

const publishedReport: CoachMonthlyReportRecord = {
  id: "report-1",
  playerId: "player-1",
  month: "2026-07",
  reportText: "Published feedback.",
  nextPriorities: "Published priority.",
  updatedAt: "2026-07-31T18:30:00+05:30",
  published: {
    reportText: "Published feedback.",
    nextPriorities: "Published priority.",
    publishedAt: "2026-07-31T18:30:00+05:30",
    updatedAt: "2026-07-31T18:30:00+05:30",
    revision: 1,
  },
}

describe("coach report utilities", () => {
  it("moves cleanly across year boundaries", () => {
    expect(shiftReportMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftReportMonth("2026-12", 1)).toBe("2027-01")
    expect(formatReportMonth("2026-07")).toBe("July 2026")
  })

  it("distinguishes published feedback from a pending revision", () => {
    expect(getCoachReportState(publishedReport)).toBe("published")
    expect(getCoachReportState({
      ...publishedReport,
      reportText: "A revised working copy.",
    })).toBe("revision")
    expect(getCoachReportState({
      ...publishedReport,
      published: null,
    })).toBe("draft")
    expect(getCoachReportState()).toBe("not-started")
  })
})
