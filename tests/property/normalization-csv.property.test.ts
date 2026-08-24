import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  formatAcademyId,
  isAcademyId,
  normalizeAcademyId,
  normalizeFullName,
  normalizedNameKey,
} from "@/lib/auth/identity"
import {
  collectionCsvLines,
  type CollectionCsvRow,
} from "@/lib/finance/collections-csv"
import type { ExportTruncation } from "@/lib/finance/csv-truncation"
import { feeRegisterCsvLines } from "@/lib/finance/records-csv"
import type {
  FinanceRegisterRow,
  FinanceStatus,
  PaymentMethod,
} from "@/lib/finance/types"

// Both encoders stop at a row they cannot write and end the file with a notice
// instead of throwing, which would turn a generated row this property rejects
// into an extra record rather than a failure. Rethrowing puts the property back
// in charge of deciding what counts as a pass.
const failOnTruncation: ExportTruncation = (error) => {
  throw error
}

const PROPERTY_RUNS = 200
const MAX_MONEY_PAISE = 1_000_000_000

function parseCsvRecord(record: string) {
  if (!record.endsWith("\r\n")) throw new Error("CSV record must end with CRLF.")

  const source = record.slice(0, -2)
  const fields: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === ",") {
      fields.push(field)
      field = ""
    } else {
      field += character
    }
  }

  if (quoted) throw new Error("CSV record contains an unterminated quoted field.")
  fields.push(field)
  return fields
}

function formatPaise(amountPaise: number) {
  return `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, "0")}`
}

const csvTextArbitrary = fc.tuple(
  fc.string({ maxLength: 32 }),
  fc.constantFrom("", ",", '"', "\r", "\n", "\r\n", '",\r\n'),
  fc.string({ maxLength: 32 }),
).map(([before, separator, after]) => `A${before}${separator}${after}`)

const dangerousSpreadsheetTextArbitrary = fc.oneof(
  fc.tuple(
    fc.constantFrom("", " ", "  ", "\t", "\n", "\u00a0"),
    fc.constantFrom("=", "+", "-", "@"),
    fc.string({ maxLength: 48 }),
  ).map(([whitespace, operator, suffix]) => `${whitespace}${operator}${suffix}`),
  fc.tuple(
    fc.constantFrom("\t", "\r"),
    fc.string({ maxLength: 48 }),
  ).map(([prefix, suffix]) => `${prefix}${suffix}`),
)

const paymentMethodArbitrary = fc.option(
  fc.constantFrom<PaymentMethod>("cash", "upi", "bank_transfer", "card", "cheque", "other"),
  { nil: null },
)

const collectionRowArbitrary: fc.Arbitrary<CollectionCsvRow> = fc.record({
  academyId: fc.integer({ min: 1, max: 9_999 }).map(formatAcademyId),
  amountPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  coveredFeeReferences: fc.array(csvTextArbitrary, { maxLength: 5 }),
  eventDate: fc.constant("2026-08-08"),
  eventType: fc.constantFrom("payment" as const, "refund" as const),
  lifecycle: fc.constantFrom("recorded" as const, "reversed" as const, undefined),
  method: paymentMethodArbitrary,
  playerName: csvTextArbitrary,
  reference: csvTextArbitrary,
})

const statusArbitrary = fc.constantFrom<FinanceStatus>(
  "setup_required",
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "not_prepared",
  "void",
)

const feeRegisterRowArbitrary: fc.Arbitrary<FinanceRegisterRow> = fc.record({
  academyId: fc.integer({ min: 1, max: 9_999 }).map(formatAcademyId),
  archived: fc.boolean(),
  billingPeriod: fc.option(fc.constant("2026-08"), { nil: null }),
  chargeId: fc.option(csvTextArbitrary, { nil: null }),
  creditAdjustmentsPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  debitAdjustmentsPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  dueDate: fc.option(fc.constant("2026-08-05"), { nil: null }),
  effectiveAmountPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  feeReference: fc.option(csvTextArbitrary, { nil: null }),
  fullName: csvTextArbitrary,
  originalAmountPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  outstandingPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  playerId: csvTextArbitrary,
  receivedPaise: fc.integer({ min: 0, max: MAX_MONEY_PAISE }),
  status: statusArbitrary,
  type: fc.constantFrom("registration" as const, "monthly_training" as const),
})

