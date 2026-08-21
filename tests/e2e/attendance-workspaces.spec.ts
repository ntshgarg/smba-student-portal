import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return

  await page.getByLabel("SMBA username").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => (
    url.pathname === "/auth/pin/setup" || url.pathname.startsWith("/coach")
  ), {
    timeout: 20_000,
  })
  if (new URL(page.url()).pathname === "/auth/pin/setup") {
    await page.getByLabel("Enter PIN").fill("135790")
    await page.getByLabel("Confirm PIN").fill("135790")
    await page.getByRole("button", { name: "Set up PIN" }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
      timeout: 20_000,
    })
  }
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
    await expect(page).toHaveURL((url) => url.searchParams.get("player") === playerId)
    await page.waitForLoadState("networkidle")
    await expect(page.locator(".coach-adjustment-choice-group").first()).toBeVisible()
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
    waitUntil: "networkidle",
  })
  const firstAvailableSession = page
    .locator(".attendance-occurrence-list > button.is-available")
    .first()
  await expect(firstAvailableSession).toBeVisible()
  await firstAvailableSession.click()
  const firstRosterPlayer = page
    .locator(".attendance-record-roster-list [role=\"group\"]")
    .first()
  const presentChoice = firstRosterPlayer.getByRole("button", { name: "Present" })
  const absentChoice = firstRosterPlayer.getByRole("button", { name: "Absent" })
  await expect(presentChoice).toBeVisible()
  await expect(absentChoice).toBeVisible()
  await expect(firstAvailableSession).toHaveAttribute("aria-expanded", "true")
  await presentChoice.click()
  if (!await page.getByRole("button", { name: "Save attendance" }).isEnabled()) {
    await absentChoice.click()
  }
  const playerChoicePresentation = await firstRosterPlayer.evaluate((group) => {
    const buttons = Array.from(group.querySelectorAll("button"))
    const boxes = buttons.map((button) => {
      const box = button.getBoundingClientRect()
      return {
        boxShadow: getComputedStyle(button).boxShadow,
        left: box.left,
        right: box.right,
      }
    })
    const style = getComputedStyle(group)
    return {
      borderTopWidth: style.borderTopWidth,
      boxes,
    }
  })
  expect(playerChoicePresentation.borderTopWidth).toBe("1px")
  expect(Math.abs(
    playerChoicePresentation.boxes[1].left - playerChoicePresentation.boxes[0].right,
  )).toBeLessThanOrEqual(1)
  expect(playerChoicePresentation.boxes.map((box) => box.boxShadow)).toEqual(["none", "none"])
  await expect(page.getByRole("button", { name: "Save attendance" })).toBeEnabled()

  const backLink = page.getByRole("link", { name: "Back to Attendance" })
  await expectDiscardPrompt(page, () => backLink.click(), "dismiss")
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/players/record")

  await expectDiscardPrompt(page, () => backLink.click(), "accept")
  await expect(page).toHaveURL((url) => url.pathname === "/coach" && url.hash === "#attendance")
})

test("stale player roll-call tabs cannot overwrite a newer save", async ({ context, page }) => {
  await page.goto("/coach/attendance/players/record?date=2026-07-31", {
    waitUntil: "networkidle",
  })
  await page.locator(".attendance-occurrence-list > button.is-available").first().click()
  await page.waitForLoadState("networkidle")

  const firstTabGroup = page
    .locator(".attendance-record-roster-list [role=\"group\"]")
    .filter({ has: page.locator('button[aria-pressed="true"]') })
    .first()
  await expect(firstTabGroup).toBeVisible()
  const accessibleName = await firstTabGroup.getAttribute("aria-label")
  expect(accessibleName).toBeTruthy()
  const baseChoice = await firstTabGroup.getByRole("button").evaluateAll((buttons) => (
    buttons.find((button) => button.getAttribute("aria-pressed") === "true")?.textContent?.trim()
      .toLocaleLowerCase() ?? "cleared"
  )) as "present" | "absent" | "cleared"

  const stalePage = await context.newPage()
  await stalePage.goto(page.url(), { waitUntil: "networkidle" })
  const staleGroup = stalePage.getByRole("group", {
    name: accessibleName ?? "",
    exact: true,
  })
  await expect(staleGroup).toBeVisible()

  const firstChoice = baseChoice === "present" ? "Absent" : "Present"
  const staleChoice = baseChoice === "present" ? "Present" : "Absent"
  await firstTabGroup.getByRole("button", { name: firstChoice, exact: true }).click()
  await staleGroup.getByRole("button", { name: staleChoice, exact: true }).click()

  await page.getByRole("button", { name: "Save attendance" }).click()
  await expect(page.getByText("Attendance saved", { exact: true })).toBeVisible()

  await stalePage.getByRole("button", { name: "Save attendance" }).click()
  await expect(stalePage.getByText(/changed since this page was opened/i)).toBeVisible()

  const restoreChoice = baseChoice === "absent" ? "Absent" : "Present"
  await firstTabGroup.getByRole("button", { name: restoreChoice, exact: true }).click()
  await page.getByRole("button", { name: "Save attendance" }).click()
  await expect(page.getByText("Attendance saved", { exact: true })).toBeVisible()
  await stalePage.close({ runBeforeUnload: false })
})

