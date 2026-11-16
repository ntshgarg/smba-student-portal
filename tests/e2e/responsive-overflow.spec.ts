import type { Locator, Page } from "@playwright/test"

// Not "@playwright/test". These cases gate a merge now, and the extended
// test object is what stages the masked screenshot and sanitized JSON under
// SMBA_FAILURE_EVIDENCE_ROOT on a failure -- the only tree the browser job
// uploads, and the reason playwright.responsive-overflow.config.ts now
// retains no raw trace of its own.
import { expect, test } from "./support/failure-evidence"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const PLAYER_ACADEMY_ID = process.env.SMBA_CAPTURE_PLAYER_ACADEMY_ID ?? "SMBA-PL-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"
const WIDTH_TOLERANCE_PX = 1

const announcementViewports = [
  { height: 568, width: 320 },
  { height: 800, width: 360 },
  { height: 844, width: 390 },
  { height: 932, width: 430 },
] as const

const landscapeViewports = [
  { height: 390, width: 844 },
  { height: 430, width: 932 },
] as const

/*
 * The two Fees ledgers that are tables: Collections and Activity. Each sits in a
 * panel that never scrolls sideways -- above 720px the table fits the panel, and
 * at 720px and below (components/coach/financials/fees.module.css) every row
 * becomes a two-line entry, so the table lays out as blocks.
 */
const feeRecordRoutes = [
  {
    route: "/coach/financials/records?view=collections&from=2026-08-01&to=2026-08-31",
    tableName: "Payment and refund records",
  },
  {
    route: "/coach/financials/records?view=activity",
    tableName: "Changes to academy finances",
  },
] as const

const FEES_STACK_WIDTH = 720

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return

  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
    timeout: 20_000,
  })
}

async function loginAsPlayer(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/player")) return

  await page.getByLabel("Academy ID").fill(PLAYER_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/player"), {
    timeout: 20_000,
  })
}

async function settleResponsiveLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
    })
  })
}

async function expectNoDocumentOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))

  expect(
    dimensions.scrollWidth,
    `${context}: document scrollWidth ${dimensions.scrollWidth}px exceeded clientWidth ${dimensions.clientWidth}px`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + WIDTH_TOLERANCE_PX)
}

async function expectHorizontallyContained(locator: Locator, context: string) {
  await expect(locator, `${context}: target should be rendered`).toBeVisible()
  const dimensions = await locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      left: bounds.left,
      right: bounds.right,
      viewportWidth: document.documentElement.clientWidth,
    }
  })

  expect(dimensions.left, `${context}: target crossed the viewport's left edge`)
    .toBeGreaterThanOrEqual(-WIDTH_TOLERANCE_PX)
  expect(dimensions.right, `${context}: target crossed the viewport's right edge`)
    .toBeLessThanOrEqual(dimensions.viewportWidth + WIDTH_TOLERANCE_PX)
}

async function expectTextFragmentUnbroken(
  locator: Locator,
  textFragment: string,
  context: string,
) {
  await expect(locator, `${context}: heading should be rendered`).toBeVisible()
  const lineCount = await locator.evaluate((element, fragment) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let textNode = walker.nextNode()
    while (textNode) {
      const value = textNode.textContent ?? ""
      const start = value.indexOf(fragment)
      if (start >= 0) {
        const range = document.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, start + fragment.length)
        return [...range.getClientRects()]
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .length
      }
      textNode = walker.nextNode()
    }
    return 0
  }, textFragment)

  expect(lineCount, `${context}: ${textFragment} should remain on one line`).toBe(1)
}

