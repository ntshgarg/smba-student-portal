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
 * Each register carries the width at or below which it stacks and what its
 * wrapper does above that width, because the two registers reached from this
 * route do not share a breakpoint: one expectation applied to both was wrong for
 * the fee register at every width at or below 980px.
 *
 * Both numbers are read out of
 * components/coach/financials/financial-records.module.css. The day book renders
 * the plain `.recordsTable`, which keeps `min-width: 980px` (:498-502) inside a
 * wrapper with `overflow-x: auto` (:490-496) until the `max-width: 720px` block
 * stacks it and turns that wrapper off (:1054, :1221-1223). The fee register
 * carries `.registrationTable` as well, and the `max-width: 980px` block stacks
 * that one a whole breakpoint earlier -- `.registrationTableWrap { overflow:
 * visible }` beside `.registrationTable { display: block; min-width: 0 }`
 * (:913, :953-966). The two landscape widths below, 844 and 932, sit between the
 * two breakpoints, so one viewport has to expect a stacked fee register beside a
 * horizontally scrolling day book.
 *
 * `aboveBreakpoint` differs for the same reason. Above 720px the day book's
 * 980px-wide table genuinely overflows its wrapper at every width this suite
 * uses. The fee register's `min-width` above 980px is 930px (:551-553) inside a
 * `.page-shell` of `min(100% - 48px, 1240px)` (app/globals.css:296-298), so it
 * only really overflows between about 981px and 995px -- a band whose existence
 * depends on whether the runner's Chromium reserves a classic scrollbar, which
 * is not something a merge gate should turn on. What holds at every width above
 * that breakpoint is that its wrapper, and not the document, owns whatever
 * horizontal scrolling there is, so that is what is asserted there.
 */
const feeRecordRoutes = [
  {
    aboveBreakpoint: "wrapper-owns-overflow",
    route: "/coach/financials/records?view=fees&mode=monthly&period=2026-08&scope=active&status=all",
    stacksAtOrBelow: 980,
    // financial-records-workspace.tsx:322-324 renders this caption as
    // `${formatPeriod(register.filters.period)} monthly fee records`, and
    // app/coach/financials/records/page.tsx:157 takes that period straight from
    // the query string above, falling back to academyCurrentMonth() only when no
    // valid month key is in it. The route pins period=2026-08, so the caption is
    // fixed by the route rather than by the day the suite runs; move one and move
    // the other.
    tableName: "August 2026 monthly fee records",
  },
  {
    aboveBreakpoint: "wrapper-scrolls",
    route: "/coach/financials/records?view=collections&from=2026-08-01&to=2026-08-31",
    stacksAtOrBelow: 720,
    tableName: "Payment and refund records",
  },
] as const

type FeeRecordRoute = typeof feeRecordRoutes[number]
type RecordsTableGeometry = FeeRecordRoute["aboveBreakpoint"] | "stacked"

function geometryAt(recordView: FeeRecordRoute, viewportWidth: number): RecordsTableGeometry {
  return viewportWidth > recordView.stacksAtOrBelow ? recordView.aboveBreakpoint : "stacked"
}

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