test("Record Attendance keeps the selected roster attached on tablet and split on web", async ({ page }) => {
  await page.setViewportSize({ height: 1024, width: 820 })
  await page.goto("/coach/attendance/players/record?date=2026-08-03", {
    waitUntil: "networkidle",
  })
  const firstAvailableSession = page
    .locator(".attendance-occurrence-list > button.is-available")
    .first()
  await firstAvailableSession.click()
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("occurrence")))
  await page.waitForLoadState("networkidle")

  const roster = page.locator("#attendance-roster-panel")
  await expect(roster).toBeVisible()
  const selectedSession = page.locator(".attendance-occurrence-list button.is-selected")
  await expect(selectedSession).toBeVisible()
  const selectedBox = await selectedSession.boundingBox()
  const rosterBox = await roster.boundingBox()
  expect(selectedBox).not.toBeNull()
  expect(rosterBox).not.toBeNull()
  expect(Math.abs((selectedBox?.y ?? 0) + (selectedBox?.height ?? 0) - (rosterBox?.y ?? 0)))
    .toBeLessThanOrEqual(2)
  await expect(roster.locator(".attendance-roster-folio").first()).toHaveText("01")
  await expect(roster.locator(".attendance-record-roster-list")).not.toContainText(/\bAB\b/)

  await page.setViewportSize({ height: 900, width: 1440 })
  await expect.poll(async () => {
    const sessionBox = await selectedSession.boundingBox()
    const desktopRosterBox = await roster.boundingBox()
    if (!sessionBox || !desktopRosterBox) return false
    return desktopRosterBox.x > sessionBox.x + sessionBox.width
  }).toBe(true)
})

