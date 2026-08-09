import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionIdentity } from "@/lib/auth/identity"
import type { CoachPublishedReportDetail } from "@/lib/reports/coach-archive"
import type { MonthlyReport } from "@/lib/types"

const mocks = vi.hoisted(() => ({
  coachPublishedReportAsMonthlyReport: vi.fn(),
  createMonthlyReportPdf: vi.fn(),
  getCoachPublishedReportDetail: vi.fn(),
  getCurrentIdentity: vi.fn(),
  requireHeadAdminAccess: vi.fn(),
}))

vi.mock("@/lib/auth/coach-access", () => ({
  requireHeadAdminAccess: mocks.requireHeadAdminAccess,
}))

vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))

vi.mock("@/lib/reports/coach-archive", () => ({
  coachPublishedReportAsMonthlyReport: mocks.coachPublishedReportAsMonthlyReport,
  getCoachPublishedReportDetail: mocks.getCoachPublishedReportDetail,
}))

vi.mock("@/lib/reports/pdf", () => ({
  createMonthlyReportPdf: mocks.createMonthlyReportPdf,
}))

import { GET } from "@/app/coach/reports/publications/[publicationId]/download/route"

const coach: SessionIdentity = {
  academyId: "SMBA#0001",
  firstName: "Sathiya",
  fullName: "Sathiya Moorthy",
  initials: "SM",
  role: "coach",
  subjectId: "coach-account",
}

const detail: CoachPublishedReportDetail = {
  publicationId: "publication-r2",
  reportId: "report-private",
  playerId: "player-private",
  playerName: "Aarav / Bhat\r\nInjected.pdf",
  academyId: "SMBA#0042",
  playerArchived: false,
  month: "2026-07",
  monthLabel: "July 2026",
  revision: 2,
  reportText: "Sensitive coach feedback must not appear in failures.",
  attendance: {
    absent: 1,
    attended: 7,
    eligible: 8,
    month: "July 2026",
    pending: 0,
    percentage: 88,
    recorded: 8,
  },
  publishedAt: "2026-08-02T04:30:00.000Z",
  publishedByAccountId: coach.subjectId,
  publishedByName: coach.fullName,
  revisions: [],
}

const pdfReport: MonthlyReport = {
  id: detail.reportId,
  month: detail.month,
  monthLabel: detail.monthLabel,
  publishedAt: detail.publishedAt,
  coachName: detail.publishedByName,
  reportText: detail.reportText,
  attendance: detail.attendance,
  development: [],
}

function download(publicationId = detail.publicationId) {
  return GET(new Request(`https://academy.example/coach/reports/publications/${publicationId}/download`), {
    params: Promise.resolve({ publicationId }),
  })
}

describe("protected coach publication downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(coach)
    mocks.requireHeadAdminAccess.mockReturnValue({ accessLevel: "head_admin" })
    mocks.getCoachPublishedReportDetail.mockReturnValue(detail)
    mocks.coachPublishedReportAsMonthlyReport.mockReturnValue(pdfReport)
    mocks.createMonthlyReportPdf.mockResolvedValue(Buffer.from("%PDF-private-publication"))
  })

  it("rejects guests and players before reading report data", async () => {
    mocks.getCurrentIdentity.mockResolvedValueOnce(null)
    const guest = await download()
    expect(guest.status).toBe(401)
    expect(guest.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getCoachPublishedReportDetail).not.toHaveBeenCalled()

    mocks.getCurrentIdentity.mockResolvedValueOnce({ ...coach, role: "player" })
    const player = await download()
    expect(player.status).toBe(401)
    expect(mocks.getCoachPublishedReportDetail).not.toHaveBeenCalled()
  })

  it("rejects junior coaches before reading report data", async () => {
    mocks.requireHeadAdminAccess.mockImplementationOnce(() => {
      throw new Error("Head coach access is required.")
    })
    const response = await download()
    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getCoachPublishedReportDetail).not.toHaveBeenCalled()
  })

  it("returns 404 when the exact publication does not exist", async () => {
    mocks.getCoachPublishedReportDetail.mockReturnValueOnce(null)
    const response = await download("missing-publication")
    expect(response.status).toBe(404)
    expect(mocks.getCoachPublishedReportDetail).toHaveBeenCalledWith(
      coach.subjectId,
      "missing-publication",
    )
    expect(mocks.createMonthlyReportPdf).not.toHaveBeenCalled()
  })

  it("downloads the exact revision with a safe private filename", async () => {
    const response = await download()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="SMBA-Aarav-Bhat-Injected-pdf-2026-07-Report-R2.pdf"',
    )
    expect(mocks.getCoachPublishedReportDetail).toHaveBeenCalledWith(
      coach.subjectId,
      detail.publicationId,
    )
    expect(mocks.createMonthlyReportPdf).toHaveBeenCalledWith(pdfReport, detail.playerName)
  })

  it("returns a generic private error without exposing report content", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.createMonthlyReportPdf.mockRejectedValueOnce(new Error("PDF failed"))

    const response = await download()
    const body = await response.text()
    const logs = JSON.stringify(consoleError.mock.calls)
    expect(response.status).toBe(500)
    expect(body).toBe("Unable to generate report.")
    expect(body).not.toContain(detail.reportText)
    expect(logs).not.toContain(detail.reportText)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    consoleError.mockRestore()
  })
})
