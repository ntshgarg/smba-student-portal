import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(),
}))

import { PlayerLedger } from "@/components/coach/financials/player-ledger"
import type { PlayerFinancialLedgerView } from "@/components/coach/financials/types"

const archivedLedger: PlayerFinancialLedgerView = {
  academyId: "SMBA#0042",
  archived: true,
  charges: [],
  enrollmentDefaults: null,
  feePlanSetupReady: false,
  feePlan: null,
  fullName: "Aarav Bhat",
  management: {
    concessions: [{
      applications: [{
        amountPaise: 50_000,
        applicationId: "application-42",
        appliedOn: "2026-08-02",
        canReverse: true,
        chargeId: "charge-42",
        concessionId: "concession-42",
        feeReference: "SMBA-FEE-42",
        id: "entry-42",
        label: "Fee concession",
        lifecycle: "applied",
      }],
      canReverse: true,
      endsPeriod: null,
      id: "concession-42",
      lifecycle: "active",
      mode: "one_off",
      playerId: "player-42",
      reason: "Academy scholarship",
      recordRevision: 1,
      startsPeriod: null,
      value: 50_000,
      valueKind: "fixed",
    }],
    receipts: [{
      allocations: [{
        amountPaise: 50_000,
        billingPeriod: "2026-08",
        chargeId: "charge-42",
        chargeType: "monthly_training",
        description: "August monthly training fee",
        feeReference: "SMBA-FEE-42",
        id: "allocation-42",
        paymentAllocationId: "allocation-42",
        refundablePaise: 0,
      }],
      amountPaise: 50_000,
      canRefund: false,
      externalReference: null,
      id: "payment-42",
      internalNote: null,
      lifecycle: "recorded",
      method: "upi",
      receiptReference: "SMBA-R-2026-00042",
      receivedOn: "2026-08-02",
      recordRevision: 1,
      refundablePaise: 0,
      refunds: [],
    }],
    refunds: [],
  },
  outstandingPaise: 0,
  playerId: "player-42",
  setupDefaults: null,
  status: "paid",
}

describe("focused player fee record", () => {
  it("keeps archived history visible and all archived mutation controls absent", () => {
    const html = renderToStaticMarkup(
      <PlayerLedger
        ledger={archivedLedger}
        period="2026-08"
        showReceiptDownloads
      />,
    )

    expect(html).toContain("Concessions previously recorded for this player.")
    expect(html).toContain("Academy scholarship")
    expect(html).toContain("SMBA-FEE-42")
    expect(html).toContain("SMBA-R-2026-00042")
    expect(html).toContain('href="/coach/financials/receipts/payment-42/download"')
    expect(html).toContain('aria-label="Download receipt SMBA-R-2026-00042"')

    expect(html).not.toContain("Create concession")
    expect(html).not.toContain("Apply concession")
    expect(html).not.toContain("End concession")
    expect(html).not.toContain("Corrections")
    expect(html).not.toContain("Record payment")
  })

  it("returns first-time fee-plan setup to the consolidated onboarding workflow", () => {
    const setupLedger: PlayerFinancialLedgerView = {
      ...archivedLedger,
      archived: false,
      enrollmentDefaults: {
        academyPlan: "weekday-3-day",
        academyPlanLabel: "3-day plan",
        batch: "Weekday",
        level: "Beginner",
        suggestedMonthlyFeePaise: 350_000,
      },
      feePlanSetupReady: true,
      setupDefaults: {
        academyPlan: "weekday-3-day",
        academyPlanLabel: "3-day plan",
        batch: "Weekday",
        level: "Beginner",
        suggestedMonthlyFeePaise: 350_000,
      },
      management: { concessions: [], receipts: [], refunds: [] },
      status: "setup_required",
    }

    const html = renderToStaticMarkup(
      <PlayerLedger focused ledger={setupLedger} period="2026-08" />,
    )

    expect(html).toContain("Complete this player’s onboarding first")
    expect(html).toContain("Continue Player Onboarding")
    expect(html).toContain(`/coach/onboarding?player=${setupLedger.playerId}`)
    expect(html).not.toContain("Create fee plan")
  })

  it("keeps the old finance route from bypassing session assignment", () => {
    const setupLedger: PlayerFinancialLedgerView = {
      ...archivedLedger,
      archived: false,
      enrollmentDefaults: {
        academyPlan: "weekday-3-day",
        academyPlanLabel: "3-day plan",
        batch: "Weekday",
        level: "Beginner",
        suggestedMonthlyFeePaise: 350_000,
      },
      feePlanSetupReady: false,
      setupDefaults: {
        academyPlan: "weekday-3-day",
        academyPlanLabel: "3-day plan",
        batch: "Weekday",
        level: "Beginner",
        suggestedMonthlyFeePaise: 350_000,
      },
      management: { concessions: [], receipts: [], refunds: [] },
      status: "setup_required",
    }

    const html = renderToStaticMarkup(
      <PlayerLedger focused ledger={setupLedger} period="2026-08" />,
    )

    expect(html).toContain("Complete this player’s onboarding first")
    expect(html).toContain("Continue Player Onboarding")
    expect(html).toContain(`/coach/onboarding?player=${setupLedger.playerId}`)
    expect(html).not.toContain("Agreed monthly fee")
    expect(html).not.toContain("Create fee plan")
  })
})

