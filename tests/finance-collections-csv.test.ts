import { describe, expect, it } from "vitest"

import { collectionCsvLines } from "@/lib/finance/collections-csv"

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
    }])].join("")

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
    }])].join("")

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.test\"\")\"")
    expect(csv).toContain("'+DANGEROUS")
    expect(csv).not.toContain(",=HYPERLINK")
  })

  it("rejects invalid ledger amounts", () => {
    expect(() => [...collectionCsvLines([{
      academyId: "SMBA#0001",
      amountPaise: -1,
      coveredFeeReferences: [],
      eventDate: "2026-08-08",
      eventType: "payment",
      method: "Cash",
      playerName: "Player",
      reference: "SMBA-R-2026-00001",
    }])]).toThrow("invalid amount")
  })
})