test("Staff Roll Call matches the player roster choice controls across responsive views", async ({ page }) => {
  await page.goto("/coach/attendance/staff/record?date=2026-08-03", {
    waitUntil: "networkidle",
  })

  const ledger = page.locator(".staff-roll-call-ledger")
  const rows = ledger.locator(".staff-roll-call-list > article")
  await expect(rows).toHaveCount(2)
  await expect(ledger.locator(".staff-roll-call-folio")).toHaveText(["01", "02"])
  await expect(ledger.locator(".staff-roll-call-person > span")).toHaveCount(0)

  const arunChoices = ledger.getByRole("group", { name: "Attendance for Arun Kumar" })
  const meeraChoices = ledger.getByRole("group", { name: "Attendance for Meera Nair" })
  for (const group of [arunChoices, meeraChoices]) {
    await expect(group.getByRole("button")).toHaveCount(2)
    await expect(group.getByRole("button", { name: "Present", exact: true })).toBeVisible()
    await expect(group.getByRole("button", { name: "Absent", exact: true })).toBeVisible()
    await expect(group.getByRole("button", { name: "Not recorded", exact: true })).toHaveCount(0)
  }

  await expect(arunChoices.getByRole("button", { name: "Present", exact: true }))
    .toHaveAttribute("aria-pressed", "true")
  await expect(meeraChoices.getByRole("button", { name: "Absent", exact: true }))
    .toHaveAttribute("aria-pressed", "true")

  await meeraChoices.getByRole("button", { name: "Absent", exact: true }).click()
  await expect(meeraChoices.getByRole("button", { name: "Present", exact: true }))
    .toHaveAttribute("aria-pressed", "false")
  await expect(meeraChoices.getByRole("button", { name: "Absent", exact: true }))
    .toHaveAttribute("aria-pressed", "false")
  await expect(arunChoices.getByRole("button", { name: "Present", exact: true }))
    .toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Save staff attendance" })).toBeEnabled()

  await meeraChoices.getByRole("button", { name: "Absent", exact: true }).click()
  await expect(page.getByRole("button", { name: "Save staff attendance" })).toBeDisabled()

  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 1024, width: 820 },
    { height: 844, width: 390 },
    { height: 700, width: 320 },
  ]) {
    await page.setViewportSize(viewport)
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(overflow.scrollWidth, `${viewport.width}px staff roll call`).toBeLessThanOrEqual(
      overflow.clientWidth + 1,
    )

    const controls = arunChoices.getByRole("button")
    const groupPresentation = await arunChoices.evaluate((group) => {
      const style = getComputedStyle(group)
      return {
        borderTopWidth: style.borderTopWidth,
        columnGap: style.columnGap,
      }
    })
    const boxes = await controls.evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect()
      return {
        boxShadow: getComputedStyle(button).boxShadow,
        fontSize: getComputedStyle(button).fontSize,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
      }
    }))
    expect(groupPresentation.borderTopWidth).toBe("1px")
    expect(groupPresentation.columnGap).toBe("0px")
    expect(Math.max(...boxes.map((box) => box.top)) - Math.min(...boxes.map((box) => box.top)))
      .toBeLessThanOrEqual(1)
    expect(Math.abs(boxes[1].left - boxes[0].right)).toBeLessThanOrEqual(1)
    expect(boxes[0].boxShadow).toBe("none")
    expect(boxes[0].fontSize).toBe("11px")
    if (viewport.width <= 760) {
      expect(Math.min(...boxes.map((box) => box.height))).toBeGreaterThanOrEqual(44)
    }
  }
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
  await firstHistoryItem.click()
  await expect(firstHistoryItem).toHaveAttribute("aria-expanded", "true")
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

test("Collapsed reschedule rows tint the bar while keeping status boxes white", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })

  await page.getByRole("button", {
    name: /Previous reschedules \(\d+\)/i,
  }).click()

  const collapsedRow = page.locator(
    '.coach-adjustment-history-item:has(> button[aria-expanded="false"]):has(.coach-adjustment-history-status.is-published), '
      + '.coach-adjustment-history-item:has(> button[aria-expanded="false"]):has(.coach-adjustment-history-status.is-voided)',
  ).first()
  const status = collapsedRow.locator(".coach-adjustment-history-status")
  await expect(status).toBeVisible()

  const restingRowBackground = await collapsedRow.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))
  const restingStatusBackground = await status.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))
  expect(restingStatusBackground).toBe("rgb(255, 255, 255)")

  await collapsedRow.locator(":scope > button").hover()
  await expect.poll(() => collapsedRow.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).not.toBe(restingRowBackground)
  await expect(status).toHaveCSS("background-color", restingStatusBackground)
})

test("A player without missed sessions gets a compact empty step", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })

  const playerSelect = page.locator(".coach-adjustment-field select").first()
  const playerIds = await playerSelect.locator("option").evaluateAll((options) => (
    options
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean)
  ))
  let compactEmptyStepFound = false

  for (const playerId of playerIds) {
    await playerSelect.selectOption(playerId)
    await expect(page).toHaveURL((url) => url.searchParams.get("player") === playerId)
    await page.waitForLoadState("networkidle")
    const compactEmptyStep = page.locator(".coach-adjustment-empty-step.is-compact")
    if (!await compactEmptyStep.isVisible()) continue

    compactEmptyStepFound = true
    await expect(compactEmptyStep).toContainText("has no unreconciled absences")
    const height = await compactEmptyStep.evaluate((element) => (
      element.getBoundingClientRect().height
    ))
    expect(height).toBeLessThanOrEqual(56)
    break
  }

  expect(compactEmptyStepFound).toBe(true)
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
