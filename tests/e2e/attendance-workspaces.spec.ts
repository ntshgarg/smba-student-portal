import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const COACH_ACADEMY_ID = "SMBA#0001"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return

  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
    timeout: 20_000,
  })
}

async function chooseAPlayerWithAnAbsence(page: Page) {
  const playerSelect = page.locator(".coach-adjustment-field select").first()
  await expect(playerSelect).toBeVisible()

  const playerIds = await playerSelect.locator("option").evaluateAll((options) => (
    options
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean)
  ))

  expect(playerIds.length).toBeGreaterThan(0)

  for (const playerId of playerIds) {
    await playerSelect.selectOption(playerId)
    const calendar = page.locator(".coach-adjustment-missed-calendar")
    if (await calendar.isVisible()) return
  }

  throw new Error("The loaded fixture contains no player with an unreconciled absence")
}

async function makeRescheduleDraftDirty(page: Page) {
  await chooseAPlayerWithAnAbsence(page)

  await page
    .locator(".coach-adjustment-missed-calendar-grid")
    .getByRole("button", { name: /^Select .*missed session/i })
    .first()
    .click()

  const sourceChoice = page
    .locator(".coach-adjustment-choice-list.is-source-slots")
    .getByRole("button")
    .first()
  const completionStep = page.getByRole("group", { name: /Completed on/i })

  await expect.poll(async () => (
    Number(await sourceChoice.isVisible().catch(() => false))
    + Number(await completionStep.isVisible().catch(() => false))
  )).toBeGreaterThan(0)

  if (await sourceChoice.isVisible()) await sourceChoice.click()
  await expect(completionStep).toBeVisible()
}

async function expectDiscardPrompt(
  page: Page,
  action: () => Promise<void>,
  decision: "accept" | "dismiss",
) {
  let message = ""
  page.once("dialog", async (dialog) => {
    message = dialog.message()
    if (decision === "accept") await dialog.accept()
    else await dialog.dismiss()
  })
  await action()
  expect(message).toMatch(/discard|unsaved/i)
}

test.beforeEach(async ({ page }) => {
  await loginAsCoach(page)
})

test("Attendance card launches the focused player and staff workspaces", async ({ page }) => {
  await page.goto("/coach#attendance", { waitUntil: "domcontentloaded" })
  const card = page.locator("#attendance [data-area=\"attendance\"]")

  const players = card.getByRole("group", { name: "Players" })
  const staff = card.getByRole("group", { name: "Staff" })
  await expect(players.getByRole("link", { name: "Attendance register" })).toHaveAttribute(
    "href",
    "/coach/attendance/players/register",
  )
  await expect(players.getByRole("link", { name: "Record attendance" })).toHaveAttribute(
    "href",
    "/coach/attendance/players/record",
  )
  await expect(players.getByRole("link", { name: "Reschedule attendance" })).toHaveAttribute(
    "href",
    "/coach/attendance/adjustments",
  )
  await expect(staff.getByRole("link", { name: "Attendance register" })).toHaveAttribute(
    "href",
    "/coach/attendance/staff/register",
  )
  await expect(staff.getByRole("link", { name: "Staff roll call" })).toHaveAttribute(
    "href",
    "/coach/attendance/staff/record",
  )
  await expect(card.locator("#attendance-register")).toHaveCount(0)
  await expect(card.locator("#attendance-adjustments-workspace")).toHaveCount(0)

  await players.getByRole("link", { name: "Record attendance" }).click()
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/players/record")
  await expect(page.getByRole("heading", { name: "Record attendance" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Choose one session" })).toBeVisible()
  await expect(page.locator("#attendance-register")).toHaveCount(0)

  await page.goto("/coach#attendance", { waitUntil: "domcontentloaded" })
  await page.locator("#attendance [data-area=\"attendance\"]")
    .getByRole("link", { name: "Reschedule attendance" })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/adjustments")
  await expect(page.getByRole("heading", { name: "Reschedule attendance" })).toBeVisible()
  await expect(page.locator("#attendance-adjustments-workspace")).toBeVisible()

  await expect(page.locator(".coach-adjustment-field select").first()).toBeVisible()
})

test("Record Attendance protects unsaved session-roster changes", async ({ page }) => {
  await page.goto("/coach/attendance/players/record?date=2026-08-03", {
    waitUntil: "domcontentloaded",
  })
  const firstAvailableSession = page
    .locator(".attendance-occurrence-list button:not([disabled])")
    .first()
  await expect(firstAvailableSession).toBeVisible()
  await firstAvailableSession.click()
  const firstRosterPlayer = page.locator(".attendance-record-roster-list button").first()
  await expect(firstRosterPlayer).toBeVisible()
  await firstRosterPlayer.click()
  await expect(page.getByRole("button", { name: "Save attendance" })).toBeEnabled()

  const backLink = page.getByRole("link", { name: "Back to Attendance" })
  await expectDiscardPrompt(page, () => backLink.click(), "dismiss")
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/players/record")

  await expectDiscardPrompt(page, () => backLink.click(), "accept")
  await expect(page).toHaveURL((url) => url.pathname === "/coach" && url.hash === "#attendance")
})

test("Reschedule Attendance protects its dirty draft", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })
  await makeRescheduleDraftDirty(page)

  const backLink = page.getByRole("link", { name: "Back to Attendance" })
  await expectDiscardPrompt(page, () => backLink.click(), "dismiss")
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/adjustments")

  await expectDiscardPrompt(page, () => backLink.click(), "accept")
  await expect(page).toHaveURL((url) => url.pathname === "/coach" && url.hash === "#attendance")
})

