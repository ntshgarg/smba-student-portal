import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PlayerFeeRecordView } from "@/components/financials/player-fee-record"
import {
  dashboardFeeRecordCopy,
  formatBillingPeriod,
  formatFinanceAmount,
  formatFinanceDate,
  groupMonthlyChargesByYear,
} from "@/components/financials/player-finance-presentation"
import type { ChargeView, PlayerFeeRecord } from "@/lib/finance/types"

function charge(overrides: Partial<ChargeView> = {}): ChargeView {
  return {
    id: "charge-august",
    feeReference: "SMBA-FEE-2026-0008",
    type: "monthly_training",
    billingPeriod: "2026-08",
    description: "August monthly training fee",
    originalAmountPaise: 300_000,
    effectiveAmountPaise: 300_000,
    receivedPaise: 100_000,
    outstandingPaise: 200_000,
    currency: "INR",
    dueDate: "2026-08-05",
    lifecycle: "issued",
    status: "partially_paid",
    recordRevision: 1,
    canVoid: false,
    payments: [{
      id: "payment-august",
      receiptReference: "SMBA-RCP-AUGUST",
      amountPaise: 100_000,
      paymentAmountPaise: 100_000,
      receivedOn: "2026-08-03",
      method: "upi",
      externalReference: "UPI-4812",
      lifecycle: "recorded",
    }],
    ...overrides,
  }
}

