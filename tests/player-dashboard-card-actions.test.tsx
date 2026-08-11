import { renderToStaticMarkup } from "react-dom/server"

import { describe, expect, it } from "vitest"

import { PlayerFeeRecordCard } from "@/components/financials/player-fee-record-card"

describe("Player Dashboard card actions", () => {
  it("uses one explicit boxed destination for the fee record", () => {
    const html = renderToStaticMarkup(
      <PlayerFeeRecordCard summary={{
        currentBalancePaise: 0,
        nextDueDate: null,
        status: "paid",
      }} />,
    )

    expect(html).toContain('href="/player/financials"')
    expect(html).toContain("Open fee record")
    expect(html).toContain("No balance due")
    expect(html.match(/href=/gu)).toHaveLength(1)
  })
})
