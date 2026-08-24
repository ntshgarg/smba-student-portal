import { describe, expect, it, vi } from "vitest"

import { collectionCsvLines } from "@/lib/finance/collections-csv"
import {
  CsvExportValueError,
  type ExportTruncation,
} from "@/lib/finance/csv-truncation"

// Every row in these cases is one the encoder can write, so a truncation here
// would be a real failure. Rethrowing keeps it a failure: the notice the
// encoder emits instead would otherwise let a broken row pass as a passing test.
const failOnTruncation: ExportTruncation = (error) => {
  throw error
}

describe("finance collections CSV", () => {
  it("writes one safe row per ledger event", () => {
    const csv = [...collectionCsvLines([{
      academyId: "SMBA#0042",
      amountPaise: 350_050,
      coveredFeeReferences: ["SMBA-A1", "SMBA-B2"],
      eventDate: "2026-08-08",
      eventType: "payment",
      method: "UPI",
      playerName: "Aarav Bhat",
      reference: "SMBA-R-2026-00042",
    }], failOnTruncation)].join("")

    expect(csv).toContain("Amount (INR)")
    expect(csv).toContain("3500.50")
    expect(csv).toContain("UPI")
    expect(csv).toContain("SMBA-A1; SMBA-B2")
    expect(csv.split("\r\n")).toHaveLength(3)
  })

  it("neutralizes spreadsheet formulas and escapes CSV text", () => {
    const csv = [...collectionCsvLines([{
      academyId: "SMBA#0007",
      amountPaise: 100,
      coveredFeeReferences: ["SMBA-C3"],
      eventDate: "2026-08-08",
      eventType: "refund",
      method: null,
      playerName: "=HYPERLINK(\"https://example.test\")",
      reference: "+DANGEROUS",
    }], failOnTruncation)].join("")

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.test\"\")\"")
    expect(csv).toContain("'+DANGEROUS")
    expect(csv).not.toContain(",=HYPERLINK")
  })

  // F-17: this used to throw out of the generator, which the ReadableStream
  // pulling it turns into a file that ends mid-export under a 200 the coach has
  // already been given. The refusal is unchanged; it now reaches the coach, and
  // it reaches the caller typed as a row fault rather than a passing moment, so
  // the file can stop short of telling a coach to retry it.
  it("ends the export at an invalid ledger amount and says so in the file", () => {
    const onTruncated = vi.fn<ExportTruncation>(
      () => "Ask for the ledger entry to be corrected.",
    )

    const rows = [...collectionCsvLines([{
      academyId: "SMBA#0001",
      amountPaise: -1,
      coveredFeeReferences: [],
      eventDate: "2026-08-08",
      eventType: "payment",
      method: "Cash",
      playerName: "Player",
      reference: "SMBA-R-2026-00001",
    }], onTruncated)]

    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain("EXPORT INCOMPLETE")
    expect(rows[1]).toContain("stopped after 0 rows")
    expect(rows[1]).toContain("Ask for the ledger entry to be corrected.")
    expect(onTruncated.mock.calls[0]?.[0]).toBeInstanceOf(CsvExportValueError)
    expect(String(onTruncated.mock.calls[0]?.[0])).toContain("invalid amount")
    expect(onTruncated).toHaveBeenCalledWith(expect.anything(), 0)
  })
})
