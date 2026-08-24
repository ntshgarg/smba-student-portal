import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  FinanceActivityItem,
  FinanceRegisterRow,
} from "@/lib/finance/types"

const mocks = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  getFeeRegister: vi.fn(),
  getFinancialActivity: vi.fn(),
  requireHeadAdminAccess: vi.fn(),
}))

vi.mock("@/lib/auth/coach-access", () => ({
  requireHeadAdminAccess: mocks.requireHeadAdminAccess,
}))

vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))

vi.mock("@/lib/finance/service", () => ({
  FinanceServiceError: class FinanceServiceError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  getFeeRegister: mocks.getFeeRegister,
  getFinancialActivity: mocks.getFinancialActivity,
}))

import { GET as downloadActivity } from "@/app/coach/financials/records/activity.csv/route"
import { GET as downloadFeeRegister } from "@/app/coach/financials/records/fees.csv/route"
import { FinanceServiceError } from "@/lib/finance/service"

const coach = {
  subjectId: "coach-1",
  fullName: "Sathiya Moorthy",
  role: "coach",
}

const registerRow: FinanceRegisterRow = {
  academyId: "SMBA#0042",
  archived: false,
  billingPeriod: "2026-08",
  chargeId: "charge-1",
  creditAdjustmentsPaise: 10_000,
  debitAdjustmentsPaise: 0,
  dueDate: "2026-08-05",
  effectiveAmountPaise: 340_000,
  feeReference: "SMBA-2A4C6E8G",
  fullName: "=HYPERLINK(\"https://example.invalid\")",
  originalAmountPaise: 350_000,
  outstandingPaise: 140_000,
  playerId: "player-42",
  receivedPaise: 200_000,
  status: "partially_paid",
  type: "monthly_training",
}

const activityItem: FinanceActivityItem = {
  academyId: "SMBA#0042",
  action: "=WEBSERVICE(\"https://example.invalid\")",
  actorId: "coach-1",
  actorName: "Sathiya Moorthy",
  amountPaise: 350_000,
  eventType: "payment_recorded",
  id: "event-1",
  occurredAt: "2026-08-08T01:30:00.000Z",
  playerId: "player-42",
  playerName: "Aarav Bhat",
  reason: "@external reference",
  reference: "SMBA-R-2026-00042",
}

