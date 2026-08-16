import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("coach Fee Records navigation", () => {
  it("uses bounded server windows for each Fee Records view", () => {
    const route = source("app/coach/financials/records/page.tsx")

    expect(route).toContain("const PAGE_SIZE = 10")
    expect(route).toContain("const COLLECTION_PAGE_SIZE = 10")
    expect(route).toContain("const ACTIVITY_PAGE_SIZE = 20")
    expect(route).toContain("const cursor = trail.at(-1)")
    expect(route).toContain("pageSize: PAGE_SIZE")
    expect(route).toContain("pageSize: COLLECTION_PAGE_SIZE")
    expect(route).toContain("pageSize: ACTIVITY_PAGE_SIZE")
  })

  it("keeps monthly preparation in the monthly register and omits it for registration mode", () => {
    const records = source("components/coach/financials/financial-records-workspace.tsx")
    const route = source("app/coach/financials/records/page.tsx")

    expect(records).toContain('register.filters.mode === "monthly" && register.preparation')
    expect(records).toContain("register.preparation")
    expect(route).toContain("<PrepareFees compact")
    expect(route).toContain('const preparation = mode === "monthly"')
    expect(route).toContain("getCoachMonthlyPreparationPreview")
  })

  it("opens a focused player record instead of downloading a statement from the register", () => {
    const records = source("components/coach/financials/financial-records-workspace.tsx")
    const route = source("app/coach/financials/players/[playerId]/page.tsx")

    expect(records).toContain("Open record")
    expect(route).toContain("FinancialPlayerRecordWorkspace")
    expect(route).toContain("getCoachFinancePlayerRecord")
    expect(route).toContain("notFound()")
    expect(route).toContain("toPlayerFinancialLedgerView")
  })

  it("keeps the ledger administrative and links eligible payments to Rapid Desk", () => {
    const records = source("components/coach/financials/financial-player-record-workspace.tsx")
    const ledger = source("components/coach/financials/player-ledger.tsx")
    const route = source("app/coach/financials/players/[playerId]/page.tsx")

    expect(records).not.toContain("showPaymentEntry")
    expect(records).toContain("hasPayableBalance && !ledger.archived")
    expect(records).not.toContain("hasActiveFeePlan && hasPayableBalance")
    expect(records).toContain('charge.type === "registration"')
    expect(records).toContain("charge.billingPeriod ?? paymentPeriod")
    expect(route).toContain("paymentPeriod={paymentPeriod}")
    expect(records).toContain('scope: "outstanding"')
    expect(records).toContain("Download statement")
    expect(ledger).not.toContain("showPaymentEntry")
    expect(ledger).not.toContain("searchInputRef?:")
    expect(ledger).toContain("showDownloads={showReceiptDownloads}")
    expect(ledger).toContain("Download receipt")
    expect(ledger).toContain("<a")
    expect(ledger).not.toContain("<Link className={styles.receiptDownload}")
  })

  it("preserves allowlisted register context in focused-record navigation", () => {
    const records = source("components/coach/financials/financial-records-workspace.tsx")
    const route = source("app/coach/financials/players/[playerId]/page.tsx")

    expect(records).toContain("mode: register.filters.mode")
    expect(records).toContain("scope: register.filters.scope")
    expect(records).toContain('search.set("cursors", register.filters.cursors)')
    expect(route).toContain("REGISTER_MODES")
    expect(route).toContain("PLAYER_SCOPES")
    expect(route).toContain("REGISTER_STATUSES")
    expect(route).toContain("validCursorTrail")
    expect(route).toContain('backSearch.set("q", registerQuery)')
    expect(route).toContain('backSearch.set("cursors", cursors)')
  })

  it("keeps archived concession history visible without archived mutation controls", () => {
    const ledger = source("components/coach/financials/player-ledger.tsx")

    expect(ledger).toContain("ledger.archived && ledger.management.concessions.length > 0")
    expect(ledger).toContain("Concessions previously recorded for this player.")
    expect(ledger).toContain("ledger.archived ? null : (")
  })

  it("uses the approved Fee Records names and back destinations", () => {
    const records = source("components/coach/financials/financial-records-workspace.tsx")
    const playerRecord = source("components/coach/financials/financial-player-record-workspace.tsx")
    const route = source("app/coach/financials/records/page.tsx")

    expect(records).toContain("<h1>Fee records</h1>")
    expect(records).toContain('href="/coach"')
    expect(playerRecord).toContain("Back to Fee Records")
    expect(route).toContain('title: "Fee records"')
    expect(records).toContain('aria-label="Fee record views"')
    expect(source("app/coach/financials/loading.tsx")).toContain("Loading Financials…")
    expect(source("app/coach/financials/error.tsx")).toContain("Financials are unavailable.")
  })
})
