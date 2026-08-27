import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  calculateChargeLedger,
  calculateConcessionAmount,
  calculateProratedSessionFee,
  financialPayloadFingerprint,
  formatFinancialSequenceReference,
  type LedgerAdjustmentFact,
  type LedgerChargeFact,
  type LedgerPaymentFact,
  type LedgerRefundFact,
} from "@/lib/finance/domain"
import { parseRupeesToPaise } from "@/lib/format"
import {
  createAllocationDraft,
  paiseToRupeesInput,
  validateAllocationDraft,
} from "@/components/coach/financials/allocation-draft"

const PROPERTY_RUNS = 200
const MAX_MONEY_PAISE = 1_000_000_000
const REVERSED_AT = new Date("2026-08-09T00:00:00.000Z")

const moneyArbitrary = fc.integer({ min: 0, max: MAX_MONEY_PAISE })
const positiveMoneyArbitrary = fc.integer({ min: 1, max: MAX_MONEY_PAISE })

const adjustmentArbitrary: fc.Arbitrary<LedgerAdjustmentFact> = fc.record({
  amountPaise: moneyArbitrary,
  kind: fc.constantFrom(
    "manual_credit",
    "manual_debit",
    "concession_credit",
    "withdrawal_credit",
    "legacy_settlement",
  ),
  reversedAt: fc.boolean().map((reversed) => (reversed ? REVERSED_AT : null)),
})

const paymentArbitrary: fc.Arbitrary<LedgerPaymentFact> = fc.record({
  amountPaise: moneyArbitrary,
  lifecycle: fc.constantFrom("recorded", "reversed"),
})

const refundArbitrary: fc.Arbitrary<LedgerRefundFact> = fc.record({
  amountPaise: moneyArbitrary,
  lifecycle: fc.constantFrom("recorded", "reversed"),
})

const chargeArbitrary: fc.Arbitrary<LedgerChargeFact> = fc.record({
  adjustments: fc.array(adjustmentArbitrary, { maxLength: 10 }),
  dueDate: fc.constant("2026-08-05"),
  lifecycle: fc.constantFrom("issued", "void"),
  originalAmountPaise: moneyArbitrary,
  payments: fc.array(paymentArbitrary, { maxLength: 10 }),
  refunds: fc.array(refundArbitrary, { maxLength: 10 }),
})

const allocationArbitrary = fc.uniqueArray(fc.record({
  amountPaise: fc.integer({ min: 1, max: 100_000_000 }),
  id: fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/u),
}), {
  maxLength: 8,
  minLength: 1,
  selector: (allocation) => allocation.id,
})

const concessionArbitrary = fc.oneof(
  fc.record({
    originalAmountPaise: moneyArbitrary,
    outstandingPair: fc.tuple(moneyArbitrary, moneyArbitrary),
    valueKind: fc.constant<"fixed">("fixed"),
    valuePair: fc.tuple(positiveMoneyArbitrary, positiveMoneyArbitrary),
  }),
  fc.record({
    originalAmountPaise: moneyArbitrary,
    outstandingPair: fc.tuple(moneyArbitrary, moneyArbitrary),
    valueKind: fc.constant<"percentage">("percentage"),
    valuePair: fc.tuple(
      fc.integer({ min: 1, max: 10_000 }),
      fc.integer({ min: 1, max: 10_000 }),
    ),
  }),
)

const jsonPrimitiveArbitrary = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.string({ maxLength: 40 }),
)

const jsonValueArbitrary: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    jsonPrimitiveArbitrary,
    fc.array(tie("value"), { maxLength: 5 }),
    fc.dictionary(fc.string({ maxLength: 12 }), tie("value"), { maxKeys: 5 }),
  ),
})).value

const sequenceInputArbitrary = fc.record({
  kind: fc.constantFrom<"receipt" | "refund">("receipt", "refund"),
  sequence: fc.integer({ min: 1, max: 99_999 }),
  year: fc.integer({ min: 2_000, max: 9_999 }),
})

function reverseObjectKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, item]) => [key, reverseObjectKeyOrder(item)]))
  }
  return value
}

