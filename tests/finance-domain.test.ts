import { describe, expect, it } from "vitest"

import {
  addCalendarDays,
  calculateChargeLedger,
  calculateConcessionAmount,
  combineFinanceStatuses,
  deriveFinanceStatus,
  financialPayloadFingerprint,
  formatFinancialSequenceReference,
  isValidFeeReference,
} from "@/lib/finance/domain"

describe("finance domain", () => {
  it("derives ledger balances exclusively from persisted facts", () => {
    const charge = {
      originalAmountPaise: 400_000,
      dueDate: "2026-08-05",
      lifecycle: "issued" as const,
      payments: [
        { amountPaise: 100_000, lifecycle: "recorded" as const },
        { amountPaise: 25_000, lifecycle: "reversed" as const },
      ],
      adjustments: [
        { kind: "manual_debit" as const, amountPaise: 50_000, reversedAt: null },
        { kind: "manual_credit" as const, amountPaise: 25_000, reversedAt: null },
        { kind: "manual_credit" as const, amountPaise: 75_000, reversedAt: new Date() },
      ],
    }
    expect(calculateChargeLedger(charge)).toEqual({
      effectiveAmountPaise: 425_000,
      receivedPaise: 100_000,
      outstandingPaise: 325_000,
    })
    expect(deriveFinanceStatus(charge, "2026-08-04")).toBe("partially_paid")
  })

  it("distinguishes pending, overdue, paid and void charges", () => {
    const base = {
      originalAmountPaise: 100_000,
      dueDate: "2026-08-05",
      lifecycle: "issued" as const,
      payments: [],
      adjustments: [],
    }
    expect(deriveFinanceStatus(base, "2026-08-05")).toBe("pending")
    expect(deriveFinanceStatus(base, "2026-08-06")).toBe("overdue")
    expect(deriveFinanceStatus({
      ...base,
      payments: [{ amountPaise: 25_000, lifecycle: "recorded" as const }],
    }, "2026-08-06")).toBe("partially_paid")
    expect(deriveFinanceStatus({
      ...base,
      payments: [{ amountPaise: 100_000, lifecycle: "recorded" as const }],
    }, "2026-08-06")).toBe("paid")
    expect(deriveFinanceStatus({
      ...base,
      adjustments: [{
        amountPaise: 100_000,
        kind: "legacy_settlement" as const,
        reversedAt: null,
      }],
    }, "2026-08-06")).toBe("paid")
    const voidCharge = { ...base, lifecycle: "void" as const }
    expect(deriveFinanceStatus(voidCharge, "2026-08-06")).toBe("void")
    expect(calculateChargeLedger(voidCharge)).toMatchObject({
      effectiveAmountPaise: 0,
      outstandingPaise: 0,
    })
    expect(combineFinanceStatuses(["paid", "overdue"])).toBe("overdue")
  })

  it("uses opaque references and deterministic date-only calendar arithmetic", () => {
    expect(isValidFeeReference("SMBA-7K4M2P8Q")).toBe(true)
    expect(isValidFeeReference("SMBA-202608-7K4M2P8Q")).toBe(false)
    expect(addCalendarDays("2026-08-31", 3)).toBe("2026-09-03")
  })

  it("calculates fixed and half-up percentage concessions without exceeding the balance", () => {
    expect(calculateConcessionAmount({
      originalAmountPaise: 100_000,
      outstandingPaise: 80_000,
      value: 30_000,
      valueKind: "fixed",
    })).toBe(30_000)
    expect(calculateConcessionAmount({
      originalAmountPaise: 100_000,
      outstandingPaise: 20_000,
      value: 30_000,
      valueKind: "fixed",
    })).toBe(20_000)
    // 50% of 101 paise is 50.5; financial percentages round half-up.
    expect(calculateConcessionAmount({
      originalAmountPaise: 101,
      outstandingPaise: 101,
      value: 5_000,
      valueKind: "percentage",
    })).toBe(51)
    expect(calculateConcessionAmount({
      originalAmountPaise: 101,
      outstandingPaise: 20,
      value: 5_000,
      valueKind: "percentage",
    })).toBe(20)
  })

  it("creates independent deterministic receipt/refund references and canonical fingerprints", () => {
    expect(formatFinancialSequenceReference("receipt", 2026, 12))
      .toBe("SMBA-R-2026-00012")
    expect(formatFinancialSequenceReference("refund", 2026, 12))
      .toBe("SMBA-RF-2026-00012")
    expect(financialPayloadFingerprint({ amount: 10, nested: { b: 2, a: 1 } }))
      .toBe(financialPayloadFingerprint({ nested: { a: 1, b: 2 }, amount: 10 }))
  })
})