async function expectTableFitsPanel({
  page,
  tableName,
  testContext,
}: {
  page: Page
  tableName: string
  testContext: string
}) {
  const table = page.getByRole("table", { name: tableName })
  await expect(table).toBeVisible()

  const dimensions = await table.evaluate((element) => {
    const panel = element.parentElement
    if (!panel) throw new Error("The records table has no containing element")
    const bounds = panel.getBoundingClientRect()
    return {
      clientWidth: panel.clientWidth,
      left: bounds.left,
      right: bounds.right,
      // The ledgers stack by their panel's width in em (fees.module.css @container), not the viewport's.
      stackWidth: 45 * parseFloat(window.getComputedStyle(panel).fontSize),
      tableDisplay: window.getComputedStyle(element).display,
      tableWidth: element.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }
  })

  expect(dimensions.left, `${testContext}: panel crossed the viewport's left edge`)
    .toBeGreaterThanOrEqual(-WIDTH_TOLERANCE_PX)
  expect(dimensions.right, `${testContext}: panel crossed the viewport's right edge`)
    .toBeLessThanOrEqual(dimensions.viewportWidth + WIDTH_TOLERANCE_PX)
  expect(dimensions.tableWidth, `${testContext}: table should fit its panel`)
    .toBeLessThanOrEqual(dimensions.clientWidth + WIDTH_TOLERANCE_PX)
  expect(dimensions.tableDisplay, `${testContext}: table display`)
    .toBe(dimensions.clientWidth <= dimensions.stackWidth ? "block" : "table")
}

