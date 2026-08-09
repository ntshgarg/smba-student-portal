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
})
