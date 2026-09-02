import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionIdentity } from "@/lib/auth/identity"
import type {
  FinanceReceiptDocument,
  FinanceStatementDocument,
} from "@/lib/finance/documents"

const mocks = vi.hoisted(() => ({
  createFinanceReceiptPdf: vi.fn(),
  createPlayerFeeStatementPdf: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getPlayerFeeStatement: vi.fn(),
  getReceiptDocument: vi.fn(),
  requireHeadAdminAccess: vi.fn(),
}))

vi.mock("@/lib/auth/coach-access", () => ({
  requireHeadAdminAccess: mocks.requireHeadAdminAccess,
}))

vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))

vi.mock("@/lib/finance/documents", () => ({
  getPlayerFeeStatement: mocks.getPlayerFeeStatement,
  getReceiptDocument: mocks.getReceiptDocument,
}))

vi.mock("@/lib/finance/pdf", () => ({
  createFinanceReceiptPdf: mocks.createFinanceReceiptPdf,
  createPlayerFeeStatementPdf: mocks.createPlayerFeeStatementPdf,
}))

vi.mock("@/lib/finance/service", () => ({
  FinanceServiceError: class FinanceServiceError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

import { GET as downloadReceipt } from "@/app/coach/financials/receipts/[paymentId]/download/route"
import { GET as downloadStatement } from "@/app/coach/financials/players/[playerId]/statement/download/route"
import { FinanceServiceError } from "@/lib/finance/service"

const coach: SessionIdentity = {
  academyId: "SMBA#0001",
  firstName: "Sathiya",
  fullName: "Sathiya Moorthy",
  initials: "SM",
  role: "coach",
  subjectId: "coach-account",
}

const receipt: FinanceReceiptDocument = {
  paymentId: "payment-private",
  receiptReference: "SMBA-R-2026-00042",
  playerId: "player-private",
  playerName: "Aarav / Bhat\r\nInjected.pdf",
  academyId: "SMBA#0042",
  amountPaise: 350_000,
  refundedPaise: 50_000,
  netReceivedPaise: 300_000,
  receivedOn: "2026-08-08",
  method: "upi",
  externalReference: "UPI-42",
  lifecycle: "recorded",
  status: "partially_refunded",
  allocations: [{
    feeReference: "SMBA-FEE-42",
    description: "Monthly training fee - August 2026",
    amountPaise: 350_000,
  }],
  refunds: [{
    refundReference: "SMBA-RF-2026-00001",
    amountPaise: 50_000,
    refundedOn: "2026-08-09",
    lifecycle: "recorded",
  }],
  generatedAt: "2026-08-10T10:00:00.000+05:30",
}

const statement: FinanceStatementDocument = {
  playerId: receipt.playerId,
  playerName: receipt.playerName,
  academyId: receipt.academyId,
  archived: false,
  status: "partially_paid",
  currentBalancePaise: 50_000,
  charges: [],
  receipts: [],
  generatedAt: receipt.generatedAt,
}

function receiptRequest(paymentId = receipt.paymentId) {
  return downloadReceipt(new Request(`https://academy.example/receipt/${paymentId}`), {
    params: Promise.resolve({ paymentId }),
  })
}

function statementRequest(playerId = statement.playerId) {
  return downloadStatement(new Request(`https://academy.example/statement/${playerId}`), {
    params: Promise.resolve({ playerId }),
  })
}

describe("protected Financials document downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(coach)
    mocks.getReceiptDocument.mockReturnValue(receipt)
    mocks.getPlayerFeeStatement.mockReturnValue(statement)
    mocks.requireHeadAdminAccess.mockReturnValue({ accessLevel: "head_admin" })
    mocks.createFinanceReceiptPdf.mockResolvedValue(Buffer.from("%PDF-private-receipt"))
    mocks.createPlayerFeeStatementPdf.mockResolvedValue(Buffer.from("%PDF-private-statement"))
  })

  it("rejects an authenticated assistant coach before reading a financial document", async () => {
    mocks.requireHeadAdminAccess.mockImplementationOnce(() => {
      throw new Error("Head coach access is required.")
    })

    const response = await receiptRequest()

    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getReceiptDocument).not.toHaveBeenCalled()
    expect(mocks.createFinanceReceiptPdf).not.toHaveBeenCalled()
  })

  // The gate is now shared with six sibling routes, so each route has to be
  // shown refusing on its own rather than inheriting a sibling's coverage.
  it("rejects an authenticated assistant coach before reading a fee statement", async () => {
    mocks.requireHeadAdminAccess.mockImplementationOnce(() => {
      throw new Error("Head coach access is required.")
    })

    const response = await statementRequest()

    expect(response.status).toBe(403)
    expect(await response.text()).toBe("Head coach access is required.")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getPlayerFeeStatement).not.toHaveBeenCalled()
    expect(mocks.createPlayerFeeStatementPdf).not.toHaveBeenCalled()
  })

  // Access can be revoked between the route's own gate and the reader's second
  // check. The reader raises that as a FinanceServiceError, and it is a refusal
  // rather than a fault, so it must not be laundered into a 500.
  it("answers a reader's own authorisation refusal with 403, not 500", async () => {
    const refusal = () => {
      throw new FinanceServiceError(
        "AUTHORIZATION",
        "Head coach access is required to generate financial records.",
      )
    }
    mocks.getReceiptDocument.mockImplementationOnce(refusal)
    mocks.getPlayerFeeStatement.mockImplementationOnce(refusal)

    const receiptResponse = await receiptRequest()
    const statementResponse = await statementRequest()

    for (const response of [receiptResponse, statementResponse]) {
      expect(response.status).toBe(403)
      expect(await response.text())
        .toBe("Head coach access is required to generate financial records.")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }

    // Both readers ran, which is what distinguishes this refusal from the one
    // the route's own preamble makes before any read happens.
    expect(mocks.getReceiptDocument).toHaveBeenCalled()
    expect(mocks.getPlayerFeeStatement).toHaveBeenCalled()
    expect(mocks.createFinanceReceiptPdf).not.toHaveBeenCalled()
    expect(mocks.createPlayerFeeStatementPdf).not.toHaveBeenCalled()
  })

  it("rejects guests and players before querying financial records", async () => {
    mocks.getCurrentIdentity.mockResolvedValueOnce(null)
    expect((await receiptRequest()).status).toBe(401)
    expect(mocks.getReceiptDocument).not.toHaveBeenCalled()

    mocks.getCurrentIdentity.mockResolvedValueOnce({ ...coach, role: "player" })
    expect((await statementRequest()).status).toBe(401)
    expect(mocks.getPlayerFeeStatement).not.toHaveBeenCalled()
  })

  it("returns private hardened PDFs with safe attachment names", async () => {
    const receiptResponse = await receiptRequest()
    const statementResponse = await statementRequest()

    expect(receiptResponse.status).toBe(200)
    expect(receiptResponse.headers.get("cache-control")).toBe("private, no-store")
    expect(receiptResponse.headers.get("x-content-type-options")).toBe("nosniff")
    expect(receiptResponse.headers.get("content-type")).toBe("application/pdf")
    expect(receiptResponse.headers.get("content-disposition")).toBe(
      'attachment; filename="SMBA-Aarav-Bhat-Injected-pdf-SMBA-R-2026-00042-Receipt.pdf"',
    )
    expect(statementResponse.status).toBe(200)
    expect(statementResponse.headers.get("cache-control")).toBe("private, no-store")
    expect(statementResponse.headers.get("content-disposition")).toBe(
      'attachment; filename="SMBA-Aarav-Bhat-Injected-pdf-SMBA-0042-Fee-Statement.pdf"',
    )
    expect(mocks.getReceiptDocument).toHaveBeenCalledWith(
      receipt.paymentId,
      { coachId: coach.subjectId },
    )
    expect(mocks.getPlayerFeeStatement).toHaveBeenCalledWith(
      statement.playerId,
      { coachId: coach.subjectId },
    )
  })

  it("returns private 404 responses without invoking the PDF renderer", async () => {
    mocks.getReceiptDocument.mockReturnValueOnce(null)
    mocks.getPlayerFeeStatement.mockReturnValueOnce(null)

    expect((await receiptRequest("missing-payment")).status).toBe(404)
    expect((await statementRequest("missing-player")).status).toBe(404)
    expect(mocks.createFinanceReceiptPdf).not.toHaveBeenCalled()
    expect(mocks.createPlayerFeeStatementPdf).not.toHaveBeenCalled()
  })

  it("returns generic private errors without exposing financial content", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.createFinanceReceiptPdf.mockRejectedValueOnce(new Error("Private receipt failure"))

    const response = await receiptRequest()
    expect(response.status).toBe(500)
    expect(await response.text()).toBe("Unable to generate the financial record.")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(receipt.externalReference)

    // IQ-3: the response stays opaque, but the log no longer is. Without this
    // the 500 above is indistinguishable from every other cause of a 500 here.
    expect(consoleError).toHaveBeenCalledWith(
      "Financial receipt PDF generation failed.",
      expect.objectContaining({ paymentId: receipt.paymentId }),
    )
    expect(String(consoleError.mock.calls[0]?.[1]?.cause))
      .toContain("Private receipt failure")

    consoleError.mockRestore()
  })
})
