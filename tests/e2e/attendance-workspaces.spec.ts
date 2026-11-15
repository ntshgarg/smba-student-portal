import type { Page } from "@playwright/test"

import { expect, test } from "./support/failure-evidence"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return

  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => (
    url.pathname === "/auth/pin/setup" || url.pathname.startsWith("/coach")
  ), {
    timeout: 20_000,
  })
  if (new URL(page.url()).pathname === "/auth/pin/setup") {
    await page.getByLabel("Enter PIN").fill("739251")
    await page.getByLabel("Confirm PIN").fill("739251")
    await page.getByRole("button", { name: "Set up PIN" }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
      timeout: 20_000,
    })
  }
}

async function chooseAPlayerWithAnAbsence(page: Page) {
  const playerSelect = page.getByRole("combobox", { name: /player/i })
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
    const missedSessions = page.getByRole("group", { name: "Missed session" })
    await expect(missedSessions).toBeVisible()
    if (await missedSessions.getByRole("button").first().isVisible()) return
  }

  throw new Error("The loaded fixture contains no player with an unreconciled absence")
}

async function makeRescheduleDraftDirty(page: Page) {
  await chooseAPlayerWithAnAbsence(page)

  const missedSessions = page.getByRole("group", { name: "Missed session" })
  await missedSessions.getByRole("button").first().click()

  // A date with two missed sessions asks for the exact one before the next step opens.
  const exactSession = missedSessions
    .getByText("Choose the exact missed session")
    .locator("xpath=ancestor::div[1]")
    .getByRole("button")
    .first()
  const lockedCompletion = page.getByText("Choose the missed session first")

  await expect.poll(async () => (
    Number(await exactSession.isVisible().catch(() => false))
    + Number(!(await lockedCompletion.isVisible().catch(() => true)))
  )).toBeGreaterThan(0)

  if (await exactSession.isVisible()) await exactSession.click()
  await expect(lockedCompletion).toHaveCount(0)
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

// A session card on the Mark tab that can be opened.
const sessionHead = 'button[aria-controls="attendance-roster-panel"]:not([disabled])'

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
  await expect(page.getByRole("heading", { level: 1, name: "Attendance" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Attendance sections" })
    .getByRole("link", { name: "Mark" })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("#attendance-register")).toHaveCount(0)

  await page.goto("/coach#attendance", { waitUntil: "domcontentloaded" })
  await page.locator("#attendance [data-area=\"attendance\"]")
    .getByRole("link", { name: "Reschedule attendance" })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/adjustments")
  await expect(page.getByRole("heading", { level: 1, name: "Attendance" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Make-ups" })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("#attendance-adjustments-workspace")).toBeVisible()

  await expect(page.getByRole("combobox", { name: /player/i })).toBeVisible()
})

test("Record Attendance protects unsaved session-roster changes", async ({ page }) => {
  await page.goto("/coach/attendance/players/record?date=2026-08-03", {
    waitUntil: "networkidle",
  })
  const firstAvailableSession = page
    .locator(sessionHead)
    .first()
  await expect(firstAvailableSession).toBeVisible()
  await firstAvailableSession.click()
  const firstRosterPlayer = page
    .locator("#attendance-roster-panel [role=\"group\"]")
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
  // One Present | Absent switch: both halves on one line, the same size, and
  // only the chosen half filled.
  const playerChoicePresentation = await firstRosterPlayer.evaluate((group) => (
    Array.from(group.querySelectorAll("button")).map((button) => {
      const box = button.getBoundingClientRect()
      return {
        backgroundColor: getComputedStyle(button).backgroundColor,
        height: box.height,
        pressed: button.getAttribute("aria-pressed") === "true",
        top: box.top,
      }
    })
  ))
  expect(Math.abs(playerChoicePresentation[0].top - playerChoicePresentation[1].top))
    .toBeLessThanOrEqual(1)
  expect(playerChoicePresentation[0].height).toBe(playerChoicePresentation[1].height)
  expect(playerChoicePresentation.filter((choice) => choice.pressed)).toHaveLength(1)
  expect(playerChoicePresentation.find((choice) => !choice.pressed)?.backgroundColor)
    .toBe("rgba(0, 0, 0, 0)")
  await expect(page.getByRole("button", { name: "Save attendance" })).toBeEnabled()

  const backLink = page.getByRole("link", { name: "Back to dashboard" })
  await expectDiscardPrompt(page, () => backLink.click(), "dismiss")
  await expect(page).toHaveURL((url) => url.pathname === "/coach/attendance/players/record")

  await expectDiscardPrompt(page, () => backLink.click(), "accept")
  await expect(page).toHaveURL((url) => url.pathname === "/coach" && url.hash === "#attendance")
})

test("stale player roll-call tabs cannot overwrite a newer save", async ({ context, page }) => {
  await page.goto("/coach/attendance/players/record?date=2026-07-31", {
    waitUntil: "networkidle",
  })
  await page.locator(sessionHead).first().click()
  await page.waitForLoadState("networkidle")

  const firstTabGroup = page
    .locator("#attendance-roster-panel [role=\"group\"]")
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

test("Record Attendance opens the selected session in place on tablet and web", async ({ page }) => {
  await page.setViewportSize({ height: 1024, width: 820 })
  await page.goto("/coach/attendance/players/record?date=2026-08-03", {
    waitUntil: "networkidle",
  })
  const firstAvailableSession = page
    .locator(sessionHead)
    .first()
  await firstAvailableSession.click()
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("occurrence")))
  await page.waitForLoadState("networkidle")

  // The session's head becomes the band over its register, at both widths.
  const roster = page.locator("#attendance-roster-panel")
  await expect(roster).toBeVisible()
  const selectedSession = page.locator(`${sessionHead}[aria-expanded="true"]`)
  await expect(selectedSession).toBeVisible()
  for (const viewport of [{ height: 1024, width: 820 }, { height: 900, width: 1440 }]) {
    await page.setViewportSize(viewport)
    const selectedBox = await selectedSession.boundingBox()
    const rosterBox = await roster.boundingBox()
    expect(selectedBox).not.toBeNull()
    expect(rosterBox).not.toBeNull()
    expect(Math.abs((selectedBox?.y ?? 0) + (selectedBox?.height ?? 0) - (rosterBox?.y ?? 0)))
      .toBeLessThanOrEqual(2)
    expect(Math.abs((selectedBox?.x ?? 0) - (rosterBox?.x ?? 0))).toBeLessThanOrEqual(2)
  }
})

test("Staff Roll Call matches the player roster choice controls across responsive views", async ({ page }) => {
  // The old address opens the Mark tab's staff card on the same date.
  await page.goto("/coach/attendance/staff/record?date=2026-08-03", {
    waitUntil: "networkidle",
  })
  await expect(page).toHaveURL((url) => (
    url.pathname === "/coach/attendance/players/record"
    && url.searchParams.get("date") === "2026-08-03"
    && url.searchParams.get("staff") === "open"
  ))

  const ledger = page.locator("#staff-roll-call-panel")
  const rows = ledger.getByRole("listitem")
  await expect(rows).toHaveCount(2)

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
    expect(Math.max(...boxes.map((box) => box.top)) - Math.min(...boxes.map((box) => box.top)))
      .toBeLessThanOrEqual(1)
    expect(boxes[1].left).toBeGreaterThan(boxes[0].right - 1)
    // Arun is marked present, so only that half is filled.
    expect(boxes[1].boxShadow).toBe("none")
    /*
     * Both halves, not just the first. This assertion only ever read boxes[0],
     * which is why it sat green while the pair rendered at 11px and 8px on every
     * phone-width screen -- the mobile block styled both buttons, a later
     * un-mediated rule re-raised only one, and the control whose whole point is
     * that the two options look alike did not. Fixed in the commit that added
     * this line; pinned here so it cannot come back unseen.
     */
    expect(boxes[1].fontSize).toBe(boxes[0].fontSize)
    expect(boxes[0].fontSize).toBe("14px")
    if (viewport.width <= 760) {
      expect(Math.min(...boxes.map((box) => box.height))).toBeGreaterThanOrEqual(44)
    }
  }
})

test("Reschedule Attendance protects its dirty draft", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })
  await makeRescheduleDraftDirty(page)

  const backLink = page.getByRole("link", { name: "Back to dashboard" })
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
  await expect(page.getByRole("combobox", { name: /player/i })).toHaveValue("")
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
    name: /Past make-ups \(\d+\)/i,
  })
  await historyDisclosure.click()
  const firstHistoryItem = page.locator("#attendance-adjustment-history article > button").first()
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
    name: /Past make-ups \(\d+\)/i,
  })).toHaveAttribute("aria-expanded", "true")
  const requestedHistoryItem = page.locator(`[aria-controls="${detailsId}"]`)
  await expect(requestedHistoryItem).toHaveAttribute("aria-expanded", "true")
  await expect(requestedHistoryItem).toBeFocused()
})

