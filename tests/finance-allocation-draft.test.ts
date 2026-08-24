import { describe, expect, it } from "vitest"

import {
  createAllocationDraft,
  parsePercentageToBasisPoints,
  validateAllocationDraft,
} from "@/components/coach/financials/allocation-draft"

describe("Financials allocation drafts", () => {
  const limits = [
    { id: "registration", availablePaise: 100_000 },
    { id: "monthly", availablePaise: 350_000 },
  ]

  it("accepts an exact multi-charge allocation and omits zero rows", () => {
    expect(validateAllocationDraft({
      expectedTotalPaise: 400_000,
      limits,
      values: { registration: "500", monthly: "3500" },
    })).toEqual({
      ok: true,
      allocations: [
        { id: "registration", amountPaise: 50_000 },
        { id: "monthly", amountPaise: 350_000 },
      ],
      totalPaise: 400_000,
    })

    expect(validateAllocationDraft({
      expectedTotalPaise: 350_000,
      limits,
      values: { registration: "0", monthly: "3500" },
    })).toMatchObject({
      ok: true,
      allocations: [{ id: "monthly", amountPaise: 350_000 }],
    })
  })

  it("rejects incomplete and over-limit allocation drafts", () => {
    expect(validateAllocationDraft({
      expectedTotalPaise: 400_000,
      limits,
      values: { registration: "500", monthly: "3000" },
    })).toMatchObject({ ok: false, message: "Allocate the complete amount before continuing" })

    expect(validateAllocationDraft({
      expectedTotalPaise: 400_000,
      limits,
      values: { registration: "1500", monthly: "2500" },
    })).toMatchObject({
      ok: false,
      fieldId: "registration",
      message: "An allocation cannot exceed the available amount",
    })
  })

  it("formats suggested values and accepts only whole concession percentages", () => {
    expect(createAllocationDraft([
      { id: "registration", amountPaise: 50_050 },
      { id: "monthly", amountPaise: 350_000 },
    ])).toEqual({ registration: "500.50", monthly: "3500" })
    expect(parsePercentageToBasisPoints("7")).toBe(700)
    expect(parsePercentageToBasisPoints("100")).toBe(10_000)
    // A fraction of a percent is the one coach input that can put a part-rupee
    // amount into a ledger denominated in whole rupees: 12.5% of the Rs 6,500
    // plan is Rs 812.50. Fees round to Rs 50 and refunds are the only other
    // sub-rupee source, and that one is deliberate.
    expect(parsePercentageToBasisPoints("7.5")).toBeNull()
    expect(parsePercentageToBasisPoints("12.5")).toBeNull()
    expect(parsePercentageToBasisPoints("100.01")).toBeNull()
    expect(parsePercentageToBasisPoints("0")).toBeNull()
    expect(parsePercentageToBasisPoints("101")).toBeNull()
  })
})
