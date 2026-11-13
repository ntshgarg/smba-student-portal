import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(() => ({ confirmNavigation: () => true })),
}))

import { FinancialsRapidDesk } from "@/components/coach/financials/financials-rapid-desk"
import { PlayerLedger } from "@/components/coach/financials/player-ledger"
import type { PlayerFinancialLedgerView } from "@/components/coach/financials/types"
import { PlayerFeeRecordView } from "@/components/financials/player-fee-record"
import { dashboardFeeRecordCopy } from "@/components/financials/player-finance-presentation"
import type {
  ChargeView,
  CoachReceiptView,
  PlayerFeeRecord,
  PlayerReceiptView,
  PlayerRefundView,
} from "@/lib/finance/types"

/*
 * What the coach and the family see after the fee plan, refund and receipt
 * fixes from the state-machine audit of 12 Nov 2026 (M111-M130).
 */

function augustFee(overrides: Partial<ChargeView> = {}): ChargeView {
  return {
    id: "charge-august",
    feeReference: "SMBA-FEE-2026-0008",
    type: "monthly_training",
    billingPeriod: "2026-08",
    description: "August monthly training fee",
    originalAmountPaise: 350_000,
    effectiveAmountPaise: 350_000,
    receivedPaise: 350_000,
    outstandingPaise: 0,
    currency: "INR",
    dueDate: "2026-08-05",
    lifecycle: "issued",
    status: "paid",
    recordRevision: 3,
    canVoid: false,
    payments: [{
      id: "receipt-august",
      receiptReference: "SMBA-RCP-AUGUST",
      amountPaise: 350_000,
      paymentAmountPaise: 350_000,
      receivedOn: "2026-08-03",
      method: "cash",
      externalReference: null,
      lifecycle: "recorded",
    }],
    ...overrides,
  }
}

function withdrawal(overrides: Partial<PlayerRefundView> = {}): PlayerRefundView {
  return {
    id: "refund-august",
    paymentId: "receipt-august",
    receiptReference: "SMBA-RCP-AUGUST",
    refundReference: "SMBA-RFD-AUGUST",
    purpose: "mid_term_withdrawal",
    withdrawalEffectiveOn: "2026-08-18",
    amountPaise: 50_000,
    receiptAmountPaise: 50_000,
    refundedOn: "2026-08-19",
    lifecycle: "recorded",
    ...overrides,
  }
}

function augustReceipt(overrides: Partial<PlayerReceiptView> = {}): PlayerReceiptView {
  return {
    id: "receipt-august",
    receiptReference: "SMBA-RCP-AUGUST",
    amountPaise: 350_000,
    receivedOn: "2026-08-03",
    method: "cash",
    externalReference: null,
    lifecycle: "recorded",
    allocations: [{
      id: "allocation-august",
      chargeId: "charge-august",
      chargeType: "monthly_training",
      billingPeriod: "2026-08",
      feeReference: "SMBA-FEE-2026-0008",
      description: "August monthly training fee",
      amountPaise: 350_000,
    }],
    refunds: [],
    refundedPaise: 0,
    ...overrides,
  }
}

function feeRecord(overrides: Partial<PlayerFeeRecord> = {}): PlayerFeeRecord {
  return {
    archived: false,
    feePlanSetupReady: false,
    financeTrackingMonth: "2026-07",
    registrationResolutionRequired: false,
    playerId: "player-money",
    academyId: "SMBA#0042",
    fullName: "Mira Rao",
    status: "paid",
    currentBalancePaise: 0,
    feeAgreement: null,
    feePlans: { current: null, ended: null, endsOn: null, startsOn: "2026-07-01", upcoming: null },
    onboardingComplete: true,
    setupDefaults: null,
    registrationCharge: null,
    monthlyCharges: [augustFee()],
    receipts: [augustReceipt()],
    concessionEntries: [],
    termFeeResumesOn: null,
    termFinishedOn: null,
    ...overrides,
  }
}

function render(record: PlayerFeeRecord, requestedMonth = "2026-08") {
  return renderToStaticMarkup(PlayerFeeRecordView({
    currentPeriod: "2026-10",
    record,
    requestedMonth,
    requestedYear: "2026",
  }))
}

