import type { Page } from "@playwright/test"

// Not "@playwright/test": the harness stages the masked failure evidence the
// browser job uploads. See playwright.responsive-overflow.config.ts.
import { expect, test } from "./support/failure-evidence"
import { measureBudgetedPayload } from "./support/payload-budget"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.getByLabel("SMBA username").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname === "/coach")
}

test.beforeEach(async ({ page }) => {
  await loginAsCoach(page)
})

const ATTENDANCE_ROUTE = "/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner"
const ATTENDANCE_BUDGET_BYTES = 379_350
const CALENDAR_ROUTE = "/coach/calendar?date=2026-08-03"
const CALENDAR_BUDGET_BYTES = 218_421

/*
 * Neither byte budget above has ever been re-measured: `git log -S` on either
 * literal returns one commit, 42aa041 of 2026-08-10, with over a hundred
 * commits on top of it. Both numbers predate every route change since, and
 * this is the case most likely to be red the first time the suite gates. The
 * search is named rather than spelled out on purpose -- `git log -S` reports
 * the commits where a string's occurrence count changed, so repeating either
 * literal in this comment would put this commit into the answer it cites.
 *
 * measureBudgetedPayload prints each measurement to the step log as it takes
 * it. Read the two `[payload-budget]` lines there before deciding whether a
 * route grew or a budget simply expired, and re-measure rather than nudge. The
 * failure message alone will not do: it names the one route that blew its
 * budget, on the one run that was red, while re-measuring needs both numbers
 * and a green run's headroom is what says how close the other one is.
 */
test("Stress Attendance and Calendar stay within their route payload budgets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })

  const attendanceBytes = await measureBudgetedPayload(
    await page.goto(ATTENDANCE_ROUTE, { waitUntil: "networkidle" }),
    ATTENDANCE_ROUTE,
    ATTENDANCE_BUDGET_BYTES,
  )
  expect(attendanceBytes).toBeLessThanOrEqual(ATTENDANCE_BUDGET_BYTES)
  expect(await page.locator(".coach-register-table tbody tr").count()).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const calendarBytes = await measureBudgetedPayload(
    await page.goto(CALENDAR_ROUTE, { waitUntil: "networkidle" }),
    CALENDAR_ROUTE,
    CALENDAR_BUDGET_BYTES,
  )
  expect(calendarBytes).toBeLessThanOrEqual(CALENDAR_BUDGET_BYTES)
  await expect(page.getByRole("heading", { name: /Monday, 3 August/i })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test("Published Reports reveals large result sets progressively and preserves return state", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto("/coach/reports?period=2026-07", { waitUntil: "networkidle" })

  const reportRows = page.locator(".coach-published-report-row")
  await expect(reportRows).toHaveCount(10)
  expect(await page.locator("*").count()).toBeLessThan(500)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(5_000)

  await page.getByRole("button", { name: "Show more reports" }).click()
  await expect(reportRows).toHaveCount(20)
  await expect(page).toHaveURL((url) => url.searchParams.get("shown") === "20")

  await page.getByRole("link", { name: "Open report" }).nth(15).click()
  await page.getByRole("link", { name: "Back to published reports" }).click()
  await expect(reportRows).toHaveCount(20)
  await expect(page).toHaveURL((url) => url.searchParams.get("shown") === "20")

  await page.getByRole("button", { name: "Show more reports" }).click()
  await expect(reportRows).toHaveCount(30)
  await expect(page.getByRole("button", { name: "Show more reports" })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    document.activeElement?.classList.contains("coach-published-report-row") ?? false
  ))).toBe(true)
})

test("Announcement publication leaves the composer exactly once", async ({ page }) => {
  const title = `Phase 8 navigation ${Date.now()}`
  await page.goto("/coach/announcements/new", { waitUntil: "networkidle" })
  await page.locator('input[placeholder="Holiday training schedule"]').fill(title)
  await page.locator('textarea[placeholder="Share the important details with the academy."]')
    .fill("This notice verifies reliable post-publication navigation.")
  await page.getByRole("checkbox", { name: /Homepage/i }).check()
  await page.getByRole("button", { name: "Review announcement" }).click()
  await page.getByRole("button", { name: "Publish announcement" }).click()

  await page.waitForURL((url) => (
    /^\/coach\/announcements\/[^/]+$/u.test(url.pathname)
    && url.searchParams.get("published") === "1"
  ))
  await expect(page.getByRole("heading", { name: title })).toBeVisible()

  await page.goBack({ waitUntil: "networkidle" })
  await expect(page).toHaveURL((url) => url.pathname === "/coach")
})
