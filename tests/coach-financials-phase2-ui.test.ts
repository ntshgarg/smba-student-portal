import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("coach Financials Phase 2 workflows", () => {
  it("provides a dedicated, coach-authorized Rapid Desk route", () => {
    const route = source("app/coach/financials/record/page.tsx")
    const workspace = source("components/coach/financials/financials-rapid-desk.tsx")

    expect(route).toContain('requestedScope === "all" ? "all" : "outstanding"')
    expect(route).toContain("getCoachFinanceRapidDesk")
    expect(route).toContain("<FinancialsRapidDesk")
    expect(workspace).toContain("return `/coach/financials/record")
    expect(workspace).toContain("Back to dashboard")
    expect(workspace).toContain('["outstanding", "Outstanding"]')
    expect(workspace).toContain('["all", "All players"]')
    expect(workspace).toContain("Fee plan required")
    expect(workspace).toContain("Only players with an outstanding balance from a Fee Plan can be selected.")
    expect(workspace).toContain("player.paymentEligible")
    expect(workspace).toContain("maxLength={120}")
    expect(workspace).toContain('<ul className={styles.playerList}>')
    expect(workspace).toContain("onRecorded(result.message)")
    expect(workspace).toContain("message={completionFeedback.message}")
    expect(workspace).not.toContain("Fee plan not set")
    expect(workspace).not.toContain("No payment due")
    expect(workspace).not.toContain("Open fee record")
    expect(workspace).toContain("onRecorded={readyForNextPlayer}")
    expect(workspace).not.toContain("function LegacyPaymentForm")
  })

  it("uses full receipt records for reversals and constrains refund dates", () => {
    const workspace = source("components/coach/financials/player-ledger.tsx")

    expect(workspace).toContain("const receipts = ledger.management.receipts.filter")
    expect(workspace).toContain('receipt.lifecycle === "recorded"')
    expect(workspace).toContain('refund.lifecycle === "recorded"')
    expect(workspace).toContain("min={receipt.receivedOn}")
    expect(workspace).toContain("receipt.receiptReference")
  })

  it("exposes concession commands through coach-only server actions", () => {
    const actions = source("app/coach/financials/actions.ts")
    const workspace = source("components/coach/financials/player-ledger.tsx")

    expect(actions).toContain("export async function createConcessionAction")
    expect(actions).toContain("export async function applyConcessionAction")
    expect(actions).toContain("export async function reverseConcessionApplicationAction")
    expect(actions).toContain("export async function reverseConcessionAction")
    expect(actions).toContain('revalidatePath("/coach/financials/record")')
    expect(workspace).toContain("<ConcessionManagement ledger={ledger} period={period} />")
    expect(workspace).toContain('charge.type !== "monthly_training"')
    expect(workspace).toContain("charge.billingPeriod >= concession.startsPeriod")
    expect(workspace).toContain("Apply to existing fee")
  })
})