function monthCell(html: string, period: string) {
  const match = html.match(new RegExp(`data-fee-month-cell="${period}"[\\s\\S]*?</(?:a|div)>`, "u"))
  if (!match) throw new Error(`The ${period} cell was not rendered.`)
  return match[0]
}

describe("the family's fee record", () => {
  it("reads a month as paid again once its withdrawal refund is reversed", () => {
    const record = feeRecord({
      receipts: [augustReceipt({ refunds: [withdrawal({ lifecycle: "reversed" })] })],
    })
    const html = render(record)

    // It used to keep "Closed after withdrawal / Balance closed".
    expect(html).not.toContain("Closed after withdrawal")
    expect(monthCell(html, "2026-08")).toContain("Paid")
    expect(html).toContain("Refund reversed")
    expect(html).toContain("Monthly fee received")
    expect(html).not.toContain("Unused-training credit")
  })

  it("says 'Plan ended' after the last fee plan ends, and the receipt was refunded", () => {
    const html = render(feeRecord({
      feePlans: { current: null, ended: null, endsOn: "2026-08-18", startsOn: "2026-07-01", upcoming: null },
      receipts: [augustReceipt({ refunds: [withdrawal()], refundedPaise: 50_000 })],
    }))
    // Months after it used to read "Not issued", as if a fee were coming.
    expect(monthCell(html, "2026-09")).toContain("Plan ended")
    expect(monthCell(html, "2026-06")).toContain("Before plan")
    expect(html).toContain("₹500 refunded")
  })

  it("reads a fee wholly covered by a concession as covered, not 'Paid ₹0'", () => {
    const html = render(feeRecord({
      concessionEntries: [{
        id: "concession-august",
        chargeId: "charge-august",
        feeReference: "SMBA-FEE-2026-0008",
        amountPaise: 350_000,
        appliedOn: "2026-08-01",
        label: "Fee concession",
        lifecycle: "applied",
      }],
      monthlyCharges: [augustFee({ effectiveAmountPaise: 0, payments: [], receivedPaise: 0 })],
      receipts: [],
    }))
    expect(monthCell(html, "2026-08")).toContain("Covered by concession")
  })

  it("says a voided registration fee is not charged, not 'after onboarding'", () => {
    const html = render(feeRecord({
      registrationCharge: augustFee({
        id: "registration",
        type: "registration",
        billingPeriod: null,
        lifecycle: "void",
        status: "void",
      }),
      registrationResolutionRequired: true,
    }))
    expect(html).toContain("Not charged")
    expect(html).not.toContain("Available after onboarding")
  })

  it("does not tell a family an overdue balance is due by a date already past", () => {
    expect(dashboardFeeRecordCopy({
      currentBalancePaise: 50_000,
      nextDueDate: "2026-08-05",
      status: "overdue",
    }).detail).toBe("It was due by 5 August 2026.")
  })
})

function coachReceipt(overrides: Partial<CoachReceiptView> = {}): CoachReceiptView {
  return {
    ...augustReceipt({ amountPaise: 100_000 }),
    allocations: [{
      id: "allocation-august",
      paymentAllocationId: "allocation-august",
      chargeId: "charge-august",
      chargeType: "monthly_training",
      billingPeriod: "2026-08",
      feeReference: "SMBA-FEE-2026-0008",
      description: "August monthly training fee",
      amountPaise: 100_000,
      refundablePaise: 0,
    }],
    canRefund: false,
    internalNote: null,
    recordRevision: 0,
    refundNeedsTrainingEnded: false,
    refundWindow: null,
    refundablePaise: 0,
    ...overrides,
  }
}

function ledger(overrides: Partial<PlayerFinancialLedgerView> = {}): PlayerFinancialLedgerView {
  return {
    academyId: "SMBA#0042",
    archived: false,
    charges: [],
    enrollmentDefaults: null,
    feePlan: null,
    feePlanSetupReady: false,
    fullName: "Mira Rao",
    management: { concessions: [], receipts: [], refunds: [] },
    onboardingComplete: true,
    outstandingPaise: 0,
    playerId: "player-money",
    setupDefaults: null,
    status: "paid",
    ...overrides,
  }
}

