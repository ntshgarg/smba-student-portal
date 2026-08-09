import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createMonthlyReportPdf,
  paginateMonthlyReportText,
} from "@/lib/reports/pdf"
import type { MonthlyReport } from "@/lib/types"

function reportWithText(reportText: string): MonthlyReport {
  return {
    attendance: {
      absent: 2,
      attended: 10,
      eligible: 14,
      month: "2026-07",
      pending: 2,
      percentage: 83,
      recorded: 12,
    },
    coachName: "Sathiya Moorthy",
    development: [],
    id: "report-pdf-regression",
    month: "2026-07",
    monthLabel: "July 2026",
    publishedAt: "2026-08-01T12:00:00.000+05:30",
    reportText,
  }
}

const sentence = "Focused footwork, composed decisions, and patient recovery between rallies. "

describe("monthly report PDF pagination", () => {
  it("keeps a short report on the branded first page", async () => {
    const reportText = `${sentence.repeat(5).trim()}\n\nThe next month should build on this calm base.`
    const pages = paginateMonthlyReportText(reportText)
    const pdf = await createMonthlyReportPdf(reportWithText(reportText), "Aarav Bhat")

    expect(pages).toEqual([reportText])
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  it("splits at a word boundary when the first page reaches capacity", () => {
    const reportText = sentence.repeat(17).trim()
    const pages = paginateMonthlyReportText(reportText)

    expect(pages).toHaveLength(2)
    expect(pages.join("")).toBe(reportText)
    expect(pages[0]).toMatch(/\s$/u)
    expect(pages.every((page) => page.length > 0)).toBe(true)
  })

  it("preserves every character exactly once across a 5,000-character report", async () => {
    const reportText = sentence.repeat(80).slice(0, 5_000)
    const pages = paginateMonthlyReportText(reportText)
    const pdf = await createMonthlyReportPdf(reportWithText(reportText), "Aarav Bhat")

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.join("")).toBe(reportText)
    expect(pages.every((page) => page.length > 0)).toBe(true)
    expect(pdf.byteLength).toBeGreaterThan(10_000)
  })

  it("keeps a long player name within continuation-page metadata", async () => {
    const reportText = sentence.repeat(17).trim()
    const playerName = "Aarav Srinivasa Venkata Narasimha Subramanian Krishnamurthy"
    const pdf = await createMonthlyReportPdf(reportWithText(reportText), playerName)

    expect(paginateMonthlyReportText(reportText)).toHaveLength(2)
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  it("normalizes platform newlines without duplicating report copy", () => {
    const reportText = `First paragraph.${"\r\n"}\r\nSecond paragraph.`
    const pages = paginateMonthlyReportText(reportText)

    expect(pages.join("")).toBe("First paragraph.\n\nSecond paragraph.")
  })
})

describe("private report artifact boundary", () => {
  it("does not expose generated report PDFs through the public directory", () => {
    const publicReports = path.join(process.cwd(), "public", "reports")
    const publicFiles = existsSync(publicReports) ? readdirSync(publicReports) : []
    const pdfFiles = publicFiles.filter((fileName) => (
      fileName.toLocaleLowerCase("en-IN").endsWith(".pdf")
    ))

    expect(pdfFiles).toEqual([])
  })
})
