import { describe, expect, it } from "vitest"

import {
  groupReportsByYear,
  reportYearFromMonth,
} from "@/lib/reports/archive"

describe("player report archive", () => {
  it("groups report months into newest-first year chapters", () => {
    const reports = [
      { id: "2025-12", month: "2025-12" },
      { id: "2026-01", month: "2026-01" },
      { id: "2025-11", month: "2025-11" },
      { id: "2026-07", month: "2026-07" },
    ]

    expect(groupReportsByYear(reports)).toEqual([
      {
        year: "2026",
        reports: [
          { id: "2026-07", month: "2026-07" },
          { id: "2026-01", month: "2026-01" },
        ],
      },
      {
        year: "2025",
        reports: [
          { id: "2025-12", month: "2025-12" },
          { id: "2025-11", month: "2025-11" },
        ],
      },
    ])
  })

  it("uses the report month rather than the publication date", () => {
    expect(reportYearFromMonth("2025-12")).toBe("2025")
  })

  it("keeps unexpected legacy records in a final Earlier chapter", () => {
    expect(groupReportsByYear([
      { id: "current", month: "2026-07" },
      { id: "legacy", month: "July" },
    ])).toEqual([
      { year: "2026", reports: [{ id: "current", month: "2026-07" }] },
      { year: "Earlier", reports: [{ id: "legacy", month: "July" }] },
    ])
  })
})