async function expectContainedScrollableTable({
  geometry,
  page,
  tableName,
  testContext,
}: {
  geometry: RecordsTableGeometry
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
      tableDisplay: window.getComputedStyle(element).display,
      viewportWidth: document.documentElement.clientWidth,
    }
  })

  expect(dimensions.left, `${testContext}: table wrapper crossed the viewport's left edge`)
    .toBeGreaterThanOrEqual(-WIDTH_TOLERANCE_PX)
  expect(dimensions.right, `${testContext}: table wrapper crossed the viewport's right edge`)
    .toBeLessThanOrEqual(dimensions.viewportWidth + WIDTH_TOLERANCE_PX)

  /*
   * The table's own `display` is the measurement that actually moves with the
   * breakpoint, and it is here because the wrapper measurements around it do not
   * move with the fee register's.
   *
   * At 981px that wrapper is about 931px wide -- `.page-shell` is
   * `min(100% - 48px, 1240px)` (app/globals.css:296-298) -- and
   * `.registrationTable`'s desktop `min-width` is 930px
   * (financial-records.module.css:551-553), so its scrollWidth equals its
   * clientWidth on the desktop side of 980 as well as on the stacked side.
   * "Fits its wrapper" is therefore true at both 980 and 981 and cannot tell them
   * apart; `.tableWrap` declares `overflow-x: auto` unconditionally (:490-496), so
   * the wrapper's overflow only speaks for the side above the breakpoint. Move the
   * `max-width: 980px` block down to 900px and both of that pair's probes still
   * pass.
   *
   * Stacking itself is `display: block` on the table -- :957-963 inside the 980px
   * block for the fee register, :1225-1229 inside the 720px block for the day book
   * -- against the UA's `table` above it. That flips on exactly the pixel each
   * register's pair names, for both registers, which is what these cases claim to
   * measure.
   */
  if (geometry === "stacked") {
    expect(dimensions.tableDisplay, `${testContext}: stacked table should lay out as blocks`)
      .toBe("block")
    expect(dimensions.scrollWidth, `${testContext}: stacked table should fit its wrapper`)
      .toBeLessThanOrEqual(dimensions.clientWidth + WIDTH_TOLERANCE_PX)
    return
  }

  expect(dimensions.tableDisplay, `${testContext}: table above its breakpoint should stay a table`)
    .toBe("table")
  expect(dimensions.overflowX, `${testContext}: table wrapper must own horizontal scrolling`)
    .toMatch(/^(auto|scroll)$/u)
  if (geometry === "wrapper-scrolls") {
    expect(dimensions.scrollWidth, `${testContext}: desktop table should overflow only its wrapper`)
      .toBeGreaterThan(dimensions.clientWidth + WIDTH_TOLERANCE_PX)
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

    if (viewport.mode === "web") {
      expect(Math.abs(cards.onboarding.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.attendance.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expectSameRow("sessions", "reports")
      expectSameRow("financials", "announcements")
      expectSameRow("announcements", "members")
      expect(cards.sessions.left).toBeLessThan(cards.reports.left)
      expect(cards.financials.left).toBeLessThan(cards.announcements.left)
      expect(cards.announcements.left).toBeLessThan(cards.members.left)
    } else if (viewport.mode === "tablet") {
      expect(Math.abs(cards.onboarding.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.attendance.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expect(Math.abs(cards.sessions.width - (gridBounds?.width ?? 0))).toBeLessThanOrEqual(2)
      expectSameRow("reports", "financials")
      expectSameRow("announcements", "members")
      expect(cards.reports.left).toBeLessThan(cards.financials.left)
      expect(cards.announcements.left).toBeLessThan(cards.members.left)
    } else {
      const order = [
        "attendance",
        "onboarding",
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

    const attendanceActionWidths = await grid
      .locator('[data-area="attendance"] [role="group"]')
      .evaluateAll((groups) => groups.map((group) => {
        const groupBounds = group.getBoundingClientRect()
        const actions = [...group.querySelectorAll("a")].map((action) => (
          action.getBoundingClientRect()
        ))

        return {
          actionHeights: actions.map((action) => action.height),
          actionWidth: actions[0]?.width ?? 0,
          groupWidth: groupBounds.width,
        }
      }))

    expect(attendanceActionWidths).toHaveLength(2)
    expect(attendanceActionWidths.every(({ actionHeights }) => (
      actionHeights.every((height) => height >= 50)
    ))).toBe(true)
    if (viewport.mode === "mobile") {
      for (const { actionWidth, groupWidth } of attendanceActionWidths) {
        expect(Math.abs(actionWidth - groupWidth)).toBeLessThanOrEqual(2)
      }
    } else {
      expect(Math.abs(
        attendanceActionWidths[0].actionWidth - attendanceActionWidths[1].actionWidth,
      )).toBeLessThanOrEqual(2)
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

/*
 * Un-quarantined from G-27, and the caption was only the first of two things
 * wrong with it. Both cases resolved the register through getByRole("table", {
 * name: "Player fee records" }), a caption f3ca2e1 replaced with
 * `${formatPeriod(period)} monthly fee records`, so the locator had matched
 * nothing since and both failed on their first assertion. Substituting the
 * current caption looks like the whole repair and is not: neither case had ever
 * run against this tree, and the geometry underneath asked both registers for
 * horizontal scrolling at 844px and 932px when the fee register has stacked at
 * every width at or below 980px since the same commit. The expectation now comes
 * from `geometryAt`, against the per-register breakpoints recorded beside the
 * routes above.
 *
 * Still unproven, and it is the reason this comment stays: none of the numbers
 * below have been measured in a browser. What is checked is that each assertion
 * matches the media queries and the shell width the tree actually declares.
 */
test("Fee Records tables own landscape overflow without widening the page", async ({ page }) => {
  await loginAsCoach(page)

  for (const viewport of landscapeViewports) {
    for (const recordView of feeRecordRoutes) {
      const testContext = `${recordView.tableName} at ${viewport.width}x${viewport.height}`
      await page.setViewportSize(viewport)
      await page.goto(recordView.route, { waitUntil: "domcontentloaded" })
      await settleResponsiveLayout(page)

      await expectContainedScrollableTable({
        geometry: geometryAt(recordView, viewport.width),
        page,
        tableName: recordView.tableName,
        testContext,
      })
      await expectNoDocumentOverflow(page, testContext)
    }
  }
})

/*
 * Un-quarantined with the case above and renamed with it. "720px" named the
 * generic records table's breakpoint and was applied to the fee register, which
 * stacks at 980px instead; asserting local scrolling at 721px asked the fee
 * register for a shape it has not had since f3ca2e1. Each register is now walked
 * across its own breakpoint -- 720/721 for the day book, 980/981 for the fee
 * register -- so the pair that was measured against the wrong table becomes two
 * pairs, each measured against the table whose breakpoint it names.
 */
test("Fee Records preserves each register's stacking breakpoint and desktop layout", async ({ page }) => {
  await loginAsCoach(page)

  for (const recordView of feeRecordRoutes) {
    for (const width of [recordView.stacksAtOrBelow, recordView.stacksAtOrBelow + 1]) {
      const testContext = `${recordView.tableName} at ${width}px`
      await page.setViewportSize({ height: 900, width })
      await page.goto(recordView.route, { waitUntil: "domcontentloaded" })
      await settleResponsiveLayout(page)
      await expectContainedScrollableTable({
        geometry: geometryAt(recordView, width),
        page,
        tableName: recordView.tableName,
        testContext,
      })
      await expectNoDocumentOverflow(page, testContext)
    }

    await page.setViewportSize({ height: 900, width: 1440 })
    await page.goto(recordView.route, { waitUntil: "domcontentloaded" })
    await settleResponsiveLayout(page)
    await expect(page.getByRole("table", { name: recordView.tableName })).toBeVisible()
    await expectNoDocumentOverflow(page, `${recordView.tableName} at 1440px`)
  }
})
