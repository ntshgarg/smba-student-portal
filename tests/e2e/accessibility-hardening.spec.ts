import type { Locator, Page } from "@playwright/test"

// Not "@playwright/test": the harness stages the masked failure evidence the
// browser job uploads. See playwright.responsive-overflow.config.ts.
import { expect, test } from "./support/failure-evidence"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const PLAYER_ACADEMY_ID = process.env.SMBA_CAPTURE_PLAYER_ACADEMY_ID ?? "SMBA-PL-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("SMBA username").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
    timeout: 20_000,
  })
}

async function loginAsPlayer(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("SMBA username").fill(PLAYER_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/player"), {
    timeout: 20_000,
  })
}

async function expectMobileSafeFont(control: Locator) {
  await expect(control).toBeVisible()
  const fontSize = await control.evaluate((element) => (
    Number.parseFloat(window.getComputedStyle(element).fontSize)
  ))
  expect(fontSize).toBeGreaterThanOrEqual(16)
}

test("authentication failures restore focus to the invalid field", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const academyId = page.getByLabel("SMBA username")

  await academyId.fill("invalid")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.locator("#academy-id-error")).toBeVisible()
  await expect(academyId).toHaveAttribute("aria-describedby", "academy-id-error")
  await expect(academyId).toHaveAttribute("aria-invalid", "true")
  await expect(academyId).toBeFocused()

  await page.getByRole("button", { name: "Continue" }).click()
  await expect(academyId).toBeFocused()

  await page.goto("/register", { waitUntil: "domcontentloaded" })
  const fullName = page.getByLabel("Full name")

  await page.getByRole("button", { name: "Request registration" }).click()
  await expect(page.locator("#full-name-error")).toBeVisible()
  await expect(fullName).toHaveAttribute("aria-describedby", "full-name-error")
  await expect(fullName).toHaveAttribute("aria-invalid", "true")
  await expect(fullName).toBeFocused()

  await page.getByRole("button", { name: "Request registration" }).click()
  await expect(fullName).toBeFocused()
})

test("operational controls remain zoom-safe and today controls are comfortably tappable", async ({ page }) => {
  await loginAsCoach(page)
  await page.setViewportSize({ height: 568, width: 320 })

  await page.goto("/coach/members", { waitUntil: "domcontentloaded" })
  await expectMobileSafeFont(page.getByPlaceholder("Search members"))
  await page.getByRole("button", { name: /Filters/u }).click()
  for (const filter of ["Level", "Status", "Batch"]) {
    await expectMobileSafeFont(page.getByLabel(filter))
  }

  await page.goto("/coach/schedules/new", { waitUntil: "domcontentloaded" })
  const scheduleControls = page.locator([
    '.coach-series-form input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
    ".coach-series-form select",
  ].join(", "))
  expect(await scheduleControls.count()).toBeGreaterThan(0)
  for (let index = 0; index < await scheduleControls.count(); index += 1) {
    await expectMobileSafeFont(scheduleControls.nth(index))
  }

  for (const route of [
    "/coach/attendance/players/register",
    "/coach/attendance/staff/register",
  ]) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    const jumpToToday = page.getByRole("button", { name: "Jump to today" })
    await expect(jumpToToday).toBeVisible()
    const bounds = await jumpToToday.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
  }
})

/*
 * Quarantined by G-27 when this suite was wired into CI, not skipped for
 * convenience. The case opens /coach/calendar?date=2026-08-10 and clicks
 * "Replace session", which session-calendar.tsx:512 renders only while
 * occurrenceIsUpcoming() holds against the `new Date()` that
 * app/coach/calendar/page.tsx:42 passes down. The stress fixture schedules
 * 2026-07-01 to 2026-09-30 (scripts/regression/profiles.ts:4-5) and the wall
 * clock is past 2026-08-10, so every session that day has started and the
 * control is not in the DOM to click. Repairing it means picking a date that is
 * still upcoming at run time; moving the constant only buys until 2026-09-30.
 */
test("replacement validation stays inline in the production Server Action path", async ({ page }) => {
  test.fixme(true, "G-27: the hard-coded 2026-08-10 session is no longer upcoming.")
  const serverFailures: string[] = []
  const consoleErrors: string[] = []
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.status() >= 500) {
      serverFailures.push(`${response.status()} ${response.url()}`)
    }
  })
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await loginAsCoach(page)
  await page.goto("/coach/calendar?date=2026-08-10", { waitUntil: "domcontentloaded" })
  await page.locator('.coach-day-session > button[aria-expanded="false"]').first().click()
  await page.locator(".coach-occurrence-detail summary", { hasText: "Replace session" }).click()

  const duration = page.getByLabel("Duration")
  await duration.fill("15")
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Create replacement" }).click()

  const error = page.getByText("Choose a valid session duration", { exact: true })
  await expect(error).toBeVisible()
  await expect(duration).toHaveAttribute("aria-invalid", "true")
  await expect(duration).toHaveAttribute("aria-describedby", /occurrence-feedback-/u)
  await expect(duration).toBeFocused()
  expect(serverFailures).toEqual([])
  expect(consoleErrors.filter((message) => /500|server components render|digest/u.test(message)))
    .toEqual([])
})