describe("Financials Phase 3 record export routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(coach)
    mocks.requireHeadAdminAccess.mockReturnValue({ accessLevel: "head_admin" })
  })

  it("rejects an authenticated junior coach before querying record exports", async () => {
    mocks.requireHeadAdminAccess.mockImplementation(() => {
      throw new Error("Head coach access is required.")
    })

    const feeResponse = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=2026-08",
    ))
    const activityResponse = await downloadActivity(new Request(
      "https://academy.example/coach/financials/records/activity.csv",
    ))

    expect(feeResponse.status).toBe(403)
    expect(activityResponse.status).toBe(403)
    expect(mocks.getFeeRegister).not.toHaveBeenCalled()
    expect(mocks.getFinancialActivity).not.toHaveBeenCalled()
  })

  it("rejects guests and players before querying either record export", async () => {
    mocks.getCurrentIdentity.mockResolvedValueOnce(null)
    const guest = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=2026-08",
    ))
    expect(guest.status).toBe(401)
    expect(guest.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getFeeRegister).not.toHaveBeenCalled()

    mocks.getCurrentIdentity.mockResolvedValueOnce({ subjectId: "player-1", role: "player" })
    const player = await downloadActivity(new Request(
      "https://academy.example/coach/financials/records/activity.csv",
    ))
    expect(player.status).toBe(401)
    expect(player.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getFinancialActivity).not.toHaveBeenCalled()
  })

  it("streams every fee-register page with private headers and formula-safe cells", async () => {
    mocks.getFeeRegister
      .mockReturnValueOnce({
        nextCursor: "player-42",
        rows: [registerRow],
        summary: {},
      })
      .mockReturnValueOnce({
        nextCursor: null,
        rows: [{
          ...registerRow,
          academyId: "SMBA#0043",
          fullName: "+SUM(1,1)",
          playerId: "player-43",
        }],
        summary: {},
      })

    const response = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=2026-08&scope=all&status=partially_paid&q=Aarav",
    ))
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="smba-fee-register-2026-08.csv"',
    )
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+SUM(1,1)")
    expect(csv).toContain("SMBA#0042")
    expect(csv).toContain("SMBA#0043")
    expect(mocks.getFeeRegister).toHaveBeenNthCalledWith(1, {
      limit: 100,
      mode: "monthly",
      period: "2026-08",
      playerScope: "all",
      query: "Aarav",
      statuses: ["partially_paid"],
    }, { coachId: coach.subjectId })
    expect(mocks.getFeeRegister).toHaveBeenNthCalledWith(2, {
      cursor: "player-42",
      limit: 100,
      mode: "monthly",
      period: "2026-08",
      playerScope: "all",
      query: "Aarav",
      statuses: ["partially_paid"],
    }, { coachId: coach.subjectId })
  })

  it("streams every activity page with filters, private headers, and formula safety", async () => {
    mocks.getFinancialActivity
      .mockReturnValueOnce({ items: [activityItem], nextCursor: "event-1" })
      .mockReturnValueOnce({
        items: [{
          ...activityItem,
          action: "Refund recorded",
          eventType: "refund_recorded",
          id: "event-2",
          reason: "-unsafe note",
          reference: "SMBA-RF-2026-00001",
        }],
        nextCursor: null,
      })

    const response = await downloadActivity(new Request(
      "https://academy.example/coach/financials/records/activity.csv?from=2026-08-01&to=2026-08-31&eventType=payment_recorded&coachId=coach-2&q=Aarav",
    ))
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="smba-financial-activity.csv"',
    )
    expect(csv).toContain("'=WEBSERVICE")
    expect(csv).toContain("'@external reference")
    expect(csv).toContain("'-unsafe note")
    expect(csv).toContain("SMBA-RF-2026-00001")
    expect(mocks.getFinancialActivity).toHaveBeenNthCalledWith(1, {
      coachId: "coach-2",
      eventTypes: ["payment_recorded"],
      from: "2026-08-01",
      limit: 100,
      query: "Aarav",
      to: "2026-08-31",
    }, { coachId: coach.subjectId })
    expect(mocks.getFinancialActivity).toHaveBeenNthCalledWith(2, {
      coachId: "coach-2",
      cursor: "event-1",
      eventTypes: ["payment_recorded"],
      from: "2026-08-01",
      limit: 100,
      query: "Aarav",
      to: "2026-08-31",
    }, { coachId: coach.subjectId })
  })

  // The finance service's refusals are conclusions, not faults, and the shared
  // handler must keep answering them with the service's own status and wording.
  it("passes a finance refusal through with its own status and message", async () => {
    mocks.getFeeRegister.mockImplementationOnce(() => {
      throw new FinanceServiceError("AUTHORIZATION", "Head coach access is required.")
    })
    mocks.getFinancialActivity.mockImplementationOnce(() => {
      throw new FinanceServiceError("FINANCE_NOT_ACTIVE", "Financial tracking has not been activated.")
    })

    const feeResponse = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=2026-08",
    ))
    const activityResponse = await downloadActivity(new Request(
      "https://academy.example/coach/financials/records/activity.csv",
    ))

    expect(feeResponse.status).toBe(403)
    expect(await feeResponse.text()).toBe("Head coach access is required.")
    expect(activityResponse.status).toBe(400)
    expect(await activityResponse.text()).toBe("Financial tracking has not been activated.")
    for (const response of [feeResponse, activityResponse]) {
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }
  })

  // IQ-3: an unexpected fault stays opaque to the caller and is now diagnosable
  // in the log, which is the whole point of the shared failure handler.
  it("answers an unexpected fault with a private 500 that logs its cause", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getFeeRegister.mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked")
    })

    const response = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=2026-08",
    ))

    expect(response.status).toBe(500)
    expect(await response.text()).toBe("Unable to generate the fee-register export.")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(consoleError).toHaveBeenCalledWith(
      "Financial fee-register export failed.",
      expect.objectContaining({ mode: "monthly", period: "2026-08" }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause)).toContain("SQLITE_BUSY")

    consoleError.mockRestore()
  })

  // F-17: only the first page is read inside the handler's `try`. A page that
  // fails after that arrives once 200 and the filename are on the wire, so the
  // coach ends up with a file that looks complete and is not. Both exports must
  // say so in their own last row.
  it("ends a fee-register export that stops mid-stream with a notice the coach can read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getFeeRegister
      .mockReturnValueOnce({ nextCursor: "player-42", rows: [registerRow], summary: {} })
      .mockImplementationOnce(() => {
        throw new Error("SQLITE_BUSY: database is locked")
      })

    const response = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=registration",
    ))
    const rows = (await response.text()).split("\r\n").filter(Boolean)

    expect(response.status).toBe(200)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain("SMBA#0042")
    expect(rows[2]).toContain("EXPORT INCOMPLETE")
    expect(rows[2]).toContain("stopped after 1 row")
    expect(consoleError).toHaveBeenCalledWith(
      "Financial fee-register export stopped before its last row.",
      expect.objectContaining({ mode: "registration", rowsWritten: 1 }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause)).toContain("SQLITE_BUSY")

    consoleError.mockRestore()
  })

  it("ends an activity export that stops mid-stream with the same notice", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getFinancialActivity
      .mockReturnValueOnce({ items: [activityItem], nextCursor: "event-1" })
      .mockImplementationOnce(() => {
        throw new Error("Hrana stream expired")
      })

    const response = await downloadActivity(new Request(
      "https://academy.example/coach/financials/records/activity.csv?from=2026-08-01&to=2026-08-31",
    ))
    const rows = (await response.text()).split("\r\n").filter(Boolean)

    expect(response.status).toBe(200)
    expect(rows[rows.length - 1]).toContain("EXPORT INCOMPLETE")
    expect(consoleError).toHaveBeenCalledWith(
      "Financial activity export stopped before its last row.",
      expect.objectContaining({ from: "2026-08-01", rowsWritten: 1, to: "2026-08-31" }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause)).toContain("Hrana stream expired")

    consoleError.mockRestore()
  })

  // F-17: `getFeeRegister` re-runs `requireCoach`, `requireFinanceActive` and
  // cursor validation on every page, so a decided refusal can land after the
  // first one, once 200 is on the wire. The service already words those for a
  // coach, and "run it again" is not the words: the same page would be refused
  // the same way. This is the mid-stream half of `financeDownloadRejection`.
  it("carries a mid-stream finance refusal into the file in its own words", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getFeeRegister
      .mockReturnValueOnce({ nextCursor: "player-42", rows: [registerRow], summary: {} })
      .mockImplementationOnce(() => {
        throw new FinanceServiceError(
          "INVALID_INPUT",
          "The financial-records cursor is invalid.",
        )
      })

    const response = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=registration",
    ))
    const rows = (await response.text()).split("\r\n").filter(Boolean)

    expect(rows[2]).toContain("EXPORT INCOMPLETE")
    expect(rows[2]).toContain("The financial-records cursor is invalid.")
    expect(rows[2]).not.toContain("Run the export again.")
    expect(consoleError).toHaveBeenCalledWith(
      "Financial fee-register export stopped before its last row.",
      expect.objectContaining({ rowsWritten: 1 }),
    )

    consoleError.mockRestore()
  })

  // F-17: a reader that hands back a cursor it already returned used to end the
  // drain exactly as a finished read ends it, so the export just stopped. The
  // register is rebuilt per page (`paginateById`), so this is a register that
  // changed mid-export, and a coach cannot tell the result from a short month.
  it("ends an export a repeated cursor cuts short with the same notice", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getFeeRegister
      .mockReturnValueOnce({ nextCursor: "player-42", rows: [registerRow], summary: {} })
      .mockReturnValueOnce({ nextCursor: "player-42", rows: [registerRow], summary: {} })

    const response = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=registration",
    ))
    const rows = (await response.text()).split("\r\n").filter(Boolean)

    expect(mocks.getFeeRegister).toHaveBeenCalledTimes(2)
    expect(rows).toHaveLength(4)
    expect(rows[3]).toContain("EXPORT INCOMPLETE")
    expect(rows[3]).toContain("stopped after 2 rows")
    expect(consoleError).toHaveBeenCalledWith(
      "Financial fee-register export stopped before its last row.",
      expect.objectContaining({ rowsWritten: 2 }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause))
      .toContain("returned a cursor it had already returned")

    consoleError.mockRestore()
  })

  // The first page is still inside the `try`, so nothing has been written yet
  // and the caller is entitled to a real 500 rather than a one-line CSV.
  it("still answers a first-page failure with a 500 instead of a notice", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getFeeRegister.mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked")
    })

    const response = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=2026-08",
    ))

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain("EXPORT INCOMPLETE")

    consoleError.mockRestore()
  })

  it("rejects invalid export periods before reading the ledger", async () => {
    const feeResponse = await downloadFeeRegister(new Request(
      "https://academy.example/coach/financials/records/fees.csv?mode=monthly&period=August",
    ))
    expect(feeResponse.status).toBe(400)
    expect(feeResponse.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getFeeRegister).not.toHaveBeenCalled()

    const activityResponse = await downloadActivity(new Request(
      "https://academy.example/coach/financials/records/activity.csv?from=2026-09-01&to=2026-08-01",
    ))
    expect(activityResponse.status).toBe(400)
    expect(activityResponse.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getFinancialActivity).not.toHaveBeenCalled()
  })
})
