import { describe, expect, it } from "vitest"

import {
  activityCsvLines,
  feeRegisterCsvLines,
} from "@/lib/finance/records-csv"

describe("financial record CSV exports", () => {
  it("exports current fee-register facts and neutralizes spreadsheet formulas", () => {
    const output = [...feeRegisterCsvLines([{
      academyId: "SMBA#0042",
      archived: false,
      billingPeriod: "2026-08",
      chargeId: "charge-1",
      creditAdjustmentsPaise: 10_000,
      debitAdjustmentsPaise: 0,
      dueDate: "2026-08-05",
      effectiveAmountPaise: 340_000,
      feeReference: "SMBA-2A4C6E8G",
      fullName: "=FORMULA()",
      originalAmountPaise: 350_000,
      outstandingPaise: 140_000,
      playerId: "player-1",
      receivedPaise: 200_000,
      status: "partially_paid",
      type: "monthly_training",
    }])].join("")

    expect(output).toContain("'=FORMULA()")
    expect(output).toContain("3500.00,100.00,0.00,3400.00,2000.00,1400.00")
    expect(output).toContain("partially paid")
  })

  it("formats activity timestamps through the academy timezone contract", () => {
    const output = [...activityCsvLines([{
      academyId: "SMBA#0042",
      action: "Payment recorded",
      actorId: "coach-1",
      actorName: "Sathiya Moorthy",
      amountPaise: 350_000,
      eventType: "payment_recorded",
      id: "event-1",
      occurredAt: "2026-08-08T01:30:00.000Z",
      playerId: "player-1",
      playerName: "Aarav Bhat",
      reason: null,
      reference: "SMBA-R-2026-00042",
    }])].join("")

    expect(output).toContain("2026-08-08 7:00 am IST")
    expect(output).toContain("Payment recorded")
    expect(output).toContain("3500.00")
  })
})
