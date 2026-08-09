import { describe, expect, it } from "vitest"

import type {
  FinanceReceiptDocument,
  FinanceStatementDocument,
} from "@/lib/finance/documents"
import {
  countPdfPages,
  createFinanceReceiptPdf,
  createPlayerFeeStatementPdf,
} from "@/lib/finance/pdf"

const generatedAt = "2026-08-20T10:00:00.000+05:30"

function receipt(overrides: Partial<FinanceReceiptDocument> = {}): FinanceReceiptDocument {
  return {
    paymentId: "payment-1",
    receiptReference: "SMBA-R-2026-00001",
    playerId: "player-1",
    playerName: "Aarav Srinivasa Venkata Narasimha Subramanian",
    academyId: "SMBA#0042",
    amountPaise: 350_000,
    refundedPaise: 0,
    netReceivedPaise: 350_000,
    receivedOn: "2026-08-08",
    method: "upi",
    externalReference: "UPI-2026-00001",
    lifecycle: "recorded",
    status: "recorded",
    allocations: [{
      feeReference: "SMBA-FEE-AUGUST",
      description: "Monthly training fee - August 2026",
      amountPaise: 350_000,
    }],
    refunds: [],
    generatedAt,
    ...overrides,
  }
}

describe("Financials PDF generation", () => {
  it.each([
    ["recorded", 0, 350_000],
    ["partially_refunded", 50_000, 300_000],
    ["fully_refunded", 350_000, 0],
    ["reversed", 0, 0],
  ] as const)("renders a %s receipt as a valid PDF", async (status, refunded, net) => {
    const pdf = await createFinanceReceiptPdf(receipt({
      lifecycle: status === "reversed" ? "reversed" : "recorded",
      status,
      refundedPaise: refunded,
      netReceivedPaise: net,
      refunds: refunded ? [{
        refundReference: "SMBA-RF-2026-00001",
        amountPaise: refunded,
        refundedOn: "2026-08-10",
        lifecycle: "recorded",
      }] : [],
    }))

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(countPdfPages(pdf)).toBeGreaterThanOrEqual(1)
  })

  it("paginates a long complete player statement without clipping it to one page", async () => {
    const sourceReceipt = receipt()
    const charges = Array.from({ length: 30 }, (_, index) => ({
      feeReference: `SMBA-FEE-${String(index + 1).padStart(4, "0")}`,
      type: index === 0 ? "registration" as const : "monthly_training" as const,
      billingPeriod: index === 0 ? null : `2026-${String((index % 12) + 1).padStart(2, "0")}`,
      description: index === 0
        ? "Registration fee"
        : `Monthly training fee - statement history item ${index}`,
      originalAmountPaise: 350_000,
      effectiveAmountPaise: 325_000,
      receivedPaise: 300_000,
      outstandingPaise: 25_000,
      dueDate: `2026-${String((index % 12) + 1).padStart(2, "0")}-05`,
      lifecycle: index === 4 ? "void" as const : "issued" as const,
      status: index === 4 ? "void" as const : "partially_paid" as const,
      adjustments: [{
        kind: "concession_credit" as const,
        amountPaise: 25_000,
        createdAt: generatedAt,
        lifecycle: "active" as const,
      }],
    }))
    const statement: FinanceStatementDocument = {
      playerId: sourceReceipt.playerId,
      playerName: sourceReceipt.playerName,
      academyId: sourceReceipt.academyId,
      archived: false,
      status: "partially_paid",
      currentBalancePaise: 725_000,
      charges,
      receipts: Array.from({ length: 12 }, (_, index) => ({
        receiptReference: `SMBA-R-2026-${String(index + 1).padStart(5, "0")}`,
        amountPaise: sourceReceipt.amountPaise,
        refundedPaise: 0,
        netReceivedPaise: sourceReceipt.amountPaise,
        receivedOn: sourceReceipt.receivedOn,
        method: sourceReceipt.method,
        externalReference: sourceReceipt.externalReference,
        lifecycle: sourceReceipt.lifecycle,
        status: sourceReceipt.status,
        allocations: sourceReceipt.allocations,
        refunds: [],
      })),
      generatedAt,
    }

    const pdf = await createPlayerFeeStatementPdf(statement)

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(countPdfPages(pdf)).toBeGreaterThan(4)
    expect(pdf.byteLength).toBeGreaterThan(20_000)
  })
})
