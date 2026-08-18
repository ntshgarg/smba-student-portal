import { expect, test } from "@playwright/test"
import type { Page, Response } from "@playwright/test"

const COACH_ACADEMY_ID = "SMBA#0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname === "/coach")
}

async function decodedBodyBytes(response: Response | null) {
  if (!response) throw new Error("Navigation did not return a document response.")
  return (await response.body()).byteLength
}

test.beforeEach(async ({ page }) => {
  await loginAsCoach(page)
})

test("Stress Attendance and Calendar stay within their route payload budgets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })

  const attendanceResponse = await page.goto(
    "/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner",
    { waitUntil: "networkidle" },
  )
  const attendanceBytes = await decodedBodyBytes(attendanceResponse)
  expect(attendanceBytes).toBeLessThanOrEqual(379_350)
  expect(await page.locator(".coach-register-table tbody tr").count()).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const calendarResponse = await page.goto(
    "/coach/calendar?date=2026-08-03",
    { waitUntil: "networkidle" },
  )
  const calendarBytes = await decodedBodyBytes(calendarResponse)
  expect(calendarBytes).toBeLessThanOrEqual(218_421)
  await expect(page.getByRole("heading", { name: /Monday, 3 August/i })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  test.info().annotations.push({ type: "attendance-bytes", description: String(attendanceBytes) })
  test.info().annotations.push({ type: "calendar-bytes", description: String(calendarBytes) })
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