/*
 * Elite has no standard monthly fee -- terms are agreed per player -- so
 * `defaultMonthlyFeePaise` returns null for it. `enrollmentDefaults` used to
 * require that amount, so a fee-less level produced a null classification,
 * `feePlanSetupReady` went false, and the fee-plan editor returned null: the
 * player was billable and un-editable, with nothing on screen to say why.
 */
describe("a level with no standard fee", () => {
  const eliteLedger: PlayerFinancialLedgerView = {
    ...archivedLedger,
    archived: false,
    enrollmentDefaults: {
      academyPlan: "weekday-5-day",
      academyPlanLabel: "5-day plan",
      batch: "Weekday",
      level: "Elite",
      suggestedMonthlyFeePaise: null,
    },
    feePlan: {
      academyPlan: "weekday-5-day",
      agreedMonthlyFeePaise: 1_800_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      id: "agreement-elite",
      label: "5-day plan",
      level: "Elite",
      recordRevision: 0,
      status: "active",
    },
    feePlanSetupReady: true,
    management: { concessions: [], receipts: [], refunds: [] },
    status: "paid",
  }

  it("still offers the fee-plan editor", () => {
    const html = renderToStaticMarkup(
      <PlayerLedger focused ledger={eliteLedger} period="2026-08" />,
    )

    expect(html).toContain("Change fee plan")
    expect(html).not.toContain("classification needs review")
  })

  it("says the fee is agreed per player rather than showing a price", () => {
    const html = renderToStaticMarkup(
      <PlayerLedger focused ledger={eliteLedger} period="2026-08" />,
    )

    expect(html).toContain("Standard fee")
    expect(html).toContain("agreed per player")
  })

  it("shows the standard fee for a level that has one", () => {
    const html = renderToStaticMarkup(
      <PlayerLedger
        focused
        ledger={{
          ...eliteLedger,
          enrollmentDefaults: {
            academyPlan: "weekday-3-day",
            academyPlanLabel: "3-day plan",
            batch: "Weekday",
            level: "Beginner",
            suggestedMonthlyFeePaise: 350_000,
          },
        }}
        period="2026-08"
      />,
    )

    expect(html).toContain("Standard fee")
    expect(html).not.toContain("agreed per player")
  })

  it("names a classification that no longer forms a valid combination", () => {
    const html = renderToStaticMarkup(
      <PlayerLedger
        focused
        ledger={{ ...eliteLedger, enrollmentDefaults: null }}
        period="2026-08"
      />,
    )

    expect(html).toContain("classification needs review")
    expect(html).not.toContain("Change fee plan")
  })
})
