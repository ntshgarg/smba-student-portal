import { describe, expect, it } from "vitest"

import {
  getCoachReportArchiveHref,
  getCoachReportPublicationHref,
  getLegacyCoachReportWriterHref,
  nextCoachReportArchiveShown,
  normalizeCoachReportArchiveQuery,
  normalizeCoachReportArchiveReturnShown,
  normalizeCoachReportArchiveShown,
  resolveCoachReportArchivePeriod,
} from "@/lib/coach/report-navigation"

describe("coach report navigation", () => {
  it("moves legacy month and player editor links to Write Reports", () => {
    expect(getLegacyCoachReportWriterHref({
      month: "2026-07",
      player: "player / one",
    })).toBe("/coach/reports/write?month=2026-07&player=player+%2F+one")
  })

  it("keeps Published Reports period and search queries on the archive route", () => {
    expect(getLegacyCoachReportWriterHref({
      period: "2026-07",
      q: "Aarav",
    })).toBeNull()
  })

  it("canonicalizes legacy links containing either editor parameter", () => {
    expect(getLegacyCoachReportWriterHref({ month: "2026-07" }))
      .toBe("/coach/reports/write?month=2026-07")
    expect(getLegacyCoachReportWriterHref({ player: "player-1" }))
      .toBe("/coach/reports/write?player=player-1")
  })

  it("defaults invalid or future archive periods to the latest completed month", () => {
    expect(resolveCoachReportArchivePeriod(undefined, "2026-07")).toBe("2026-07")
    expect(resolveCoachReportArchivePeriod("not-a-month", "2026-07")).toBe("2026-07")
    expect(resolveCoachReportArchivePeriod("2026-08", "2026-07")).toBe("2026-07")
    expect(resolveCoachReportArchivePeriod("2026-06", "2026-07")).toBe("2026-06")
  })

  it("normalizes and bounds archive search text", () => {
    expect(normalizeCoachReportArchiveQuery("  Aarav   Bhat  ")).toBe("Aarav Bhat")
    expect(normalizeCoachReportArchiveQuery("x".repeat(120))).toHaveLength(100)
  })

  it("validates, steps, and clamps progressive report depths", () => {
    expect(normalizeCoachReportArchiveShown(undefined, 30)).toBe(10)
    expect(normalizeCoachReportArchiveShown("invalid", 30)).toBe(10)
    expect(normalizeCoachReportArchiveShown("1", 30)).toBe(10)
    expect(normalizeCoachReportArchiveShown("17", 30)).toBe(10)
    expect(normalizeCoachReportArchiveShown("20", 30)).toBe(20)
    expect(normalizeCoachReportArchiveShown("999", 30)).toBe(30)
    expect(normalizeCoachReportArchiveShown("999", 25)).toBe(25)
    expect(normalizeCoachReportArchiveShown("20", 7)).toBe(7)
    expect(normalizeCoachReportArchiveShown("20", 0)).toBe(0)
    expect(nextCoachReportArchiveShown(10, 25)).toBe(20)
    expect(nextCoachReportArchiveShown(20, 25)).toBe(25)
  })

  it("preserves only a validated revealed depth in archive and detail links", () => {
    expect(getCoachReportArchiveHref({
      period: "2026-07",
      query: "Aditi Rao",
      shown: 20,
    })).toBe("/coach/reports?period=2026-07&q=Aditi+Rao&shown=20")
    expect(getCoachReportArchiveHref({ period: "2026-07", shown: 10 }))
      .toBe("/coach/reports?period=2026-07")
    expect(getCoachReportPublicationHref("publication / 1", {
      period: "2026-07",
      query: "Aditi Rao",
      shown: 20,
    })).toBe(
      "/coach/reports/publications/publication%20%2F%201?period=2026-07&q=Aditi+Rao&shown=20",
    )
    expect(normalizeCoachReportArchiveReturnShown("20")).toBe(20)
    expect(normalizeCoachReportArchiveReturnShown("10")).toBeNull()
    expect(normalizeCoachReportArchiveReturnShown("not-a-number")).toBeNull()
  })
})
