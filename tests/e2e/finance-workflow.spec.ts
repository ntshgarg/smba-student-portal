import BetterSqlite3 from "better-sqlite3"
import os from "node:os"
import path from "node:path"
import type { Browser, Page } from "@playwright/test"

import { expect, test } from "./support/failure-evidence"

const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"
const COACH_ACADEMY_ID = "SMBA-HC-0001"

type FinanceFixture = {
  academyId: string
  firstFeeMonth: string
  playerId: string
  today: string
}

function databasePath() {
  const value = process.env.SMBA_FINANCE_DB?.trim()
  if (!value) {
    throw new Error("SMBA_FINANCE_DB must point to a disposable database under /tmp.")
  }
  const resolved = path.resolve(value)
  const temporaryRoots = [path.resolve(os.tmpdir()), path.resolve("/tmp")]
  const insideTemporaryRoot = temporaryRoots.some((root) => {
    const relative = path.relative(root, resolved)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
  if (!insideTemporaryRoot || resolved.split(path.sep).includes(".data")) {
    throw new Error("SMBA_FINANCE_DB must point to a disposable database under /tmp.")
  }
  return resolved
}

function readDatabase<T>(operation: (database: BetterSqlite3.Database) => T) {
  const database = new BetterSqlite3(databasePath(), { fileMustExist: true, readonly: true })
  try {
    return operation(database)
  } finally {
    database.close()
  }
}

function writeDisposableDatabase<T>(operation: (database: BetterSqlite3.Database) => T) {
  const database = new BetterSqlite3(databasePath(), { fileMustExist: true })
  try {
    return operation(database)
  } finally {
    database.close()
  }
}

function readFixture(): FinanceFixture {
  return readDatabase((database) => {
    const row = database.prepare(`
      select a.id as playerId, m.identifier as academyId, e.joined_at as joinedAt
      from accounts a
      join auth_methods m on m.account_id = a.id
        and m.method = 'academy_id' and m.revoked_at is null
      join player_enrollments e on e.account_id = a.id
      where a.full_name = 'Finance Regression Player'
    `).get() as { academyId: string; joinedAt: number; playerId: string } | undefined
    if (!row) throw new Error("The finance regression player is unavailable.")
    const today = new Date(row.joinedAt).toISOString().slice(0, 10)
    const firstMonth = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`)
    firstMonth.setUTCMonth(firstMonth.getUTCMonth() + 1)
    return {
      academyId: row.academyId,
      firstFeeMonth: firstMonth.toISOString().slice(0, 7),
      playerId: row.playerId,
      today,
    }
  })
}

function financeCounts(playerId: string) {
  return readDatabase((database) => ({
    agreements: Number((database.prepare(
      "select count(*) as count from fee_agreements where player_account_id = ?",
    ).get(playerId) as { count: number }).count),
    allocations: Number((database.prepare(`
      select count(*) as count from payment_allocations a
      join payments p on p.id = a.payment_id
      where p.player_account_id = ?
    `).get(playerId) as { count: number }).count),
    charges: Number((database.prepare(
      "select count(*) as count from financial_charges where player_account_id = ?",
    ).get(playerId) as { count: number }).count),
    monthlyCharges: Number((database.prepare(`
      select count(*) as count from financial_charges
      where player_account_id = ? and type = 'monthly_training'
    `).get(playerId) as { count: number }).count),
    payments: Number((database.prepare(
      "select count(*) as count from payments where player_account_id = ?",
    ).get(playerId) as { count: number }).count),
    registrationCharges: Number((database.prepare(`
      select count(*) as count from financial_charges
      where player_account_id = ? and type = 'registration'
    `).get(playerId) as { count: number }).count),
  }))
}

function expectHealthyDatabase() {
  readDatabase((database) => {
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok")
    expect(database.pragma("foreign_key_check")).toEqual([])
  })
}

async function login(page: Page, academyId: string, destination: "/coach" | "/player") {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("SMBA username").fill(academyId)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => (
    url.pathname.startsWith(destination) || url.pathname === "/auth/pin/setup"
  ), { timeout: 20_000 })
  if (new URL(page.url()).pathname === "/auth/pin/setup") {
    await page.getByLabel("Enter PIN").fill(destination === "/coach" ? "135790" : "246810")
    await page.getByLabel("Confirm PIN").fill(destination === "/coach" ? "135790" : "246810")
    await page.getByRole("button", { name: "Set up PIN" }).click()
    await page.waitForURL((url) => url.pathname.startsWith(destination), { timeout: 20_000 })
  }
}

async function openFeeIssue(page: Page, period: string) {
  await page.goto(`/coach/financials/records?view=fees&mode=monthly&period=${period}`, {
    waitUntil: "networkidle",
  })
  await page.getByRole("button", { name: "Review fee issue" }).click()
  await expect(page.getByRole("button", { name: "Issue 1 fee" })).toBeVisible()
}

async function recordCashPayment(page: Page, playerId: string, amount: string) {
  await page.goto(`/coach/financials/record?scope=all&player=${playerId}`, {
    waitUntil: "networkidle",
  })
  await expect(page.getByRole("heading", { name: "Finance Regression Player" })).toBeVisible()
  await page.getByLabel("Amount received").fill(amount)
  await page.getByLabel("Offline payment method").selectOption({ label: "Cash" })
  await page.getByRole("button", { name: "Review allocation" }).click()
  await expect(page.getByRole("button", { name: "Record payment" })).toBeEnabled()
}

test("coach-to-player finance journey remains atomic, idempotent and private", async ({ browser, page }) => {
  const fixture = readFixture()
  expectHealthyDatabase()
  expect(financeCounts(fixture.playerId)).toEqual({
    agreements: 0,
    allocations: 0,
    charges: 0,
    monthlyCharges: 0,
    payments: 0,
    registrationCharges: 0,
  })

  await login(page, COACH_ACADEMY_ID, "/coach")
  await page.goto(`/coach/onboarding?player=${fixture.playerId}`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: /Confirm .+ Fee Plan/u })).toBeVisible()
  await page.getByLabel("Agreed monthly fee").fill("3500")
  await page.getByLabel("First fee month").fill(fixture.firstFeeMonth)
  await page.getByRole("button", { name: "Complete onboarding & issue fees" }).click()
  await expect(page.getByRole("status").filter({ hasText: "fully onboarded" })).toBeVisible()

  expect(financeCounts(fixture.playerId)).toEqual({
    agreements: 1,
    allocations: 0,
    charges: 1,
    monthlyCharges: 0,
    payments: 0,
    registrationCharges: 1,
  })
  readDatabase((database) => {
    const registration = database.prepare(`
      select original_amount_paise as amount, type
      from financial_charges where player_account_id = ?
    `).get(fixture.playerId) as { amount: number; type: string }
    expect(registration).toEqual({ amount: 100_000, type: "registration" })
  })

  const staleIssuePage = await page.context().newPage()
  await openFeeIssue(page, fixture.firstFeeMonth)
  await openFeeIssue(staleIssuePage, fixture.firstFeeMonth)
  await page.getByRole("button", { name: "Issue 1 fee" }).click()
  await expect(page.getByRole("status").filter({ hasText: "1 monthly fee issued" })).toBeVisible()
  await staleIssuePage.getByRole("button", { name: "Issue 1 fee" }).click()
  await expect(staleIssuePage.getByRole("status").filter({ hasText: "0 monthly fees issued" })).toBeVisible()
  await staleIssuePage.close()

  expect(financeCounts(fixture.playerId)).toMatchObject({ charges: 2, monthlyCharges: 1 })
  readDatabase((database) => {
    const monthly = database.prepare(`
      select billing_period as period, original_amount_paise as amount
      from financial_charges
      where player_account_id = ? and type = 'monthly_training'
    `).get(fixture.playerId) as { amount: number; period: string }
    expect(monthly).toEqual({ amount: 350_000, period: fixture.firstFeeMonth })
  })

  // The browser journey issues next month's full fee to avoid proration. Move
  // only that disposable charge into today's payment horizon to model the
  // month rollover without changing production clock or payment safeguards.
  writeDisposableDatabase((database) => {
    const update = database.prepare(`
      update financial_charges
      set billing_period = ?, due_date = ?
      where player_account_id = ? and type = 'monthly_training'
    `).run(fixture.today.slice(0, 7), fixture.today, fixture.playerId)
    expect(update.changes).toBe(1)
  })

  await recordCashPayment(page, fixture.playerId, "1500")
  await expect(page.getByLabel("Amount allocated to SMBA registration fee")).toHaveValue("1000")
  await expect(page.getByLabel(`Amount allocated to Monthly training fee · ${fixture.firstFeeMonth}`)).toHaveValue("500")
  await page.getByRole("button", { name: "Record payment" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Payment recorded" })).toBeVisible()

  readDatabase((database) => {
    const firstReceipt = database.prepare(`
      select p.amount_paise as amount, p.method
      from payments p where p.player_account_id = ?
      order by p.recorded_at, p.id limit 1
    `).get(fixture.playerId) as { amount: number; method: string }
    const allocations = database.prepare(`
      select c.type, a.amount_paise as amount
      from payment_allocations a
      join payments p on p.id = a.payment_id
      join financial_charges c on c.id = a.charge_id
      where p.player_account_id = ?
      order by case c.type when 'registration' then 1 else 2 end
    `).all(fixture.playerId)
    expect(firstReceipt).toEqual({ amount: 150_000, method: "cash" })
    expect(allocations).toEqual([
      { amount: 100_000, type: "registration" },
      { amount: 50_000, type: "monthly_training" },
    ])
  })

  await recordCashPayment(page, fixture.playerId, "3000")
  await expect(page.getByLabel(`Amount allocated to Monthly training fee · ${fixture.firstFeeMonth}`)).toHaveValue("3000")
  await page.getByRole("button", { name: "Record payment" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Payment recorded" })).toBeVisible()

  const finalCounts = financeCounts(fixture.playerId)
  expect(finalCounts).toEqual({
    agreements: 1,
    allocations: 3,
    charges: 2,
    monthlyCharges: 1,
    payments: 2,
    registrationCharges: 1,
  })
  readDatabase((database) => {
    const chargeBalances = database.prepare(`
      select c.type, c.original_amount_paise as charged,
        coalesce(sum(case when p.lifecycle = 'recorded' then a.amount_paise else 0 end), 0) as paid
      from financial_charges c
      left join payment_allocations a on a.charge_id = c.id
      left join payments p on p.id = a.payment_id
      where c.player_account_id = ?
      group by c.id order by c.type
    `).all(fixture.playerId)
    expect(chargeBalances).toEqual([
      { charged: 350_000, paid: 350_000, type: "monthly_training" },
      { charged: 100_000, paid: 100_000, type: "registration" },
    ])
  })

  const baseURL = String(test.info().project.use.baseURL)
  const playerContext = await (browser as Browser).newContext({ baseURL })
  const playerPage = await playerContext.newPage()
  await login(playerPage, fixture.academyId, "/player")
  await playerPage.goto(`/player/financials?year=${fixture.today.slice(0, 4)}&month=${fixture.today.slice(0, 7)}`, {
    waitUntil: "networkidle",
  })
  await expect(playerPage.getByRole("heading", { name: "Your fee record." })).toBeVisible()
  await expect(playerPage.locator('[data-registration-state="paid"]')).toContainText("Paid")
  await expect(playerPage.locator("[data-fee-receipt-row]")).toHaveCount(2)
  await expect(playerPage.getByText("INR 1,500", { exact: true })).toBeVisible()
  await expect(playerPage.getByText("INR 3,000", { exact: true })).toBeVisible()
  await playerPage.reload({ waitUntil: "networkidle" })
  expect(financeCounts(fixture.playerId)).toEqual(finalCounts)
  await playerContext.close()

  const paymentId = readDatabase((database) => (
    database.prepare(`
      select id from payments where player_account_id = ? order by recorded_at, id limit 1
    `).get(fixture.playerId) as { id: string }
  ).id)
  const receipt = await page.request.get(`/coach/financials/receipts/${paymentId}/download`)
  expect(receipt.status()).toBe(200)
  expect(receipt.headers()["content-type"]).toContain("application/pdf")
  expect(receipt.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.pdf"$/u)
  expect(receipt.headers()["cache-control"]).toBe("private, no-store")
  expect((await receipt.body()).subarray(0, 4).toString("utf8")).toBe("%PDF")

  await page.reload({ waitUntil: "networkidle" })
  expect(financeCounts(fixture.playerId)).toEqual(finalCounts)
  expectHealthyDatabase()
})
