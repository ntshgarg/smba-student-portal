import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PlayerFeeRecordView } from "@/components/financials/player-fee-record"
import {
  dashboardFeeRecordCopy,
  formatBillingPeriod,
  formatFinanceDate,
  groupMonthlyChargesByYear,
} from "@/components/financials/player-finance-presentation"
import type {
  ChargeView,
  PlayerFeeRecord,
  PlayerReceiptView,
} from "@/lib/finance/types"
import { formatInr } from "@/lib/format"

function charge(overrides: Partial<ChargeView> = {}): ChargeView {
  return {
    id: "charge-august",
    feeReference: "SMBA-FEE-2026-0008",
    type: "monthly_training",
    billingPeriod: "2026-08",
    description: "August monthly training fee",
    originalAmountPaise: 350_000,
    effectiveAmountPaise: 350_000,
    receivedPaise: 300_000,
    outstandingPaise: 50_000,
    currency: "INR",
    dueDate: "2026-08-05",
    lifecycle: "issued",
    status: "partially_paid",
    recordRevision: 1,
    canVoid: false,
    payments: [{
      id: "payment-august",
      receiptReference: "SMBA-RCP-AUGUST",
      amountPaise: 300_000,
      paymentAmountPaise: 300_000,
      receivedOn: "2026-08-03",
      method: "cash",
      externalReference: null,
      lifecycle: "recorded",
    }],
    ...overrides,
  }
}

function registrationCharge(overrides: Partial<ChargeView> = {}): ChargeView {
  return charge({
    id: "registration",
    feeReference: "SMBA-REG-0002",
    type: "registration",
    billingPeriod: null,
    description: "Academy registration fee",
    originalAmountPaise: 100_000,
    effectiveAmountPaise: 100_000,
    receivedPaise: 100_000,
    outstandingPaise: 0,
    dueDate: "2026-07-04",
    status: "paid",
    payments: [{
      id: "registration-payment",
      receiptReference: "SMBA-RCP-REGISTRATION",
      amountPaise: 100_000,
      paymentAmountPaise: 100_000,
      receivedOn: "2026-07-04",
      method: "cash",
      externalReference: null,
      lifecycle: "recorded",
    }],
    ...overrides,
  })
}

function monthlyReceipt(overrides: Partial<PlayerReceiptView> = {}): PlayerReceiptView {
  return {
    id: "receipt-august",
    receiptReference: "SMBA-RCP-AUGUST",
    amountPaise: 300_000,
    receivedOn: "2026-08-03",
    method: "cash",
    externalReference: "CASHBOOK-4812",
    lifecycle: "recorded",
    allocations: [{
      id: "allocation-august",
      chargeId: "charge-august",
      chargeType: "monthly_training",
      billingPeriod: "2026-08",
      feeReference: "SMBA-FEE-2026-0008",
      description: "August monthly training fee",
      amountPaise: 300_000,
    }],
    refunds: [],
    ...overrides,
  }
}

function registrationReceipt(overrides: Partial<PlayerReceiptView> = {}): PlayerReceiptView {
  return {
    id: "receipt-registration",
    receiptReference: "SMBA-RCP-REGISTRATION",
    amountPaise: 100_000,
    receivedOn: "2026-07-04",
    method: "cash",
    externalReference: null,
    lifecycle: "recorded",
    allocations: [{
      id: "allocation-registration",
      chargeId: "registration",
      chargeType: "registration",
      billingPeriod: null,
      feeReference: "SMBA-REG-0002",
      description: "Academy registration fee",
      amountPaise: 100_000,
    }],
    refunds: [],
    ...overrides,
  }
}

function feeRecord(overrides: Partial<PlayerFeeRecord> = {}): PlayerFeeRecord {
  return {
    archived: false,
    feePlanSetupReady: false,
    financeTrackingMonth: null,
    registrationResolutionRequired: false,
    playerId: "player-owner",
    academyId: "SMBA#0002",
    fullName: "Mira Rao",
    status: "partially_paid",
    currentBalancePaise: 50_000,
    feeAgreement: null,
    setupDefaults: null,
    registrationCharge: registrationCharge(),
    monthlyCharges: [charge()],
    receipts: [monthlyReceipt(), registrationReceipt()],
    concessionEntries: [],
    ...overrides,
  }
}

function renderRecord(record: PlayerFeeRecord, options: {
  requestedMonth?: string
  requestedYear?: string
} = {}) {
  return renderToStaticMarkup(PlayerFeeRecordView({
    currentPeriod: "2026-08",
    record,
    ...options,
  }))
}