test("Coach dashboard tickets keep the selected responsive composition", async ({ page }) => {
  await loginAsCoach(page)

  const cases = [
    { height: 1000, mode: "web", width: 1440 },
    { height: 1000, mode: "tablet", width: 820 },
    { height: 844, mode: "mobile", width: 390 },
  ] as const

  for (const viewport of cases) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.goto("/coach", { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)
    await page.getByRole("link", { name: "Today’s attendance" }).click()
    await expect(page).toHaveURL((url) => url.hash === "#attendance")

    await expect.poll(async () => page.evaluate(() => {
      const grid = document.querySelector("[data-coach-dashboard-grid]")?.getBoundingClientRect()
      const header = document.querySelector(".portal-header")?.getBoundingClientRect()
      if (!grid || !header) return Number.POSITIVE_INFINITY

      return Math.abs(grid.top - header.bottom)
    })).toBeLessThanOrEqual(2)

    const grid = page.locator("[data-coach-dashboard-grid]")
    await expect(grid).toBeVisible()
    const cards = await grid.locator("[data-area]").evaluateAll((sections) => Object.fromEntries(
      sections.map((section) => {
        const bounds = section.getBoundingClientRect()
        return [section.getAttribute("data-area"), {
          height: bounds.height,
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
        }]
      }),
    )) as Record<string, { height: number; left: number; top: number; width: number }>
    const gridBounds = await grid.boundingBox()
    expect(gridBounds).not.toBeNull()

    const expectSameRow = (first: string, second: string) => {
      expect(Math.abs(cards[first].top - cards[second].top)).toBeLessThanOrEqual(2)
    }

    // coach-dashboard-glass-cards (.21st/DESIGN.md): what needs the coach comes first, so Financials
    // sits beside Sessions straight after Onboarding
    if (viewport.mode === "web") {
      expect(Math.abs(cards.onboarding.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.attendance.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expectSameRow("financials", "sessions")
      expectSameRow("reports", "announcements")
      expectSameRow("announcements", "members")
      expect(cards.financials.left).toBeLessThan(cards.sessions.left)
      expect(cards.reports.left).toBeLessThan(cards.announcements.left)
      expect(cards.announcements.left).toBeLessThan(cards.members.left)
      expect(cards.sessions.top).toBeLessThan(cards.reports.top)
    } else if (viewport.mode === "tablet") {
      expect(Math.abs(cards.onboarding.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.attendance.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.members.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expectSameRow("financials", "sessions")
      expectSameRow("reports", "announcements")
      expect(cards.financials.left).toBeLessThan(cards.sessions.left)
      expect(cards.reports.left).toBeLessThan(cards.announcements.left)
    } else {
      const order = [
        "attendance",
        "onboarding",
        "financials",
        "sessions",
        "reports",
        "announcements",
        "members",
      ]
      for (let index = 1; index < order.length; index += 1) {
        expect(cards[order[index]].top).toBeGreaterThan(cards[order[index - 1]].top)
        expect(Math.abs(cards[order[index]].width - cards.attendance.width)).toBeLessThanOrEqual(2)
      }
    }

    // The card's three ways in: "Mark today's attendance" first, then Register and Make-ups.
    const attendanceActions = grid.locator('[data-area="attendance"]')
      .getByRole("navigation", { name: "Attendance actions" })
    await expect(attendanceActions.getByRole("link")).toHaveText([
      "Mark today's attendance",
      "Register",
      "Make-ups",
    ])
    const attendanceActionGeometry = await attendanceActions.evaluate((actions) => ({
      navWidth: actions.getBoundingClientRect().width,
      actions: [...actions.querySelectorAll("a")].map((action) => {
        const bounds = action.getBoundingClientRect()
        return { height: bounds.height, width: bounds.width }
      }),
    }))

    expect(attendanceActionGeometry.actions.every(({ height }) => height >= 50)).toBe(true)
    if (viewport.mode === "mobile") {
      // Each link, "Mark today's attendance" included, spans the card.
      for (const { width } of attendanceActionGeometry.actions) {
        expect(Math.abs(width - attendanceActionGeometry.navWidth)).toBeLessThanOrEqual(2)
      }
    } else {
      for (const { width } of attendanceActionGeometry.actions.slice(1)) {
        expect(Math.abs(width - attendanceActionGeometry.actions[0].width)).toBeLessThanOrEqual(2)
      }
    }

    const actionHeights = await grid.getByRole("link").evaluateAll((links) => (
      links.map((link) => link.getBoundingClientRect().height)
    ))
    expect(actionHeights.length).toBeGreaterThan(0)
    expect(actionHeights.every((height) => height >= 44)).toBe(true)
    await expectNoDocumentOverflow(page, `${viewport.width}x${viewport.height} coach tickets`)
  }
})

test("Player attendance calendar stays seven columns without horizontal overflow", async ({ page }) => {
  await loginAsPlayer(page)

  const viewports = [
    { height: 900, width: 1440 },
    { height: 1024, width: 820 },
    { height: 960, width: 740 },
    { height: 844, width: 390 },
    { height: 568, width: 320 },
  ] as const

  for (const viewport of viewports) {
    const viewportLabel = viewport.width + "x" + viewport.height
    await page.setViewportSize(viewport)
    await page.goto("/player?attendance=register", { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)

    const calendar = page.getByRole("grid", { name: /Your attendance calendar/u })
    await expect(calendar.getByRole("columnheader")).toHaveCount(7)
    await expect(calendar.getByRole("gridcell")).toHaveCount(42)
    const dimensions = await calendar.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(
      dimensions.scrollWidth,
      viewportLabel + ": calendar should fit without local horizontal scrolling",
    ).toBeLessThanOrEqual(dimensions.clientWidth + WIDTH_TOLERANCE_PX)

    const controls = page.locator([
      ".player-attendance-year-selector button",
      ".player-attendance-month-nav",
      ".player-attendance-today",
    ].join(", "))
    const controlHeights = await controls.evaluateAll((elements) => (
      elements.map((element) => element.getBoundingClientRect().height)
    ))
    expect(controlHeights.length).toBeGreaterThan(0)
    expect(controlHeights.every((height) => height >= 44)).toBe(true)

    const headerLayout = await page.locator(".player-attendance-register-heading")
      .evaluate((heading) => {
        const title = heading.querySelector<HTMLElement>(".player-attendance-register-title")
        const actions = heading.querySelector<HTMLElement>(".player-attendance-register-actions")
        const years = heading.querySelector<HTMLElement>(".player-attendance-year-selector")
        const today = heading.querySelector<HTMLElement>(".player-attendance-today")
        if (!title || !actions || !years || !today) throw new Error("Attendance header is incomplete")

        const box = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect()
          return {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width,
          }
        }

        return {
          actions: box(actions),
          title: box(title),
          today: box(today),
          years: box(years),
        }
      })

    if (viewport.width > 760) {
      const titleCenter = headerLayout.title.top + headerLayout.title.height / 2
      const actionsCenter = headerLayout.actions.top + headerLayout.actions.height / 2
      const yearsCenter = headerLayout.years.top + headerLayout.years.height / 2
      const todayCenter = headerLayout.today.top + headerLayout.today.height / 2
      expect(Math.abs(titleCenter - actionsCenter)).toBeLessThanOrEqual(1)
      expect(Math.abs(yearsCenter - todayCenter)).toBeLessThanOrEqual(1)
      expect(headerLayout.today.left).toBeGreaterThan(headerLayout.years.right)
    } else {
      expect(headerLayout.actions.top).toBeGreaterThanOrEqual(headerLayout.title.bottom)
      expect(Math.abs(headerLayout.years.width - headerLayout.actions.width))
        .toBeLessThanOrEqual(1)
      expect(headerLayout.today.top).toBeGreaterThanOrEqual(headerLayout.years.bottom)
    }

    await expectNoDocumentOverflow(page, viewportLabel + " player attendance calendar")
  }
})

test("Announcements remain contained at every supported portrait width", async ({ page }) => {
  await loginAsCoach(page)

  for (const viewport of announcementViewports) {
    const viewportLabel = `${viewport.width}x${viewport.height}`
    await page.setViewportSize(viewport)
    await page.goto("/coach", { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)

    const card = page.locator("[aria-labelledby='coach-announcements-card-title'] article")
    await expectHorizontallyContained(card, `${viewportLabel} announcement dashboard card`)
    await expectHorizontallyContained(
      page.getByRole("heading", { name: "Announcements", exact: true }),
      `${viewportLabel} announcement dashboard heading`,
    )
    await expectTextFragmentUnbroken(
      page.getByRole("heading", { name: "Announcements", exact: true }),
      "Announcements",
      `${viewportLabel} announcement dashboard heading`,
    )
    for (const linkName of ["New announcement", "Published announcements"]) {
      await expectHorizontallyContained(
        card.getByRole("link", { name: linkName }),
        `${viewportLabel} ${linkName} action`,
      )
    }
    await expectNoDocumentOverflow(page, `${viewportLabel} coach dashboard`)

    await page.goto("/coach/announcements", { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)

    await expectHorizontallyContained(
      page.getByRole("heading", { name: "Announcements", exact: true }),
      `${viewportLabel} announcements heading`,
    )
    await expectTextFragmentUnbroken(
      page.getByRole("heading", { name: "Announcements", exact: true }),
      "Announcements",
      `${viewportLabel} announcements heading`,
    )
    const monthControl = page.getByLabel("Choose announcement month")
    if (await monthControl.count()) {
      await expectHorizontallyContained(
        monthControl,
        `${viewportLabel} announcement month control`,
      )
      await expectHorizontallyContained(
        page.getByRole("link", { name: "New announcement", exact: true }),
        `${viewportLabel} archive action`,
      )
    } else {
      await expect(page.getByRole("search")).toHaveCount(0)
      await expectHorizontallyContained(
        page.getByRole("link", { name: "Write the first announcement", exact: true }),
        `${viewportLabel} empty archive action`,
      )
    }
    await expectNoDocumentOverflow(page, `${viewportLabel} announcement archive`)
  }
})

test("New Announcement exposes its first field in every supported portrait viewport", async ({ page }) => {
  await loginAsCoach(page)

  for (const viewport of announcementViewports) {
    const viewportLabel = `${viewport.width}x${viewport.height}`
    await page.setViewportSize(viewport)
    await page.goto("/coach/announcements/new", { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)

    const title = page.getByPlaceholder("Holiday training schedule")
    await expect(title).toBeVisible()
    const bounds = await title.boundingBox()
    expect(bounds, `${viewportLabel} Title field should have layout bounds`).not.toBeNull()
    expect(
      (bounds?.y ?? viewport.height) + (bounds?.height ?? 0),
      `${viewportLabel} Title field should fit in the initial viewport`,
    ).toBeLessThanOrEqual(viewport.height + WIDTH_TOLERANCE_PX)
    await expectNoDocumentOverflow(page, `${viewportLabel} New Announcement`)
  }
})

test("Fees ledgers fit their panel without widening the page", async ({ page }) => {
  await loginAsCoach(page)

  for (const viewport of [...landscapeViewports, { height: 900, width: FEES_STACK_WIDTH }, { height: 900, width: FEES_STACK_WIDTH + 1 }, { height: 900, width: 1440 }]) {
    for (const recordView of feeRecordRoutes) {
      const testContext = `${recordView.tableName} at ${viewport.width}x${viewport.height}`
      await page.setViewportSize(viewport)
      await page.goto(recordView.route, { waitUntil: "domcontentloaded" })
      await settleResponsiveLayout(page)

      await expectTableFitsPanel({ page, tableName: recordView.tableName, testContext })
      await expectNoDocumentOverflow(page, testContext)
    }
  }
})
