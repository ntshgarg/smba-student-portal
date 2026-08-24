import { beforeEach, describe, expect, it, vi } from "vitest"

const { getCurrentIdentity, getCollectionsDayBook, requireHeadAdminAccess } = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  getCollectionsDayBook: vi.fn(),
  requireHeadAdminAccess: vi.fn(),
}))

vi.mock("@/lib/auth/coach-access", () => ({ requireHeadAdminAccess }))

vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity },
}))

vi.mock("@/lib/finance/service", async () => {
  class FinanceServiceError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
  return { FinanceServiceError, getCollectionsDayBook }
})

import { GET } from "@/app/coach/financials/collections.csv/route"

describe("financial collections export route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentIdentity.mockResolvedValue({
      subjectId: "coach-1",
      fullName: "Coach",
      role: "coach",
    })
    requireHeadAdminAccess.mockReturnValue({ accessLevel: "head_admin" })
  })

  it("rejects an authenticated junior coach before querying finance", async () => {
    requireHeadAdminAccess.mockImplementationOnce(() => {
      throw new Error("Head coach access is required.")
    })

    const response = await GET(new Request(
      "http://localhost/coach/financials/collections.csv?from=2026-08-01&to=2026-08-31",
    ))

    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(getCollectionsDayBook).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated and player requests before querying finance", async () => {
    getCurrentIdentity.mockResolvedValueOnce(null)
    const guest = await GET(new Request("http://localhost/coach/financials/collections.csv"))
    expect(guest.status).toBe(401)
    expect(getCollectionsDayBook).not.toHaveBeenCalled()

    getCurrentIdentity.mockResolvedValueOnce({ subjectId: "player-1", role: "player" })
    const player = await GET(new Request("http://localhost/coach/financials/collections.csv"))
    expect(player.status).toBe(401)
    expect(getCollectionsDayBook).not.toHaveBeenCalled()
  })

  it("returns a private streamed CSV for the authenticated coach", async () => {
    getCollectionsDayBook.mockReturnValue({
      events: [{
        id: "payment-42",
        academyId: "SMBA#0042",
        amountPaise: 350_000,
        coveredFeeReferences: ["SMBA-A1"],
        eventDate: "2026-08-08",
        eventType: "payment",
        lifecycle: "recorded",
        method: "upi",
        playerId: "player-42",
        playerFullName: "Aarav Bhat",
        recordedAt: "2026-08-08T04:30:00.000Z",
        reference: "SMBA-R-2026-00042",
      }],
      summary: {
        grossReceivedPaise: 350_000,
        refundsPaise: 0,
        netCollectionsPaise: 350_000,
        byMethod: {},
      },
      nextCursor: null,
    })

    const response = await GET(new Request(
      "http://localhost/coach/financials/collections.csv?from=2026-08-01&to=2026-08-31",
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-disposition")).toContain("smba-collections-2026-08-01-to-2026-08-31.csv")
    expect(await response.text()).toContain("SMBA-R-2026-00042")
    expect(getCollectionsDayBook).toHaveBeenCalledWith(
      { from: "2026-08-01", to: "2026-08-31", includeReversed: false, limit: 100 },
      { coachId: "coach-1" },
    )
  })

  // F-17: the day book is drained as the stream is pulled, so a page that fails
  // after the first one lands with 200 and the filename already sent. A coach
  // reconciling the day's cash must be able to tell a short file from a quiet
  // day, and the only place left to say so is the file.
  it("ends a collections export that stops mid-stream with a notice the coach can read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    getCollectionsDayBook
      .mockReturnValueOnce({
        events: [{
          id: "payment-42",
          academyId: "SMBA#0042",
          amountPaise: 350_000,
          coveredFeeReferences: ["SMBA-A1"],
          eventDate: "2026-08-08",
          eventType: "payment",
          lifecycle: "recorded",
          method: "upi",
          playerId: "player-42",
          playerFullName: "Aarav Bhat",
          recordedAt: "2026-08-08T04:30:00.000Z",
          reference: "SMBA-R-2026-00042",
        }],
        summary: {},
        nextCursor: "payment-42",
      })
      .mockImplementationOnce(() => {
        throw new Error("SQLITE_BUSY: database is locked")
      })

    const response = await GET(new Request(
      "http://localhost/coach/financials/collections.csv?from=2026-08-01&to=2026-08-31",
    ))
    const rows = (await response.text()).split("\r\n").filter(Boolean)

    expect(response.status).toBe(200)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain("SMBA-R-2026-00042")
    expect(rows[2]).toContain("EXPORT INCOMPLETE")
    expect(consoleError).toHaveBeenCalledWith(
      "Financial collections export stopped before its last row.",
      expect.objectContaining({ from: "2026-08-01", rowsWritten: 1, to: "2026-08-31" }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause)).toContain("SQLITE_BUSY")

    consoleError.mockRestore()
  })
})