function registrationMarkup(html: string, state: "paid" | "due") {
  const match = html.match(new RegExp(
    `<section[^>]*data-registration-state="${state}"[\\s\\S]*?</section>`,
    "u",
  ))
  if (!match) throw new Error(`The ${state} registration band was not rendered.`)
  return match[0]
}

function selectedMonthMarkup(html: string, period: string) {
  const match = html.match(new RegExp(
    `<article[^>]*data-selected-fee-month="${period}"[\\s\\S]*?</article>`,
    "u",
  ))
  if (!match) throw new Error(`The ${period} fee month was not expanded.`)
  return match[0]
}

function monthLinkMarkup(html: string, period: string) {
  const match = html.match(new RegExp(
    `<a[^>]*data-fee-month-cell="${period}"[^>]*>[\\s\\S]*?</a>`,
    "u",
  ))
  if (!match) throw new Error(`The ${period} fee month link was not rendered.`)
  return match[0]
}

function occurrenceCount(value: string, search: string) {
  return value.split(search).length - 1
}

describe("player financial presentation", () => {
  it("formats integer paise, date keys and billing periods for the player ledger", () => {
    expect(formatInr(100_000)).toBe("₹1,000")
    expect(formatInr(100_050)).toBe("₹1,000.50")
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
    }).status).toBe("Player onboarding in progress")
    expect(dashboardFeeRecordCopy({
      status: "partially_paid",
      currentBalancePaise: 200_000,
      nextDueDate: "2026-08-05",
    })).toMatchObject({
      status: "₹2,000 remaining",
      detail: "A payment is recorded. The remaining balance is due by 5 August 2026.",
    })
    expect(dashboardFeeRecordCopy({
      status: "paid",
      currentBalancePaise: 0,
      nextDueDate: null,
    }).status).toBe("No balance due")
  })

  it("keeps the paid registration band compact and the monthly total unambiguous", () => {
    const record = feeRecord({
      concessionEntries: [{
        id: "concession-august",
        chargeId: "charge-august",
        feeReference: "SMBA-FEE-2026-0008",
        amountPaise: 25_000,
        appliedOn: "2026-08-02",
        label: "Fee concession",
        lifecycle: "applied",
      }],
    })

    const html = renderRecord(record)

    expect(html.match(/data-fee-month-cell=/gu)).toHaveLength(12)
    const registration = registrationMarkup(html, "paid")
    const august = selectedMonthMarkup(html, "2026-08")

    expect(registration).toContain("Registration fee")
    expect(registration).toContain("₹1,000")
    expect(registration).toContain("Paid")
    expect(registration).not.toContain("Paid on")
    expect(registration).not.toContain("Settlement")
    expect(registration).not.toContain("Fee charged")
    expect(registration).not.toContain("Fee reference")
    expect(registration).not.toContain("SMBA-REG-0002")
    expect(html).toContain("data-selected-fee-month=\"2026-08\"")
    expect(html).toContain("₹500 due")
    expect(html).toContain("Partially paid")
    expect(august).toContain("Monthly fee received")
    expect(august).not.toContain("Net received")
    expect(august).toContain("SMBA-RCP-AUGUST")
    expect(august).toContain("Payment reference CASHBOOK-4812")
    expect(html).toContain("Fee concession")
    expect(html).toContain("2 August 2026")
    expect(html).not.toContain("Refund issued")
    expect(html).not.toContain("Unused-training credit")
    expect(html).not.toContain("player-owner")
  })

  it("uses one compact due treatment for an unpaid or partially received registration fee", () => {
    const record = feeRecord({
      registrationCharge: registrationCharge({
        receivedPaise: 50_000,
        outstandingPaise: 50_000,
        status: "partially_paid",
        payments: [{
          id: "registration-payment",
          receiptReference: "SMBA-RCP-REGISTRATION",
          amountPaise: 50_000,
          paymentAmountPaise: 50_000,
          receivedOn: "2026-07-04",
          method: "cash",
          externalReference: null,
          lifecycle: "recorded",
        }],
      }),
      receipts: [monthlyReceipt(), registrationReceipt({
        amountPaise: 50_000,
        allocations: [{
          id: "allocation-registration",
          chargeId: "registration",
          chargeType: "registration",
          billingPeriod: null,
          feeReference: "SMBA-REG-0002",
          description: "Academy registration fee",
          amountPaise: 50_000,
        }],
      })],
    })

    const html = renderRecord(record)
    const registration = registrationMarkup(html, "due")

    expect(registration).toContain("Registration fee")
    expect(registration).toContain("₹500")
    expect(registration).toContain(">Due<")
    expect(registration).not.toContain("Received")
    expect(registration).not.toContain("Remaining")
    expect(registration).not.toContain("Due date")
    expect(registration).not.toContain("Fee reference")
    expect(registration).not.toContain("SMBA-REG-0002")
    expect(html).not.toContain("data-registration-state=\"paid\"")
  })

  it("makes a registration-receipt-only month selectable and expands it by default", () => {
    const record = feeRecord({
      status: "paid",
      currentBalancePaise: 0,
      monthlyCharges: [],
      receipts: [registrationReceipt()],
    })

    const html = renderRecord(record)
    const july = selectedMonthMarkup(html, "2026-07")

    expect(html).toMatch(/<a[^>]*data-fee-month-cell="2026-07"/u)
    expect(july).toContain("Registration receipt")
    expect(july).toContain("SMBA-RCP-REGISTRATION")
    expect(july).toContain("Registration fee")
    expect(july).toContain("₹1,000")
    expect(july).not.toContain("Monthly fee received")
    expect(july).not.toContain("Fee charged")
    expect(july).not.toContain("Due date")
    expect(july).not.toContain("No offline payment")
    expect(occurrenceCount(july, "SMBA-RCP-REGISTRATION")).toBe(1)
  })

  it("toggles an expanded month closed while preserving URL-backed year state", () => {
    const record = feeRecord()
    const expanded = renderRecord(record, {
      requestedMonth: "2026-08",
      requestedYear: "2026",
    })
    const augustExpanded = monthLinkMarkup(expanded, "2026-08")
    const julyClosed = monthLinkMarkup(expanded, "2026-07")

    expect(augustExpanded).toContain('href="/player/financials?year=2026"')
    expect(augustExpanded).toContain('aria-expanded="true"')
    expect(augustExpanded).toContain('aria-label="Collapse August 2026 fee details')
    expect(julyClosed).toContain('href="/player/financials?year=2026&amp;month=2026-07"')
    expect(julyClosed).toContain('aria-expanded="false"')

    const collapsed = renderRecord(record, { requestedYear: "2026" })
    const augustClosed = monthLinkMarkup(collapsed, "2026-08")

    expect(collapsed).not.toContain("data-selected-fee-month")
    expect(collapsed).not.toContain('data-selected="true"')
    expect(augustClosed).toContain('href="/player/financials?year=2026&amp;month=2026-08"')
    expect(augustClosed).toContain('aria-expanded="false"')
    expect(augustClosed).toContain('aria-label="View August 2026 fee details')
  })

  it("renders one combined receipt with both allocations and the full receipt total", () => {
    const combined = monthlyReceipt({
      id: "receipt-combined",
      receiptReference: "SMBA-RCP-COMBINED",
      amountPaise: 400_000,
      allocations: [{
        id: "allocation-registration-combined",
        chargeId: "registration",
        chargeType: "registration",
        billingPeriod: null,
        feeReference: "SMBA-REG-0002",
        description: "Academy registration fee",
        amountPaise: 100_000,
      }, {
        id: "allocation-august-combined",
        chargeId: "charge-august",
        chargeType: "monthly_training",
        billingPeriod: "2026-08",
        feeReference: "SMBA-FEE-2026-0008",
        description: "August monthly training fee",
        amountPaise: 300_000,
      }],
    })
    const html = renderRecord(feeRecord({ receipts: [combined] }))
    const august = selectedMonthMarkup(html, "2026-08")

    expect(august.match(/data-fee-receipt-row/gu)).toHaveLength(1)
    expect(august).toContain("Registration + monthly receipt")
    expect(august).toContain("Registration fee")
    expect(august).toContain("August monthly fee")
    expect(august).toContain("₹1,000")
    expect(august).toContain("₹3,000")
    expect(august).toContain("₹4,000")
    expect(occurrenceCount(august, "SMBA-RCP-COMBINED")).toBe(1)
  })

  it("stacks multiple receipt rows newest first without duplicating a reference", () => {
    const receipts = [
      monthlyReceipt({
        id: "receipt-first",
        receiptReference: "SMBA-RCP-FIRST",
        amountPaise: 100_000,
        receivedOn: "2026-08-01",
        externalReference: null,
        allocations: [{
          id: "allocation-first",
          chargeId: "charge-august",
          chargeType: "monthly_training",
          billingPeriod: "2026-08",
          feeReference: "SMBA-FEE-2026-0008",
          description: "August monthly training fee",
          amountPaise: 100_000,
        }],
      }),
      monthlyReceipt({
        id: "receipt-second",
        receiptReference: "SMBA-RCP-SECOND",
        amountPaise: 100_000,
        receivedOn: "2026-08-03",
        externalReference: null,
        allocations: [{
          id: "allocation-second",
          chargeId: "charge-august",
          chargeType: "monthly_training",
          billingPeriod: "2026-08",
          feeReference: "SMBA-FEE-2026-0008",
          description: "August monthly training fee",
          amountPaise: 100_000,
        }],
      }),
      monthlyReceipt({
        id: "receipt-third",
        receiptReference: "SMBA-RCP-THIRD",
        amountPaise: 100_000,
        receivedOn: "2026-08-05",
        externalReference: null,
        allocations: [{
          id: "allocation-third",
          chargeId: "charge-august",
          chargeType: "monthly_training",
          billingPeriod: "2026-08",
          feeReference: "SMBA-FEE-2026-0008",
          description: "August monthly training fee",
          amountPaise: 100_000,
        }],
      }),
    ]
    const august = selectedMonthMarkup(
      renderRecord(feeRecord({ receipts })),
      "2026-08",
    )

    expect(august.match(/data-fee-receipt-row/gu)).toHaveLength(3)
    expect(august.match(/Monthly fee receipt/gu)).toHaveLength(3)
    expect(august.indexOf("SMBA-RCP-THIRD")).toBeLessThan(august.indexOf("SMBA-RCP-SECOND"))
    expect(august.indexOf("SMBA-RCP-SECOND")).toBeLessThan(august.indexOf("SMBA-RCP-FIRST"))
    receipts.forEach((receipt) => {
      expect(occurrenceCount(august, receipt.receiptReference)).toBe(1)
    })
  })

  it("places every receipt in its received month rather than its charge month", () => {
    const julyCharge = charge({
      id: "charge-july",
      feeReference: "SMBA-FEE-2026-0007",
      billingPeriod: "2026-07",
      description: "July monthly training fee",
      receivedPaise: 350_000,
      outstandingPaise: 0,
      status: "paid",
      payments: [{
        id: "payment-july-late",
        receiptReference: "SMBA-RCP-JULY-LATE",
        amountPaise: 350_000,
        paymentAmountPaise: 350_000,
        receivedOn: "2026-08-02",
        method: "cash",
        externalReference: null,
        lifecycle: "recorded",
      }],
    })
    const lateReceipt = monthlyReceipt({
      id: "receipt-july-late",
      receiptReference: "SMBA-RCP-JULY-LATE",
      amountPaise: 350_000,
      receivedOn: "2026-08-02",
      externalReference: null,
      allocations: [{
        id: "allocation-july-late",
        chargeId: "charge-july",
        chargeType: "monthly_training",
        billingPeriod: "2026-07",
        feeReference: "SMBA-FEE-2026-0007",
        description: "July monthly training fee",
        amountPaise: 350_000,
      }],
    })
    const record = feeRecord({
      monthlyCharges: [julyCharge],
      receipts: [lateReceipt],
    })

    const july = selectedMonthMarkup(renderRecord(record, {
      requestedMonth: "2026-07",
      requestedYear: "2026",
    }), "2026-07")
    const august = selectedMonthMarkup(renderRecord(record, {
      requestedMonth: "2026-08",
      requestedYear: "2026",
    }), "2026-08")

    expect(july).not.toContain("SMBA-RCP-JULY-LATE")
    expect(august).toContain("SMBA-RCP-JULY-LATE")
    expect(august).toContain("July monthly fee")
    expect(august).toContain("Monthly fee receipt")
  })

  it("adds a receipt year outside the default season window and restores its month", () => {
    const historicalRegistration = registrationCharge({
      dueDate: "2022-12-04",
      payments: [{
        id: "registration-payment-historical",
        receiptReference: "SMBA-RCP-REGISTRATION-HISTORICAL",
        amountPaise: 100_000,
        paymentAmountPaise: 100_000,
        receivedOn: "2023-01-04",
        method: "cash",
        externalReference: null,
        lifecycle: "recorded",
      }],
    })
    const historicalReceipt = registrationReceipt({
      id: "receipt-registration-historical",
      receiptReference: "SMBA-RCP-REGISTRATION-HISTORICAL",
      receivedOn: "2023-01-04",
    })
    const html = renderRecord(feeRecord({
      registrationCharge: historicalRegistration,
      monthlyCharges: [],
      receipts: [historicalReceipt],
      status: "paid",
      currentBalancePaise: 0,
    }), {
      requestedMonth: "2023-01",
      requestedYear: "2023",
    })

    expect(html).toContain(">2023</a>")
    expect(html).toContain("data-selected-fee-month=\"2023-01\"")
    expect(selectedMonthMarkup(html, "2023-01"))
      .toContain("SMBA-RCP-REGISTRATION-HISTORICAL")
  })

  it("overrides a numerically paid withdrawal month with the truthful closed state", () => {
    const withdrawnCharge = charge({
      effectiveAmountPaise: 300_000,
      receivedPaise: 300_000,
      outstandingPaise: 0,
      status: "paid",
      payments: [{
        id: "payment-august",
        receiptReference: "SMBA-RCP-AUGUST",
        amountPaise: 350_000,
        paymentAmountPaise: 350_000,
        receivedOn: "2026-08-03",
        method: "cash",
        externalReference: null,
        lifecycle: "recorded",
      }],
    })
    const record = feeRecord({
      status: "paid",
      currentBalancePaise: 0,
      monthlyCharges: [withdrawnCharge],
      receipts: [{
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
        refunds: [{
          id: "refund-august",
          paymentId: "receipt-august",
          receiptReference: "SMBA-RCP-AUGUST",
          refundReference: "SMBA-RFD-AUGUST",
          purpose: "mid_term_withdrawal",
          amountPaise: 50_000,
          withdrawalEffectiveOn: "2026-08-18",
          refundedOn: "2026-08-19",
          lifecycle: "recorded",
        }],
      }],
    })

    const html = renderRecord(record)

    expect(html).toContain("Closed after withdrawal")
    expect(html).toContain("Offline paid")
    expect(html).toContain("₹3,500")
    expect(html).toContain("Unused-training credit")
    expect(html).toContain("Refund issued")
    expect(html).toContain("SMBA-RFD-AUGUST")
    expect(html).toContain("Withdrawal 18 August 2026")
    expect(html).not.toContain("<dt>Remaining</dt>")
  })

  it("restores a valid previous fee season and leaves empty seasons unexpanded", () => {
    const july2025 = charge({
      id: "charge-july-2025",
      billingPeriod: "2025-07",
      dueDate: "2025-07-05",
      feeReference: "SMBA-FEE-2025-0007",
      status: "paid",
      receivedPaise: 350_000,
      outstandingPaise: 0,
    })
    const record = feeRecord({ monthlyCharges: [charge(), july2025] })

    const previousYear = renderRecord(record, {
      requestedMonth: "2025-07",
      requestedYear: "2025",
    })
    expect(previousYear).toContain("data-selected-fee-month=\"2025-07\"")
    expect(previousYear).toContain("aria-label=\"2025 monthly fee record\"")

    const emptyYear = renderRecord(record, { requestedYear: "2024" })
    expect(emptyYear).toContain("aria-label=\"2024 monthly fee record\"")
    expect(emptyYear).not.toContain("data-selected-fee-month")
  })

  it("does not render coach-private finance fields even if an unsafe caller supplies them", () => {
    const unsafeRecord = {
      ...feeRecord(),
      playerId: "private-player-id",
      monthlyCharges: [charge({ id: "private-charge-id" })],
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
          chargeType: "monthly_training",
          billingPeriod: "2026-08",
          feeReference: "SMBA-FEE-SAFE",
          description: "August monthly training fee",
          amountPaise: 100_000,
          actorAccountId: "private-coach-id",
        }],
        refunds: [],
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

    const html = renderRecord(unsafeRecord)

    expect(html).toContain("SMBA-RCP-SAFE")
    expect(html).toContain("Reversed")
    expect(html).toContain("Fee concession")
    expect(html).toContain("Concession reversed")
    expect(html).not.toContain("Private coach receipt note")
    expect(html).not.toContain("Private concession reason")
    expect(html).not.toContain("Private management note")
    expect(html).not.toContain("private-coach-id")
    expect(html).not.toContain("private-receipt-key")
    expect(html).not.toContain("private-player-id")
  })
})
