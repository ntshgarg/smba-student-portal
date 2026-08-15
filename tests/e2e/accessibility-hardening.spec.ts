import { expect, test } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

const COACH_ACADEMY_ID = "SMBA#0001"
const PLAYER_ACADEMY_ID = process.env.SMBA_CAPTURE_PLAYER_ACADEMY_ID ?? "SMBA#0002"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
    timeout: 20_000,
  })
}

async function loginAsPlayer(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("Academy ID").fill(PLAYER_ACADEMY_ID)
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
  const academyId = page.getByLabel("Academy ID")

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

test("replacement validation stays inline in the production Server Action path", async ({ page }) => {
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

test("Member Directory reveals results in one-way groups of twelve", async ({ page }) => {
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

test("Player attendance month and year restore through refresh and Back", async ({ page }) => {
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