describe("finance domain properties", () => {
  it("derives the same ledger from reordered facts and ignores reversed or net-zero facts", () => {
    fc.assert(fc.property(chargeArbitrary, moneyArbitrary, (charge, amountPaise) => {
      const baseline = calculateChargeLedger(charge)

      expect(calculateChargeLedger({
        ...charge,
        adjustments: [...charge.adjustments].reverse(),
        payments: [...charge.payments].reverse(),
        refunds: [...(charge.refunds ?? [])].reverse(),
      })).toEqual(baseline)

      expect(calculateChargeLedger({
        ...charge,
        adjustments: [
          ...charge.adjustments,
          { amountPaise, kind: "manual_debit", reversedAt: REVERSED_AT },
        ],
        payments: [...charge.payments, { amountPaise, lifecycle: "reversed" }],
        refunds: [...(charge.refunds ?? []), { amountPaise, lifecycle: "reversed" }],
      })).toEqual(baseline)

      expect(calculateChargeLedger({
        ...charge,
        payments: [...charge.payments, { amountPaise, lifecycle: "recorded" }],
        refunds: [...(charge.refunds ?? []), { amountPaise, lifecycle: "recorded" }],
      })).toEqual(baseline)

      expect(baseline.effectiveAmountPaise).toBeGreaterThanOrEqual(0)
      expect(baseline.receivedPaise).toBeGreaterThanOrEqual(0)
      expect(baseline.outstandingPaise).toBeGreaterThanOrEqual(0)
    }), { numRuns: PROPERTY_RUNS })
  })

  it("round-trips paise and validates exact generated allocation drafts", () => {
    fc.assert(fc.property(moneyArbitrary, (amountPaise) => {
      expect(parseRupeesToPaise(paiseToRupeesInput(amountPaise), true)).toBe(amountPaise)
    }), { numRuns: PROPERTY_RUNS })

    fc.assert(fc.property(allocationArbitrary, (allocations) => {
      const expectedTotalPaise = allocations.reduce(
        (total, allocation) => total + allocation.amountPaise,
        0,
      )
      const result = validateAllocationDraft({
        expectedTotalPaise,
        limits: allocations.map(({ id, amountPaise }) => ({
          id,
          availablePaise: amountPaise,
        })),
        values: createAllocationDraft(allocations),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.message)
      expect(result.allocations).toEqual(allocations)
      expect(result.totalPaise).toBe(expectedTotalPaise)
    }), { numRuns: PROPERTY_RUNS })
  })

  it("keeps concessions bounded and monotonic", () => {
    fc.assert(fc.property(concessionArbitrary, (input) => {
      const [lowerOutstanding, higherOutstanding] = [...input.outstandingPair]
        .sort((left, right) => left - right)
      const [lowerValue, higherValue] = [...input.valuePair]
        .sort((left, right) => left - right)

      const lowerOutstandingResult = calculateConcessionAmount({
        originalAmountPaise: input.originalAmountPaise,
        outstandingPaise: lowerOutstanding,
        value: lowerValue,
        valueKind: input.valueKind,
      })
      const higherOutstandingResult = calculateConcessionAmount({
        originalAmountPaise: input.originalAmountPaise,
        outstandingPaise: higherOutstanding,
        value: lowerValue,
        valueKind: input.valueKind,
      })
      const higherValueResult = calculateConcessionAmount({
        originalAmountPaise: input.originalAmountPaise,
        outstandingPaise: higherOutstanding,
        value: higherValue,
        valueKind: input.valueKind,
      })

      expect(lowerOutstandingResult).toBeGreaterThanOrEqual(0)
      expect(lowerOutstandingResult).toBeLessThanOrEqual(lowerOutstanding)
      expect(higherOutstandingResult).toBeGreaterThanOrEqual(lowerOutstandingResult)
      expect(higherOutstandingResult).toBeLessThanOrEqual(higherOutstanding)
      expect(higherValueResult).toBeGreaterThanOrEqual(higherOutstandingResult)
      expect(higherValueResult).toBeLessThanOrEqual(higherOutstanding)

      expect(calculateConcessionAmount({
        originalAmountPaise: input.originalAmountPaise,
        outstandingPaise: higherOutstanding,
        value: 10_000,
        valueKind: "percentage",
      })).toBe(Math.min(input.originalAmountPaise, higherOutstanding))
    }), { numRuns: PROPERTY_RUNS })
  })

  it("keeps rounded session proration monotonic and preserves the full monthly fee", () => {
    fc.assert(fc.property(
      fc.integer({ min: 5_000, max: MAX_MONEY_PAISE }),
      fc.integer({ min: 1, max: 62 }),
      fc.integer({ min: 0, max: 62 }),
      fc.integer({ min: 0, max: 62 }),
      (monthlyFeePaise, totalSessions, firstRaw, secondRaw) => {
        const first = Math.min(firstRaw, totalSessions)
        const second = Math.min(secondRaw, totalSessions)
        const lower = Math.min(first, second)
        const higher = Math.max(first, second)
        const lowerFee = calculateProratedSessionFee(monthlyFeePaise, lower, totalSessions)
        const higherFee = calculateProratedSessionFee(monthlyFeePaise, higher, totalSessions)

        expect(lowerFee).toBeGreaterThanOrEqual(0)
        expect(higherFee).toBeGreaterThanOrEqual(lowerFee)
        expect(higherFee).toBeLessThanOrEqual(monthlyFeePaise)
        expect(calculateProratedSessionFee(monthlyFeePaise, totalSessions, totalSessions))
          .toBe(monthlyFeePaise)
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("fingerprints JSON facts independently of object insertion order", () => {
    fc.assert(fc.property(jsonValueArbitrary, (value) => {
      expect(financialPayloadFingerprint(reverseObjectKeyOrder(value)))
        .toBe(financialPayloadFingerprint(value))
    }), { numRuns: PROPERTY_RUNS })
  })

  it("formats deterministic and injective financial sequence references", () => {
    fc.assert(fc.property(
      sequenceInputArbitrary,
      sequenceInputArbitrary,
      (left, right) => {
        const leftReference = formatFinancialSequenceReference(
          left.kind,
          left.year,
          left.sequence,
        )
        const rightReference = formatFinancialSequenceReference(
          right.kind,
          right.year,
          right.sequence,
        )
        const sameInput = left.kind === right.kind
          && left.year === right.year
          && left.sequence === right.sequence

        expect(leftReference === rightReference).toBe(sameInput)
        expect(leftReference).toMatch(left.kind === "receipt"
          ? /^SMBA-R-\d{4}-\d{5}$/u
          : /^SMBA-RF-\d{4}-\d{5}$/u)
        expect(formatFinancialSequenceReference(left.kind, left.year, left.sequence))
          .toBe(leftReference)
      },
    ), { numRuns: PROPERTY_RUNS })
  })
})
