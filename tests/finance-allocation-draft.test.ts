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

  it("formats suggested values and parses concession percentages precisely", () => {
    expect(createAllocationDraft([
      { id: "registration", amountPaise: 50_050 },
      { id: "monthly", amountPaise: 350_000 },
    ])).toEqual({ registration: "500.50", monthly: "3500" })
    expect(parsePercentageToBasisPoints("7.5")).toBe(750)
    expect(parsePercentageToBasisPoints("100")).toBe(10_000)
    expect(parsePercentageToBasisPoints("100.01")).toBeNull()
  })
})