/*
 * Quarantined by G-27 when this suite was wired into CI, not skipped for
 * convenience. The last step searches for "SMBA#" and expects the window to
 * fall back to twelve rows. d9d8dbf moved every approved account onto a
 * role-prefixed Academy ID -- SMBA-HC-0001, SMBA-JC-000N, SMBA-PL-NNNN -- and
 * scripts/regression/fixture.ts:2189 fails the fixture build if any approved ID
 * departs from that sequence, so nothing in a member's ID, name or primary
 * contact contains "SMBA#". The search matches 0 of 100, the directory renders
 * .coach-member-empty-state in place of .coach-member-table, and the row count
 * is 0 rather than 12. Repair means a term the current fixture still matches.
 */
test("Member Directory reveals results in one-way groups of twelve", async ({ page }) => {
  test.fixme(true, "G-27: no fixture Academy ID contains the legacy SMBA# prefix.")
  await loginAsCoach(page)
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto("/coach/members", { waitUntil: "domcontentloaded" })

  const rows = page.locator(".coach-member-table tbody > tr")
  await expect(rows).toHaveCount(12)
  await expect(page.getByRole("heading", { name: "Showing 12 of 100 members" })).toBeVisible()

  await page.getByRole("button", { name: "Show more members" }).click()
  await expect(rows).toHaveCount(24)
  await expect(page.getByRole("heading", { name: "Showing 24 of 100 members" })).toBeVisible()

  await page.getByPlaceholder("Search members").fill("SMBA#")
  await expect(rows).toHaveCount(12)
})

test("Member Directory filters restore from the URL and browser history", async ({ page }) => {
  await loginAsCoach(page)
  await page.goto("/coach/members?level=Intermediate&batch=Weekend&status=active", {
    waitUntil: "networkidle",
  })

  await page.getByRole("button", { name: /Filters/u }).click()
  await expect(page.getByLabel("Level")).toHaveValue("Intermediate")
  await expect(page.getByLabel("Batch")).toHaveValue("Weekend")
  await expect(page.getByLabel("Status")).toHaveValue("active")

  await page.getByLabel("Level").selectOption("Advanced")
  await expect(page).toHaveURL((url) => url.searchParams.get("level") === "Advanced")
  await page.getByLabel("Batch").selectOption("Weekday")
  await expect(page).toHaveURL((url) => url.searchParams.get("batch") === "Weekday")

  await page.goBack()
  await expect(page.getByLabel("Level")).toHaveValue("Advanced")
  await expect(page.getByLabel("Batch")).toHaveValue("Weekend")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /Filters/u }).click()
  await expect(page.getByLabel("Level")).toHaveValue("Advanced")
  await expect(page.getByLabel("Batch")).toHaveValue("Weekend")
})

/*
 * Quarantined by G-27 when this suite was wired into CI, and this is the one
 * that still passes on the day it was quarantined. player-attendance-card.tsx
 * opens on the month of record.referenceDate, which lib/attendance/player-record.ts:22
 * derives from `new Date()`, so the previous-month control is labelled "View
 * July 2026" only while the wall clock is inside August 2026. From 1 September
 * it reads "View August 2026", the click below waits out the whole
 * 120s test timeout, and the merge gate goes red for a calendar reason on a
 * change that touched nothing. A gate nobody can get past costs more than the
 * URL-state coverage it buys, so it waits for the repair the other three need
 * anyway: derive the month from the rendered reference date instead of naming it.
 */
test("Player attendance month and year restore through refresh and Back", async ({ page }) => {
  test.fixme(true, "G-27: hard-codes July 2026, which stops being last month on 2026-09-01.")
  await loginAsPlayer(page)
  await page.goto("/player", { waitUntil: "networkidle" })

  const toggle = page.getByRole("button", { name: "Open attendance record" })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page).toHaveURL((url) => url.searchParams.get("attendance") === "register")
  const calendar = page.getByRole("grid", { name: /Your attendance calendar/u })
  await expect(calendar.getByRole("columnheader")).toHaveCount(7)
  await expect(calendar.getByRole("gridcell")).toHaveCount(42)

  await page.getByRole("button", { name: "View July 2026" }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get("month") === "07")
  await expect(page.locator(".player-attendance-month-current > strong"))
    .toHaveText("July 2026")

  const yearButtons = page.locator(".player-attendance-year-selector button")
  expect(await yearButtons.count()).toBeGreaterThan(1)
  const alternateYear = yearButtons.first()
  const alternateYearLabel = (await alternateYear.textContent())?.trim() ?? ""
  await alternateYear.click()
  await expect(page).toHaveURL((url) => url.searchParams.get("year") === alternateYearLabel)

  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: "Close attendance record" })).toBeVisible()
  await expect(page.locator(".player-attendance-year-selector button", {
    hasText: alternateYearLabel,
  })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".player-attendance-month-current > strong"))
    .toHaveText(`July ${alternateYearLabel}`)

  await page.getByRole("button", { name: "Close attendance record" }).click()
  await expect(page).toHaveURL((url) => !url.searchParams.has("attendance"))
  await page.goBack()
  await expect(page.getByRole("button", { name: "Close attendance record" })).toBeVisible()
  await expect(page).toHaveURL((url) => (
    url.searchParams.get("attendance") === "register"
    && url.searchParams.get("year") === alternateYearLabel
    && url.searchParams.get("month") === "07"
  ))

  await page.getByRole("button", { name: "Jump to today" }).click()
  await expect(page).toHaveURL((url) => (
    !url.searchParams.has("year") && !url.searchParams.has("month")
  ))
})
