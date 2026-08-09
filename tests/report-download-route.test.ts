import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionIdentity } from "@/lib/auth/identity"
import type { MonthlyReport } from "@/lib/types"

const mocks = vi.hoisted(() => ({
  createMonthlyReportPdf: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getReport: vi.fn(),
}))

vi.mock("@/lib/data", () => ({
  portalRepository: {
    getReport: mocks.getReport,
  },
  sessionProvider: {
    getCurrentIdentity: mocks.getCurrentIdentity,
  },
}))

vi.mock("@/lib/reports/pdf", () => ({
  createMonthlyReportPdf: mocks.createMonthlyReportPdf,
}))

import { GET } from "@/app/(student)/player/reports/[reportId]/download/route"

const playerIdentity: SessionIdentity = {
  academyId: "SMBA#0002",
  firstName: "Aarav",
  fullName: "Aarav Bhat",
  initials: "AB",
  role: "player",
  subjectId: "player-account",
}

const report: MonthlyReport = {
  attendance: {
    absent: 1,
    attended: 7,
    eligible: 8,
    month: "2026-07",
    pending: 0,
    percentage: 88,
    recorded: 8,
  },
  coachName: "Sathiya Moorthy",
  development: [],
  id: "report-1",
  month: "2026-07",
  monthLabel: "July 2026",
  publishedAt: "2026-08-01T12:00:00.000+05:30",
  reportText: "Sensitive player feedback that must never appear in an error response.",
}

function downloadReport(reportId = report.id) {
  return GET(new Request(`https://academy.example/player/reports/${reportId}/download`), {
    params: Promise.resolve({ reportId }),
  })
}

describe("protected monthly report download", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(playerIdentity)
    mocks.getReport.mockResolvedValue(report)
    mocks.createMonthlyReportPdf.mockResolvedValue(Buffer.from("%PDF-private-report"))
  })

  it("rejects guests and coaches before reading a player report", async () => {
    mocks.getCurrentIdentity.mockResolvedValueOnce(null)
    const guestResponse = await downloadReport()

    expect(guestResponse.status).toBe(401)
    expect(guestResponse.headers.get("cache-control")).toBe("private, no-store")
    expect(guestResponse.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getReport).not.toHaveBeenCalled()

    mocks.getCurrentIdentity.mockResolvedValueOnce({
      ...playerIdentity,
      role: "coach",
      subjectId: "coach-account",
    })
    const coachResponse = await downloadReport()

    expect(coachResponse.status).toBe(401)
    expect(coachResponse.headers.get("cache-control")).toBe("private, no-store")
    expect(coachResponse.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getReport).not.toHaveBeenCalled()
  })

  it("returns 404 when the authenticated player does not own the report", async () => {
    mocks.getReport.mockResolvedValueOnce(null)
    const response = await downloadReport("another-player-report")

    expect(response.status).toBe(404)
    expect(mocks.getReport).toHaveBeenCalledWith(
      playerIdentity.subjectId,
      "another-player-report",
    )
    expect(mocks.createMonthlyReportPdf).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("serves the owned report as a private attachment with hardened headers", async () => {
    const response = await downloadReport()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="SMBA-Aarav-Bhat-July-2026-Report.pdf"',
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getReport).toHaveBeenCalledWith(playerIdentity.subjectId, report.id)
    expect(mocks.createMonthlyReportPdf).toHaveBeenCalledWith(report, playerIdentity.fullName)
  })

  it("returns a generic private 500 without exposing report content", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.createMonthlyReportPdf.mockRejectedValueOnce(new Error("PDF generation failed"))

    const response = await downloadReport()
    const responseBody = await response.text()
    const loggedArguments = JSON.stringify(consoleError.mock.calls)

    expect(response.status).toBe(500)
    expect(responseBody).toBe("Unable to generate report.")
    expect(responseBody).not.toContain(report.reportText)
    expect(loggedArguments).not.toContain(report.reportText)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    consoleError.mockRestore()
  })
})