test("Legacy dashboard deep links preserve standalone adjustment parameters", async ({ page }) => {
  await page.goto(
    "/coach?attendance=reschedule&adjustment=missing-adjustment&player=missing-player#attendance",
    { waitUntil: "domcontentloaded" },
  )

  await expect(page).toHaveURL((url) => (
    url.pathname === "/coach/attendance/adjustments"
    && url.searchParams.get("adjustment") === "missing-adjustment"
    && url.searchParams.get("player") === "missing-player"
  ))
  await expect(page.locator("#attendance-adjustments-workspace")).toBeVisible()
  await expect(page.locator(".coach-adjustment-field select").first()).toHaveValue("")
  await expect(page.getByText(/not found|invalid adjustment|invalid player/i)).toHaveCount(0)

  await page.goto("/coach?attendance=register#attendance", {
    waitUntil: "domcontentloaded",
  })
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/players/register")
  await expect(page.locator("#attendance-register")).toBeVisible()
})

test("A valid adjustment deep link expands and focuses its published record", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })

  const historyDisclosure = page.getByRole("button", {
    name: /Previous reschedules \(\d+\)/i,
  })
  await historyDisclosure.click()
  const firstHistoryItem = page.locator(".coach-adjustment-history-item > button").first()
  await expect(firstHistoryItem).toBeVisible()
  const detailsId = await firstHistoryItem.getAttribute("aria-controls")
  expect(detailsId).toMatch(/^adjustment-details-/)
  const adjustmentId = detailsId?.replace("adjustment-details-", "")
  expect(adjustmentId).toBeTruthy()

  await page.goto(
    `/coach/attendance/adjustments?adjustment=${encodeURIComponent(adjustmentId ?? "")}`,
    { waitUntil: "domcontentloaded" },
  )

  await expect(page.getByRole("button", {
    name: /Previous reschedules \(\d+\)/i,
  })).toHaveAttribute("aria-expanded", "true")
  const requestedHistoryItem = page.locator(`[aria-controls="${detailsId}"]`)
  await expect(requestedHistoryItem).toHaveAttribute("aria-expanded", "true")
  await expect(requestedHistoryItem).toBeFocused()
})

test("Attendance workspaces have no document-level desktop overflow", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 })

  for (const route of [
    "/coach/attendance/players/register",
    "/coach/attendance/players/record?date=2026-08-03",
    "/coach/attendance/adjustments",
    "/coach/attendance/staff/register",
    "/coach/attendance/staff/record?date=2026-08-03",
  ]) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(overflow.scrollWidth, route).toBeLessThanOrEqual(overflow.clientWidth + 1)
  }
})
