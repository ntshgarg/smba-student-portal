import { expect, test } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

const COACH_ACADEMY_ID = "SMBA#0001"
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

const feeRecordRoutes = [
  {
    route: "/coach/financials/records?view=fees&mode=monthly&period=2026-08&scope=active&status=all",
    tableName: "Player fee records",
  },
  {
    route: "/coach/financials/records?view=collections&from=2026-08-01&to=2026-08-31",
    tableName: "Payment and refund records",
  },
] as const

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return

  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
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

async function expectContainedScrollableTable({
  expectLocalScroll,
  page,
  tableName,
  testContext,
}: {
  expectLocalScroll: boolean
  page: Page
  tableName: string
  testContext: string
}) {
  const table = page.getByRole("table", { name: tableName })
  await expect(table).toBeVisible()

  const dimensions = await table.evaluate((element) => {
    const wrapper = element.parentElement
    if (!wrapper) throw new Error("The records table has no containing element")
    const bounds = wrapper.getBoundingClientRect()
    return {
      clientWidth: wrapper.clientWidth,
      left: bounds.left,
      overflowX: window.getComputedStyle(wrapper).overflowX,
      right: bounds.right,
      scrollWidth: wrapper.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }
  })

  expect(dimensions.left, `${testContext}: table wrapper crossed the viewport's left edge`)
    .toBeGreaterThanOrEqual(-WIDTH_TOLERANCE_PX)
  expect(dimensions.right, `${testContext}: table wrapper crossed the viewport's right edge`)
    .toBeLessThanOrEqual(dimensions.viewportWidth + WIDTH_TOLERANCE_PX)

  if (expectLocalScroll) {
    expect(dimensions.overflowX, `${testContext}: table wrapper must own horizontal scrolling`)
      .toMatch(/^(auto|scroll)$/u)
    expect(dimensions.scrollWidth, `${testContext}: desktop table should overflow only its wrapper`)
      .toBeGreaterThan(dimensions.clientWidth + WIDTH_TOLERANCE_PX)
  } else {
    expect(dimensions.scrollWidth, `${testContext}: stacked table should fit its wrapper`)
      .toBeLessThanOrEqual(dimensions.clientWidth + WIDTH_TOLERANCE_PX)
  }
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
      const hero = document.querySelector(".coach-welcome-hero")?.getBoundingClientRect()
      if (!grid || !header || !hero) return Number.POSITIVE_INFINITY

      return Math.max(
        Math.abs(grid.top - header.bottom),
        Math.abs(hero.bottom - header.bottom),
      )
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

    if (viewport.mode === "web") {
      expect(Math.abs(cards.attendance.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expectSameRow("sessions", "reports")
      expectSameRow("financials", "announcements")
      expectSameRow("announcements", "members")
      expect(cards.sessions.left).toBeLessThan(cards.reports.left)
      expect(cards.financials.left).toBeLessThan(cards.announcements.left)
      expect(cards.announcements.left).toBeLessThan(cards.members.left)
    } else if (viewport.mode === "tablet") {
      expect(Math.abs(cards.attendance.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.sessions.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expectSameRow("reports", "financials")
      expectSameRow("announcements", "members")
      expect(cards.reports.left).toBeLessThan(cards.financials.left)
      expect(cards.announcements.left).toBeLessThan(cards.members.left)
    } else {
      const order = [
        "attendance",
        "sessions",
        "reports",
        "financials",
        "announcements",
        "members",
      ]
      for (let index = 1; index < order.length; index += 1) {
        expect(cards[order[index]].top).toBeGreaterThan(cards[order[index - 1]].top)
        expect(Math.abs(cards[order[index]].width - cards.attendance.width)).toBeLessThanOrEqual(2)
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
      page.getByRole("heading", { name: "Published announcements", exact: true }),
      `${viewportLabel} published announcements heading`,
    )
    await expectTextFragmentUnbroken(
      page.getByRole("heading", { name: "Published announcements", exact: true }),
      "announcements",
      `${viewportLabel} published announcements heading`,
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

test("Published report detail contains revision history at every supported portrait width", async ({ page }) => {
  await loginAsCoach(page)
  await page.goto("/coach/reports?period=2026-07", { waitUntil: "domcontentloaded" })

  const detailLink = page.locator(".coach-published-report-actions a").first()
  await expect(detailLink).toBeVisible()
  const detailHref = await detailLink.getAttribute("href")
  if (!detailHref) throw new Error("Published report detail link has no href")
  expect(detailHref).toMatch(/^\/coach\/reports\/publications\//u)

  for (const viewport of announcementViewports) {
    const viewportLabel = `${viewport.width}x${viewport.height}`
    await page.setViewportSize(viewport)
    await page.goto(detailHref, { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)

    const detailGrid = page.locator(".coach-published-report-detail-grid")
    const revisionNavigation = page.locator(".coach-published-report-revisions nav")
    await expectHorizontallyContained(detailGrid, `${viewportLabel} published report detail`)
    await expect(revisionNavigation).toBeVisible()
    await expect(revisionNavigation).toHaveCSS("overflow-x", "auto")
    await expectNoDocumentOverflow(page, `${viewportLabel} published report detail`)
  }
})

test("Fee Records tables own landscape overflow without widening the page", async ({ page }) => {
  await loginAsCoach(page)

  for (const viewport of landscapeViewports) {
    for (const recordView of feeRecordRoutes) {
      const testContext = `${recordView.tableName} at ${viewport.width}x${viewport.height}`
      await page.setViewportSize(viewport)
      await page.goto(recordView.route, { waitUntil: "domcontentloaded" })
      await settleResponsiveLayout(page)

      await expectContainedScrollableTable({
        expectLocalScroll: true,
        page,
        tableName: recordView.tableName,
        testContext,
      })
      await expectNoDocumentOverflow(page, testContext)
    }
  }
})

test("Fee Records preserves its 720px table breakpoint and desktop layout", async ({ page }) => {
  await loginAsCoach(page)
  const feeRegister = feeRecordRoutes[0]

  for (const breakpointCase of [
    { expectLocalScroll: false, height: 900, width: 720 },
    { expectLocalScroll: true, height: 900, width: 721 },
  ]) {
    const testContext = `Fee Register at ${breakpointCase.width}px`
    await page.setViewportSize({
      height: breakpointCase.height,
      width: breakpointCase.width,
    })
    await page.goto(feeRegister.route, { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)
    await expectContainedScrollableTable({
      expectLocalScroll: breakpointCase.expectLocalScroll,
      page,
      tableName: feeRegister.tableName,
      testContext,
    })
    await expectNoDocumentOverflow(page, testContext)
  }

  await page.setViewportSize({ height: 900, width: 1440 })
  await page.goto(feeRegister.route, { waitUntil: "domcontentloaded" })
  await settleResponsiveLayout(page)
  await expect(page.getByRole("table", { name: feeRegister.tableName })).toBeVisible()
  await expectNoDocumentOverflow(page, "Fee Register at 1440px")
})