describe("the coach's fee record", () => {
  it("does not call a part-payment 'Settled'", () => {
    const html = renderToStaticMarkup(<PlayerLedger ledger={ledger({
      management: { concessions: [], receipts: [coachReceipt()], refunds: [] },
    })} period="2026-08" />)
    expect(html).not.toContain("Settled")
    expect(html).toContain("Recorded")
  })

  it("sends the coach to Members to end training before a refund", () => {
    const html = renderToStaticMarkup(<PlayerLedger ledger={ledger({
      management: {
        concessions: [],
        receipts: [coachReceipt({ refundNeedsTrainingEnded: true, refundablePaise: 100_000 })],
        refunds: [],
      },
    })} period="2026-08" />)
    expect(html).toContain("end their training in Members first")
    expect(html).toContain('href="/coach/members?player=player-money"')
    expect(html).not.toContain("Record mid-term withdrawal refund")
  })

  it("shows a leaver's ended fee plan instead of an onboarding prompt", () => {
    const html = renderToStaticMarkup(<PlayerLedger ledger={ledger({
      feePlan: {
        academyPlan: "weekday-5-day",
        agreedMonthlyFeePaise: 400_000,
        batch: "Weekday",
        effectiveFrom: "2026-07-01",
        effectiveTo: "2026-08-18",
        id: "plan-ended",
        label: "Beginner · Weekday · 5-day plan",
        level: "Beginner",
        recordRevision: 2,
        standing: "ended",
        status: "ended",
        upcoming: null,
      },
    })} period="2026-08" />)
    expect(html).toContain("Ended 18 Aug 2026")
    expect(html).not.toContain("Player onboarding in progress")
    expect(html).not.toContain("Continue Player Onboarding")
    // Concession uses can still be reversed for a player who left.
    expect(html).toContain("Concessions")
  })

  it("shows the fee in force and the fee change still to come", () => {
    const html = renderToStaticMarkup(<PlayerLedger ledger={ledger({
      feePlan: {
        academyPlan: "weekday-5-day",
        agreedMonthlyFeePaise: 400_000,
        batch: "Weekday",
        effectiveFrom: "2026-07-01",
        effectiveTo: "2026-10-31",
        id: "plan-now",
        label: "Beginner · Weekday · 5-day plan",
        level: "Beginner",
        recordRevision: 1,
        standing: "ending",
        status: "ended",
        upcoming: {
          agreedMonthlyFeePaise: 450_000,
          effectiveFrom: "2026-11-01",
          label: "Beginner · Weekday · 5-day plan",
        },
      },
    })} period="2026-10" />)
    expect(html).toContain("₹4,000")
    expect(html).toContain("Ends 31 Oct 2026")
    expect(html).toContain("From November 2026: Beginner · Weekday · 5-day plan, ₹4,500 a month.")
  })

  it("lists a refund under a receipt with the share that came from it", () => {
    const refund = {
      ...withdrawal({ amountPaise: 200_000, receiptAmountPaise: 50_000 }),
      allocations: [],
      canReverse: true,
      externalReference: null,
      internalNote: null,
      method: "cash" as const,
      recordRevision: 0,
    }
    const html = renderToStaticMarkup(<PlayerLedger ledger={ledger({
      management: {
        concessions: [],
        receipts: [coachReceipt({ refundedPaise: 50_000, refunds: [refund] })],
        refunds: [refund],
      },
    })} period="2026-08" />)
    expect(html).toContain("₹500 refunded")
    expect(html).toContain("of this ₹2,000 refund")
  })
})

describe("the payment desk", () => {
  it("shows a player who left with their status, not 'Fee plan required'", () => {
    const html = renderToStaticMarkup(<FinancialsRapidDesk initialQuery="Mira" workspace={{
      period: "2026-08",
      players: [{
        academyId: "SMBA#0042",
        archived: false,
        dueDate: "2026-08-05",
        feePlanEnded: true,
        feeReference: "SMBA-FEE-2026-0008",
        fullName: "Mira Rao",
        hasActiveFeePlan: false,
        outstandingPaise: 0,
        paymentEligible: false,
        playerId: "player-money",
        status: "paid",
      }],
      scope: "all",
      selectedLedger: null,
    }} />)
    expect(html).not.toContain("Fee plan required")
    expect(html).toContain("Paid")
  })
})
