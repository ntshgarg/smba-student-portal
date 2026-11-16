import { renderToStaticMarkup } from "react-dom/server"

import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }))

import {
  FinancialRecordsWorkspace,
  formatFinancialPaymentMethod,
  type CollectionsDayBookView,
  type FeeRegisterView,
  type FinancialActivityView,
} from "@/components/coach/financials/financial-records-workspace"
import { formatInr } from "@/lib/format"

const pagination = {
  label: "1–1 of 1",
  nextHref: null,
  previousHref: null,
}

const feeRegister: FeeRegisterView = {
  exportHref: "/coach/financials/records/fees.csv",
  filters: {
    cursors: "player-before",
    mode: "monthly",
    period: "2026-08",
    query: "Aarav",
    scope: "active",
    status: "all",
  },
  pagination,
  rows: [{
    academyId: "SMBA#0042",
    archived: false,
    billingPeriod: "2026-08",
    chargeId: "charge-42",
    creditAdjustmentsPaise: 50_000,
    debitAdjustmentsPaise: 0,
    dueDate: "2026-08-05",
    effectiveAmountPaise: 350_000,
    feeReference: "SMBA-FEE-42",
    fullName: "Aarav Bhat",
    originalAmountPaise: 400_000,
    outstandingPaise: 150_000,
    playerId: "player-42",
    receivedPaise: 200_000,
    status: "partially_paid",
    type: "monthly_training",
  }],
  summary: {
    effectiveAmountPaise: 350_000,
    originalAmountPaise: 400_000,
    outstandingPaise: 150_000,
    receivedPaise: 200_000,
    statusCounts: { partially_paid: 1 },
    totalRows: 1,
  },
}

const dayBook: CollectionsDayBookView = {
  currentPeriod: "2026-08",
  events: [{
    academyId: "SMBA#0042",
    amountPaise: 200_000,
    coveredFeeReferences: ["SMBA-FEE-42"],
    eventDate: "2026-08-08",
    eventType: "payment",
    id: "event-payment",
    lifecycle: "recorded",
    method: "upi",
    paymentId: "payment-42",
    playerFullName: "Aarav Bhat",
    playerId: "player-42",
    recordedAt: "2026-08-08T06:00:00.000Z",
    reference: "SMBA-R-2026-00042",
  }, {
    academyId: "SMBA#0043",
    amountPaise: 50_000,
    coveredFeeReferences: ["SMBA-FEE-43"],
    eventDate: "2026-08-08",
    eventType: "refund",
    id: "event-refund",
    lifecycle: "recorded",
    method: "cash",
    paymentId: null,
    playerFullName: "Meera Rao",
    playerId: "player-43",
    recordedAt: "2026-08-08T07:00:00.000Z",
    reference: "SMBA-RF-2026-00001",
  }],
  exportHref: "/coach/financials/records/collections.csv",
  filters: {
    from: "2026-08-01",
    includeReversed: false,
    to: "2026-08-31",
  },
  pagination: { ...pagination, label: "1–2 of 2" },
  summary: {
    byMethod: {
      bank_transfer: 0,
      card: 0,
      cash: -50_000,
      cheque: 0,
      other: 0,
      upi: 200_000,
    },
    grossReceivedPaise: 200_000,
    netCollectionsPaise: 150_000,
    refundsPaise: 50_000,
  },
}

const activity: FinancialActivityView = {
  coachOptions: [{ id: "coach-1", name: "Sathiya Moorthy" }],
  counts: { charge_issued: 3, payment_recorded: 2 },
  exportHref: "/coach/financials/records/activity.csv",
  filters: {
    coachId: "all",
    eventType: "all",
    from: "2026-08-01",
    query: "",
    to: "2026-08-31",
  },
  items: [{
    academyId: "SMBA#0042",
    action: "Recorded payment SMBA-R-2026-00042",
    actorId: "coach-1",
    actorName: "Sathiya Moorthy",
    amountPaise: 200_000,
    eventType: "payment_recorded",
    id: "audit-42",
    occurredAt: "2026-08-08T06:00:00.000Z",
    playerId: "player-42",
    playerName: "Aarav Bhat",
    reason: null,
    reference: "SMBA-R-2026-00042",
  }],
  pagination,
}

