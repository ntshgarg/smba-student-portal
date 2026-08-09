import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("coach Financials player state isolation", () => {
  it("remounts the Rapid Desk payment surface when the selected player changes", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "components/coach/financials/financials-rapid-desk.tsx",
      ),
      "utf8",
    )

    expect(source).toMatch(
      /<div key=\{workspace\.selectedLedger\.playerId\}>/u,
    )
    expect(source).not.toContain("showPaymentEntry")
  })
})