describe("normalization and CSV properties", () => {
  it("normalizes names and name keys idempotently", () => {
    fc.assert(fc.property(
      fc.string({ maxLength: 256 }),
      (value) => {
        const normalized = normalizeFullName(value)
        const key = normalizedNameKey(value)

        expect(normalizeFullName(normalized)).toBe(normalized)
        expect(normalizedNameKey(key)).toBe(key)
        expect(normalized).not.toMatch(/^\s|\s$|\s{2}/u)
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("round-trips formatted Academy IDs through whitespace and casing normalization", () => {
    const whitespaceArbitrary = fc.array(
      fc.constantFrom("", " ", "\t", "\n", "\u00a0"),
      { minLength: 10, maxLength: 10 },
    )

    fc.assert(fc.property(
      fc.integer({ min: 1, max: 9_999 }),
      fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
      whitespaceArbitrary,
      (serial, lowercaseLetters, whitespace) => {
        const canonical = formatAcademyId(serial)
        const variantCharacters = [...canonical].map((character, index) => (
          index < 4 && lowercaseLetters[index] ? character.toLocaleLowerCase("en-IN") : character
        ))
        const variant = variantCharacters.reduce(
          (value, character, index) => `${value}${whitespace[index]}${character}`,
          "",
        ) + whitespace[variantCharacters.length]

        expect(normalizeAcademyId(variant)).toBe(canonical)
        expect(isAcademyId(variant)).toBe(true)
        expect(isAcademyId(canonical)).toBe(true)
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("preserves collection CSV records and quoted text as fixed nine-column rows", () => {
    fc.assert(fc.property(
      fc.array(collectionRowArbitrary, { maxLength: 20 }),
      (rows) => {
        const records = [...collectionCsvLines(rows, failOnTruncation)]
        expect(records).toHaveLength(rows.length + 1)
        expect(parseCsvRecord(records[0])).toHaveLength(9)

        rows.forEach((row, index) => {
          const fields = parseCsvRecord(records[index + 1])
          expect(fields).toHaveLength(9)
          expect(fields[2]).toBe(row.reference)
          expect(fields[3]).toBe(row.playerName)
          expect(fields[4]).toBe(row.academyId)
          expect(fields[6]).toBe(formatPaise(row.amountPaise))
          expect(fields[7]).toBe(row.coveredFeeReferences.join("; "))
        })
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("preserves fee-register CSV records and quoted text as fixed fourteen-column rows", () => {
    fc.assert(fc.property(
      fc.array(feeRegisterRowArbitrary, { maxLength: 20 }),
      (rows) => {
        const records = [...feeRegisterCsvLines(rows, failOnTruncation)]
        expect(records).toHaveLength(rows.length + 1)
        expect(parseCsvRecord(records[0])).toHaveLength(14)

        rows.forEach((row, index) => {
          const fields = parseCsvRecord(records[index + 1])
          expect(fields).toHaveLength(14)
          expect(fields[0]).toBe(row.fullName)
          expect(fields[1]).toBe(row.academyId)
          expect(fields[4]).toBe(row.feeReference ?? "")
          expect(fields[5]).toBe(formatPaise(row.originalAmountPaise))
          expect(fields[10]).toBe(formatPaise(row.outstandingPaise))
        })
      },
    ), { numRuns: PROPERTY_RUNS })
  })

  it("neutralizes spreadsheet formulas after standards-compliant CSV parsing", () => {
    fc.assert(fc.property(
      dangerousSpreadsheetTextArbitrary,
      (dangerousText) => {
        const collectionFields = parseCsvRecord([...collectionCsvLines([{
          academyId: "SMBA#0001",
          amountPaise: 100,
          coveredFeeReferences: [dangerousText],
          eventDate: "2026-08-08",
          eventType: "payment",
          method: null,
          playerName: dangerousText,
          reference: dangerousText,
        }], failOnTruncation)][1])
        expect(collectionFields[2]).toBe(`'${dangerousText}`)
        expect(collectionFields[3]).toBe(`'${dangerousText}`)
        expect(collectionFields[7]).toBe(`'${dangerousText}`)

        const feeFields = parseCsvRecord([...feeRegisterCsvLines([{
          academyId: dangerousText,
          archived: false,
          billingPeriod: "2026-08",
          chargeId: "charge-1",
          creditAdjustmentsPaise: 0,
          debitAdjustmentsPaise: 0,
          dueDate: "2026-08-05",
          effectiveAmountPaise: 100,
          feeReference: dangerousText,
          fullName: dangerousText,
          originalAmountPaise: 100,
          outstandingPaise: 100,
          playerId: "player-1",
          receivedPaise: 0,
          status: "pending",
          type: "monthly_training",
        }], failOnTruncation)][1])
        expect(feeFields[0]).toBe(`'${dangerousText}`)
        expect(feeFields[1]).toBe(`'${dangerousText}`)
        expect(feeFields[4]).toBe(`'${dangerousText}`)
      },
    ), { numRuns: PROPERTY_RUNS })
  })
})
