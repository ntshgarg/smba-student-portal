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
  onboardingComplete: false,
  trainsWithoutFeePlan: false,
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
      refundNeedsTrainingEnded: false,
      refundBlockedByBookedStart: false,
      refundWindow: null,
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
 * Fee changes, concessions and ending a fee plan moved to the player's record
 * in Members on 5 Oct 2026 (components/coach/members/directory/
 * member-training-actions.tsx), next to the schedule they usually change with.
 * The fee record still shows the plan, and points the coach there. The Elite
 * case that used to live here -- a level with no standard fee must still be
 * editable -- is now the Members form's "agree one with the player" note.
 */
describe("a fee record once fee changes live in Members", () => {
  const activeLedger: PlayerFinancialLedgerView = {
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
      effectiveTo: null,
      id: "agreement-elite",
      label: "5-day plan",
      level: "Elite",
      recordRevision: 0,
      standing: "running",
      status: "active",
      upcoming: null,
    },
    feePlanSetupReady: true,
    management: { concessions: [], receipts: [], refunds: [] },
    status: "paid",
  }

  it("shows the plan and sends fee changes to the player's record in Members", () => {
    const html = renderToStaticMarkup(
      <PlayerLedger focused ledger={activeLedger} period="2026-08" />,
    )

    expect(html).toContain("Agreed monthly fee")
    expect(html).toContain(`/coach/members?player=${activeLedger.playerId}`)
    expect(html).not.toContain("Change fee plan")
    expect(html).not.toContain("End fee plan")
    expect(html).not.toContain("Add concession")
  })
})