describe("player financial presentation", () => {
  it("formats integer paise, date keys and billing periods for the player ledger", () => {
    expect(formatFinanceAmount(100_000)).toBe("INR 1,000")
    expect(formatFinanceAmount(100_050)).toBe("INR 1,000.50")
    expect(formatFinanceDate("2026-08-05")).toBe("5 August 2026")
    expect(formatBillingPeriod("2026-08")).toBe("August")
  })

  it("groups monthly charges into newest-first year chapters without changing charge values", () => {
    const july2025 = charge({ id: "2025-07", billingPeriod: "2025-07", dueDate: "2025-07-05" })
    const july2026 = charge({ id: "2026-07", billingPeriod: "2026-07", dueDate: "2026-07-05" })
    const august2026 = charge({ id: "2026-08", billingPeriod: "2026-08" })

    expect(groupMonthlyChargesByYear([july2025, july2026, august2026])).toEqual([
      { year: "2026", charges: [august2026, july2026] },
      { year: "2025", charges: [july2025] },
    ])
  })

  it("uses calm factual dashboard language for setup, partial and settled states", () => {
    expect(dashboardFeeRecordCopy({
      status: "setup_required",
      currentBalancePaise: 0,
      nextDueDate: null,
    }).status).toBe("Fee record is being prepared")
    expect(dashboardFeeRecordCopy({
      status: "partially_paid",
      currentBalancePaise: 200_000,
      nextDueDate: "2026-08-05",
    })).toMatchObject({
      status: "INR 2,000 remaining",
      detail: "A payment is recorded. The remaining balance is due by 5 August 2026.",
    })
    expect(dashboardFeeRecordCopy({
      status: "paid",
      currentBalancePaise: 0,
      nextDueDate: null,
    }).status).toBe("No balance due")
  })

  it("renders owner-safe receipts, allocation breakdowns, refunds and concessions", () => {
    const registration = charge({
      id: "registration",
      feeReference: "SMBA-REG-0002",
      type: "registration",
      billingPeriod: null,
      description: "Academy registration fee",
      effectiveAmountPaise: 100_000,
      originalAmountPaise: 100_000,
      receivedPaise: 100_000,
      outstandingPaise: 0,
      status: "paid",
      payments: [{
        id: "registration-payment",
        receiptReference: "SMBA-RCP-REGISTRATION",
        amountPaise: 100_000,
        paymentAmountPaise: 100_000,
        receivedOn: "2026-07-18",
        method: "cash",
        externalReference: null,
        lifecycle: "recorded",
      }],
    })
    const reversed = charge({
      id: "july",
      feeReference: "SMBA-FEE-2026-0007",
      billingPeriod: "2026-07",
      description: "July monthly training fee",
      payments: [{
        id: "reversed-payment",
        receiptReference: "SMBA-RCP-REVERSED",
        amountPaise: 50_000,
        paymentAmountPaise: 50_000,
        receivedOn: "2026-07-04",
        method: "bank_transfer",
        externalReference: "BANK-117",
        lifecycle: "reversed",
      }],
    })
    const record: PlayerFeeRecord = {
      archived: false,
      registrationResolutionRequired: false,
      playerId: "player-owner",
      academyId: "SMBA#0002",
      fullName: "Mira Rao",
      status: "partially_paid",
      currentBalancePaise: 400_000,
      feeAgreement: null,
      setupDefaults: null,
      registrationCharge: registration,
      monthlyCharges: [charge(), reversed],
      receipts: [{
        id: "receipt-august",
        receiptReference: "SMBA-RCP-AUGUST",
        amountPaise: 200_000,
        receivedOn: "2026-08-03",
        method: "upi",
        externalReference: "UPI-4812",
        lifecycle: "recorded",
        allocations: [{
          id: "allocation-august",
          chargeId: "charge-august",
          feeReference: "SMBA-FEE-2026-0008",
          description: "August monthly training fee",
          amountPaise: 100_000,
        }, {
          id: "allocation-registration",
          chargeId: "registration",
          feeReference: "SMBA-REG-0002",
          description: "Academy registration fee",
          amountPaise: 100_000,
        }],
        refunds: [{
          id: "refund-august",
          paymentId: "receipt-august",
          receiptReference: "SMBA-RCP-AUGUST",
          refundReference: "SMBA-RFD-AUGUST",
          amountPaise: 50_000,
          refundedOn: "2026-08-06",
          lifecycle: "recorded",
        }],
      }],
      concessionEntries: [{
        id: "concession-august",
        chargeId: "charge-august",
        feeReference: "SMBA-FEE-2026-0008",
        amountPaise: 25_000,
        appliedOn: "2026-08-02",
        label: "Fee concession",
        lifecycle: "applied",
      }],
    }

    const html = renderToStaticMarkup(PlayerFeeRecordView({ record }))

    expect(html).toContain("Current balance")
    expect(html).toContain("INR 4,000")
    expect(html).toContain("SMBA-REG-0002")
    expect(html).toContain("SMBA-FEE-2026-0008")
    expect(html).toContain("5 August 2026")
    expect(html).toContain("UPI-4812")
    expect(html).toContain("Receipt SMBA-RCP-AUGUST")
    expect(html).toContain("Applied to")
    expect(html).toContain("August monthly training fee")
    expect(html).toContain("Academy registration fee")
    expect(html).toContain("Refund SMBA-RFD-AUGUST")
    expect(html).toContain("6 August 2026")
    expect(html).toContain("Refund recorded")
    expect(html).toContain("Fee concessions")
    expect(html).toContain("Fee concession")
    expect(html).toContain("2 August 2026")
    expect(html).toContain("· Applied")
    expect(html).not.toContain("player-owner")
  })

  it("does not render coach-private finance fields even if an unsafe caller supplies them", () => {
    const unsafeRecord = {
      archived: false,
      registrationResolutionRequired: false,
      playerId: "private-player-id",
      academyId: "SMBA#0002",
      fullName: "Mira Rao",
      status: "paid",
      currentBalancePaise: 0,
      feeAgreement: null,
      setupDefaults: null,
      registrationCharge: null,
      monthlyCharges: [],
      receipts: [{
        id: "safe-receipt",
        receiptReference: "SMBA-RCP-SAFE",
        amountPaise: 100_000,
        receivedOn: "2026-08-03",
        method: "cash",
        externalReference: null,
        lifecycle: "reversed",
        allocations: [{
          id: "safe-allocation",
          chargeId: "private-charge-id",
          feeReference: "SMBA-FEE-SAFE",
          description: "August monthly training fee",
          amountPaise: 100_000,
          actorAccountId: "private-coach-id",
        }],
        refunds: [{
          id: "safe-refund",
          paymentId: "safe-receipt",
          receiptReference: "SMBA-RCP-SAFE",
          refundReference: "SMBA-RFD-SAFE",
          amountPaise: 10_000,
          refundedOn: "2026-08-04",
          lifecycle: "reversed",
          reversalReason: "Private refund reversal reason",
        }],
        internalNote: "Private coach receipt note",
        idempotencyKey: "private-receipt-key",
      }],
      concessionEntries: [{
        id: "safe-concession",
        chargeId: "private-charge-id",
        feeReference: "SMBA-FEE-SAFE",
        amountPaise: 10_000,
        appliedOn: "2026-08-02",
        label: "Fee concession",
        lifecycle: "reversed",
        reason: "Private concession reason",
        createdByAccountId: "private-coach-id",
      }],
      coachManagement: {
        internalNote: "Private management note",
      },
    } as unknown as PlayerFeeRecord

    const html = renderToStaticMarkup(PlayerFeeRecordView({ record: unsafeRecord }))

    expect(html).toContain("SMBA-RCP-SAFE")
    expect(html).toContain("Receipt reversed")
    expect(html).toContain("Refund SMBA-RFD-SAFE")
    expect(html).toContain("Refund reversed")
    expect(html).toContain("Fee concession")
    expect(html).toContain("· Reversed")
    expect(html).not.toContain("Private coach receipt note")
    expect(html).not.toContain("Private concession reason")
    expect(html).not.toContain("Private refund reversal reason")
    expect(html).not.toContain("Private management note")
    expect(html).not.toContain("private-coach-id")
    expect(html).not.toContain("private-receipt-key")
    expect(html).not.toContain("private-player-id")
    expect(html).not.toContain("private-charge-id")
    expect(html).not.toContain("fee-receipt-safe-receipt")
  })
})