describe("Financial Records presentation", () => {
  it("formats monetary and method labels deterministically", () => {
    expect(formatInr(100_000)).toBe("₹1,000")
    expect(formatInr(100_050)).toBe("₹1,000.50")
    expect(formatFinancialPaymentMethod("upi")).toBe("UPI")
    expect(formatFinancialPaymentMethod("bank_transfer")).toBe("Bank transfer")
  })

  it("renders a filterable fee register with derived values supplied by the ledger", () => {
    const html = renderToStaticMarkup(
      <FinancialRecordsWorkspace activeView="fees" feeRegister={feeRegister} />,
    )

    expect(html).toContain(">Fees</h1>")
    expect(html).toContain("August 2026 monthly fees")
    expect(html).toContain("Billed<b>₹3,500</b>")
    expect(html).toContain("Outstanding<b>₹1,500</b>")
    // the status tiles keep their counts and filter in the address
    expect(html).toContain('href="/coach/financials/records?view=fees&amp;mode=monthly&amp;period=2026-08&amp;q=Aarav&amp;status=due"><b>1</b><span>Due</span>')
    expect(html).toContain("Part paid")
    expect(html).toContain("due 5 Aug")
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("Player, Academy ID or fee reference")
    expect(html).not.toContain("Apply filters")
  })

  it("shows a fee not yet issued as a dash, not ₹0", async () => {
    const { FeeRegisterList } = await import("@/components/coach/financials/fee-register-list")
    const row = {
      ...feeRegister.rows[0],
      chargeId: null,
      dueDate: null,
      effectiveAmountPaise: 0,
      feeReference: null,
      originalAmountPaise: 0,
      outstandingPaise: 0,
      receivedPaise: 0,
      status: "not_prepared" as const,
    }
    const html = renderToStaticMarkup(
      <FeeRegisterList rows={[{ ...row, paymentHref: null, recordHref: "/coach/financials/players/player-42" }]} startNumber={1} />,
    )
    expect(html).toContain("To issue")
    expect(html).toContain("—<small>not issued yet</small>")
    expect(html).not.toContain("₹0")
  })

  it("renders registration fees as their own register", () => {
    const registrationRegister: FeeRegisterView = {
      ...feeRegister,
      filters: { ...feeRegister.filters, mode: "registration" },
      pagination: { ...pagination, label: "11–11 of 11" },
      summary: { ...feeRegister.summary, totalRows: 11 },
    }
    const html = renderToStaticMarkup(
      <FinancialRecordsWorkspace activeView="fees" feeRegister={registrationRegister} />,
    )

    expect(html).toContain('aria-label="Registration fees"')
    expect(html).toContain("Charged<b>₹3,500</b>")
    expect(html).toContain('<ol class="')
    expect(html).toContain('start="11"')
    expect(html).not.toContain('name="period"')
  })

  it("links receipts only for payment rows and keeps refund rows in the day book", () => {
    const html = renderToStaticMarkup(
      <FinancialRecordsWorkspace activeView="collections" dayBook={dayBook} />,
    )

    expect(html).toContain('aria-label="Collections"')
    expect(html).toContain("This month")
    expect(html).toContain("Last month")
    // UPI received, cash refunded: both show under By method
    expect(html).toContain('aria-label="Collections by payment method"')
    expect(html).toContain("<dt>UPI</dt><dd>₹2,000</dd>")
    expect(html).toContain("<dt>Cash</dt><dd>-₹500</dd>")
    expect(html).toContain("1 payment · 1 refund · ₹1,500")
    expect(html).toContain("SMBA-R-2026-00042")
    expect(html).toContain("SMBA-RF-2026-00001")
    expect(html).toContain("/coach/financials/receipts/payment-42/download")
    expect(html).toContain('aria-label="Download receipt SMBA-R-2026-00042 for Aarav Bhat"')
    expect(html.match(/\/coach\/financials\/receipts\//gu)).toHaveLength(1)
  })

  it("presents human audit actions without exposing raw event labels", () => {
    const html = renderToStaticMarkup(
      <FinancialRecordsWorkspace activeView="activity" activity={activity} />,
    )

    expect(html).toContain('aria-label="Filter by kind"')
    expect(html).toContain("All<b>5</b>")
    expect(html).toContain("Payments<b>2</b>")
    expect(html).toContain("Fees issued<b>3</b>")
    expect(html).toContain("Recorded payment SMBA-R-2026-00042")
    expect(html).toContain("Aarav Bhat · SMBA#0042")
    expect(html).toContain("Sathiya Moorthy")
    expect(html).not.toContain(">payment_recorded<")
    expect(html).toContain("/coach/financials/records/activity.csv")
  })
})
