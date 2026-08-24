import { describe, expect, it, vi } from "vitest"

import type { ExportTruncation } from "@/lib/finance/csv-truncation"
import {
  activityCsvLines,
  feeRegisterCsvLines,
} from "@/lib/finance/records-csv"
import type { FinanceRegisterRow } from "@/lib/finance/types"

// Every row in these cases is one the encoder can write, so a truncation here
// would be a real failure. Rethrowing keeps it a failure: the notice the
// encoder emits instead would otherwise let a broken row pass as a passing test.
const failOnTruncation: ExportTruncation = (error) => {
  throw error
}

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
    }], failOnTruncation)].join("")

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
    }], failOnTruncation)].join("")

    expect(output).toContain("2026-08-08 7:00 am IST")
    expect(output).toContain("Payment recorded")
    expect(output).toContain("3500.00")
  })

  // F-17: the register is drained lazily, so this is what a failed page read
  // looks like from inside the line generator. The rows already written stay,
  // and the file states that it stops there.
  it("ends the register at a failed read and keeps the rows it already wrote", () => {
    const onTruncated = vi.fn<ExportTruncation>(() => "Run the export again.")
    const rows = [...feeRegisterCsvLines((function* register() {
      yield {
        academyId: "SMBA#0042",
        archived: false,
        billingPeriod: "2026-08",
        chargeId: "charge-1",
        creditAdjustmentsPaise: 0,
        debitAdjustmentsPaise: 0,
        dueDate: "2026-08-05",
        effectiveAmountPaise: 340_000,
        feeReference: "SMBA-2A4C6E8G",
        fullName: "Aarav Bhat",
        originalAmountPaise: 350_000,
        outstandingPaise: 140_000,
        playerId: "player-1",
        receivedPaise: 200_000,
        status: "partially_paid",
        type: "monthly_training",
      } satisfies FinanceRegisterRow
      throw new Error("SQLITE_BUSY: database is locked")
    })(), onTruncated)]

    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain("Aarav Bhat")
    expect(rows[2]).toContain("EXPORT INCOMPLETE")
    expect(rows[2]).toContain("Run the export again.")
    expect(onTruncated).toHaveBeenCalledWith(expect.anything(), 1)
  })
})