test("Collapsed make-up rows tint the bar while keeping status pills steady", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })

  await page.getByRole("button", {
    name: /Past make-ups \(\d+\)/i,
  }).click()

  const collapsedRow = page.locator(
    '#attendance-adjustment-history article:is([data-status="published"], [data-status="voided"]):has(> button[aria-expanded="false"])',
  ).first()
  const status = collapsedRow.getByText(/^(Published|Voided)$/)
  await expect(status).toBeVisible()

  const restingRowBackground = await collapsedRow.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))
  const restingStatusBackground = await status.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))

  await collapsedRow.locator(":scope > button").hover()
  await expect.poll(() => collapsedRow.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).not.toBe(restingRowBackground)
  await expect(status).toHaveCSS("background-color", restingStatusBackground)
})

test("A player without missed sessions gets a compact empty step", async ({ page }) => {
  await page.goto("/coach/attendance/adjustments", { waitUntil: "domcontentloaded" })

  const playerSelect = page.getByRole("combobox", { name: /player/i })
  const playerIds = await playerSelect.locator("option").evaluateAll((options) => (
    options
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean)
  ))
  const missedSessionStep = page.getByRole("group", { name: "Missed session" })
  const compactEmptyStep = missedSessionStep.getByText("has no unreconciled absences")
  const missedCalendar = missedSessionStep.getByRole("button").first()
  let compactEmptyStepFound = false

  for (const playerId of playerIds) {
    await playerSelect.selectOption(playerId)
    await expect(page).toHaveURL((url) => url.searchParams.get("player") === playerId)
    // Choosing a player paints this step from client state and then re-renders it when the
    // router round-trip lands, so wait for the selection to survive that re-render and for
    // the step to reach one of its two terminal shapes before reading it.
    await expect(playerSelect).toHaveValue(playerId)
    await expect(compactEmptyStep.or(missedCalendar)).toBeVisible()

    if (!(await compactEmptyStep.isVisible())) continue
    const emptyStep = await compactEmptyStep.evaluate((step) => (
      { height: step.getBoundingClientRect().height, text: step.textContent ?? "" }
    ))

    compactEmptyStepFound = true
    expect(emptyStep.text).toContain("has no unreconciled absences")
    expect(emptyStep.height).toBeLessThanOrEqual(56)
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
