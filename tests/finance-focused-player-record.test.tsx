import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { PlayerLedger } from "@/components/coach/financials/player-ledger"
import type { PlayerFinancialLedgerView } from "@/components/coach/financials/types"

const archivedLedger: PlayerFinancialLedgerView = {
  academyId: "SMBA#0042",
  archived: true,
  charges: [],
  enrollmentDefaults: null,
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
        chargeId: "charge-42",
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
})
