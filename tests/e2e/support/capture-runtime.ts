import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Locator,
  Page,
  Request,
  Response,
} from "@playwright/test"

import {
  academyIdForActor,
  captureSettings,
  resolveCaptureRoute,
  storageStateForActor,
} from "./capture-settings"
import {
  artifactPath,
  screenshotFilePath,
} from "./capture-report"
import type {
  CaptureAction,
  CaptureActor,
  CaptureArtifact,
  CaptureDefinition,
  CaptureEvidence,
  CaptureViewport,
  ConsoleEvidence,
  DomEvidence,
  NetworkEvidence,
  PerformanceEvidence,
} from "./capture-types"

const evidenceStyle = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`

function isoNow() {
  return new Date().toISOString()
}

function sanitizedUrl(source: string) {
  if (source.startsWith("data:")) return "data:<redacted>"
  try {
    const url = new URL(source)
    for (const key of [...url.searchParams.keys()]) {
      if (/(auth|code|key|session|token)/i.test(key)) url.searchParams.set(key, "<redacted>")
    }
    return url.toString()
  } catch {
    return source
  }
}

function networkEntry(request: Request): NetworkEvidence {
  return {
    method: request.method(),
    resourceType: request.resourceType(),
    timestamp: isoNow(),
    url: sanitizedUrl(request.url()),
  }
}

export class PageEvidenceCollector {
  readonly console: ConsoleEvidence[] = []
  readonly httpErrors: NetworkEvidence[] = []
  readonly network: NetworkEvidence[] = []
  readonly pageErrors: CaptureEvidence["pageErrors"] = []
  readonly requestFailures: NetworkEvidence[] = []
  private pending: Promise<unknown>[] = []

  constructor(private readonly page: Page) {
    page.on("console", this.onConsole)
    page.on("pageerror", this.onPageError)
    page.on("requestfailed", this.onRequestFailed)
    page.on("response", this.onResponse)
  }

  private onConsole = (message: ConsoleMessage) => {
    const location = message.location()
    this.console.push({
      location: location.url ? {
        columnNumber: location.columnNumber,
        lineNumber: location.lineNumber,
        url: sanitizedUrl(location.url),
      } : undefined,
      text: message.text(),
      timestamp: isoNow(),
      type: message.type(),
    })
  }

  private onPageError = (error: Error) => {
    this.pageErrors.push({
      message: error.message,
      stack: error.stack,
      timestamp: isoNow(),
    })
  }

  private onRequestFailed = (request: Request) => {
    const entry = {
      ...networkEntry(request),
      failure: request.failure()?.errorText ?? "Unknown network failure",
    }
    this.requestFailures.push(entry)
    this.network.push(entry)
  }

  private onResponse = (response: Response) => {
    const request = response.request() as Request
    const entry: NetworkEvidence = {
      ...networkEntry(request),
      status: response.status(),
    }
    this.network.push(entry)
    if (response.status() >= 400) this.httpErrors.push(entry)
    const finished = response.finished()
      .then(() => {
        const timing = request.timing()
        if (timing.responseEnd >= 0) {
          entry.durationMs = Math.round(timing.responseEnd * 10) / 10
        }
      })
      .catch(() => undefined)
    this.pending.push(finished)
  }

  async flush() {
    const pending = this.pending
    this.pending = []
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => setTimeout(resolve, 750)),
    ])
  }

  stop() {
    this.page.off("console", this.onConsole)
    this.page.off("pageerror", this.onPageError)
    this.page.off("requestfailed", this.onRequestFailed)
    this.page.off("response", this.onResponse)
  }
}

export async function createActorContext(
  browser: Browser,
  actor: CaptureActor,
  viewport: CaptureViewport,
) {
  const storageState = storageStateForActor(actor)
  const context = await browser.newContext({
    baseURL: captureSettings.baseURL,
    colorScheme: "light",
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    locale: "en-IN",
    reducedMotion: "reduce",
    storageState,
    timezoneId: "Asia/Kolkata",
    viewport: { height: viewport.height, width: viewport.width },
  })
  await context.addInitScript(() => {
    try {
      window.localStorage.removeItem("smba-coach-report-resume-v1")
    } catch {
      // Storage is unavailable on opaque documents such as about:blank.
    }
  })
  return context
}

async function loginWithAcademyId(page: Page, actor: CaptureActor) {
  if (actor === "guest") throw new Error("Guest captures cannot authenticate")
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const expectedPath = actor === "coach" ? "/coach" : "/player"
  if (new URL(page.url()).pathname.startsWith(expectedPath)) return

  await page.getByLabel("Academy ID").fill(academyIdForActor(actor))
  await page.getByRole("button", { name: "Continue" }).click()
  try {
    await page.waitForURL((url) => url.pathname.startsWith(expectedPath), { timeout: 20_000 })
  } catch (error) {
    const alert = await page.getByRole("alert").textContent().catch(() => null)
    throw new Error(
      `Could not authenticate the ${actor} capture account${alert ? `: ${alert.trim()}` : ""}`,
      { cause: error },
    )
  }
}

export async function authenticateAndNavigate(
  page: Page,
  actor: CaptureActor,
  routeTemplate: string,
) {
  const route = resolveCaptureRoute(routeTemplate)
  if (actor === "guest") {
    await page.goto(route, { timeout: 45_000, waitUntil: "domcontentloaded" })
    return route
  }

  if (!storageStateForActor(actor)) await loginWithAcademyId(page, actor)
  await page.goto(route, { timeout: 45_000, waitUntil: "domcontentloaded" })
  const pathname = new URL(page.url()).pathname
  const expectedPrefix = actor === "coach" ? "/coach" : "/player"
  const protectedRoute = route.startsWith("/coach") || route.startsWith("/player")
  if (pathname === "/login") {
    throw new Error(`${actor} authentication is missing or expired; redirected to /login`)
  }
  if (protectedRoute && !pathname.startsWith(expectedPrefix)) {
    throw new Error(`Expected a ${actor} route beginning ${expectedPrefix}, received ${pathname}`)
  }
  return route
}

async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  }))
}

export async function settlePage(page: Page, waitForNetwork = false) {
  const startedAt = Date.now()
  if (waitForNetwork) {
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
  }
  await page.addStyleTag({ content: evidenceStyle }).catch(() => undefined)
  await page.evaluate(async () => {
    const fonts = "fonts" in document ? document.fonts.ready.catch(() => undefined) : Promise.resolve()
    const relevantImages = [...document.images].filter((image) => {
      if (image.loading !== "lazy") return true
      const rect = image.getBoundingClientRect()
      return rect.bottom >= -window.innerHeight && rect.top <= window.innerHeight * 2
    })
    const images = Promise.all(relevantImages.map(async (image) => {
      if (image.complete) return
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true })
        image.addEventListener("error", () => resolve(), { once: true })
        window.setTimeout(resolve, 5_000)
      })
    }))
    await Promise.race([
      Promise.all([fonts, images]),
      new Promise<void>((resolve) => window.setTimeout(resolve, 6_000)),
    ])
  })
  await twoFrames(page)
  return Date.now() - startedAt
}

async function clickRequired(locator: Locator, action: CaptureAction) {
  const target = locator.first()
  await target.waitFor({ state: "visible", timeout: 12_000 }).catch((error) => {
    throw new Error(`Capture action ${action} could not find a visible target`, { cause: error })
  })
  await target.scrollIntoViewIfNeeded()
  await target.click()
}

async function openAttendance(page: Page) {
  await page.locator("#attendance-register").waitFor({ state: "visible", timeout: 12_000 })
}

async function openPublicNavigation(page: Page, action: CaptureAction) {
  const openButton = page.getByRole("button", { name: "Open navigation" })
  if (await openButton.count()) await clickRequired(openButton, action)
  await page.getByRole("navigation", { name: "Mobile navigation" })
    .waitFor({ state: "visible", timeout: 12_000 })
}

async function choosePublicNavigationItem(
  page: Page,
  action: CaptureAction,
  name: string,
) {
  await openPublicNavigation(page, action)
  await clickRequired(
    page.getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name, exact: true }),
    action,
  )
}

async function fillTrialForm(page: Page) {
  await page.getByLabel("Your name").fill("Ananya Sharma")
  await page.getByLabel("Current level").selectOption({ label: "Adult" })
  await page.getByLabel("Preferred schedule").selectOption({ label: "Weekend" })
  await page.getByLabel(/Anything we should know/i).fill(
    "Returning to badminton and looking for a calm weekend assessment.",
  )
  await page.getByRole("checkbox", { name: /Ask the academy to call me back/i }).check()
}

export async function executeCaptureAction(page: Page, action: CaptureAction) {
  const startedAt = Date.now()
  switch (action) {
    case "adjustment-player-selected": {
      const playerSelect = page.locator(".coach-adjustment-field select")
      await playerSelect.waitFor({ state: "visible", timeout: 12_000 })
      const playerIds = await playerSelect.locator("option").evaluateAll((options) => (
        options.map((option) => (option as HTMLOptionElement).value).filter(Boolean)
      ))
      let selected = false
      for (const playerId of playerIds) {
        await playerSelect.selectOption(playerId)
        if (await page.locator(".coach-adjustment-missed-calendar").count()) {
          selected = true
          break
        }
      }
      if (!selected) throw new Error(`Capture action ${action} found no player with a saved absence`)
      break
    }
    case "adjustment-source-selected":
      await clickRequired(
        page.locator(".coach-adjustment-missed-calendar-grid")
          .getByRole("button", { name: /^Select .*missed session/i }),
        action,
      )
      break
    case "attendance-weekend-adult":
      await openAttendance(page)
      await clickRequired(page.getByRole("button", { name: "Weekend", exact: true }), action)
      await clickRequired(page.getByRole("button", { name: "Adult", exact: true }), action)
      break
    case "attendance-session-selected":
      await clickRequired(
        page.locator(".attendance-occurrence-list > button.is-available"),
        action,
      )
      break
    case "attendance-year-start":
      await openAttendance(page)
      await clickRequired(
        page.locator('[aria-label="Choose attendance year"] button').first(),
        action,
      )
      if (await page.locator(".coach-register-scroll").count()) {
        await page.locator(".coach-register-scroll").evaluate((element) => {
          element.scrollLeft = 0
        })
      }
      break
    case "calendar-month":
      await clickRequired(
        page.getByRole("button", { name: /Back to month/i }),
        action,
      )
      break
    case "calendar-replacement-open":
      await clickRequired(
        page.locator('.coach-day-session > button[aria-expanded="false"]'),
        action,
      )
      await clickRequired(
        page.locator(".coach-occurrence-detail summary").filter({ hasText: "Replace session" }),
        action,
      )
      break
    case "calendar-session-open":
      await clickRequired(
        page.locator('.coach-day-session > button[aria-expanded="false"]'),
        action,
      )
      break
    case "financial-player-record-open": {
      await clickRequired(
        page.getByRole("link", { name: "View record", exact: true }).first(),
        action,
      )
      await page.waitForURL((url) => (
        url.pathname.startsWith("/coach/financials/players/")
        && url.searchParams.has("period")
      ), { timeout: 12_000 })
      await page.getByRole("heading", { name: "Player fee record", exact: true })
        .waitFor({ state: "visible", timeout: 12_000 })
      break
    }
    case "login-account-not-found":
      await page.getByLabel("Academy ID").fill("SMBA#9999")
      await clickRequired(page.getByRole("button", { name: "Continue" }), action)
      await page.getByRole("alert").waitFor({ state: "visible", timeout: 12_000 })
      break
    case "login-format-error":
      await page.getByLabel("Academy ID").fill("SMBA-12")
      await clickRequired(page.getByRole("button", { name: "Continue" }), action)
      await page.getByRole("alert").waitFor({ state: "visible", timeout: 12_000 })
      break
    case "member-contact-reveal":
      await clickRequired(page.locator(".coach-member-row-action button"), action)
      await clickRequired(
        page.getByRole("button", { name: /^Reveal primary contact for /i }),
        action,
      )
      break
    case "member-details-open":
      await clickRequired(page.locator(".coach-member-row-action button"), action)
      break
    case "member-edit-open":
      await clickRequired(page.locator(".coach-member-row-action button"), action)
      await clickRequired(page.getByRole("button", { name: "Edit member" }), action)
      await page.locator("form.coach-member-edit-form").waitFor({ state: "visible", timeout: 12_000 })
      break
    case "member-filter-applied":
      await clickRequired(page.getByRole("button", { name: /Filters/i }), action)
      await page.locator("#coach-member-filters").getByLabel("Level").selectOption("Adult")
      await page.locator("#coach-member-filters").getByLabel("Status").selectOption("active")
      await page.locator("#coach-member-filters").getByLabel("Batch").selectOption("Weekend")
      break
    case "member-filters-open":
      await clickRequired(page.getByRole("button", { name: /Filters/i }), action)
      break
    case "profile-menu-open":
      await clickRequired(
        page.getByRole("button", { name: /Open account menu for/i }),
        action,
      )
      break
    case "public-fee-weekday-advanced":
      await clickRequired(
        page.locator(".fee-explorer .fee-field").filter({ hasText: "Program" })
          .getByRole("button", { name: "Advanced", exact: true }),
        action,
      )
      break
    case "public-fee-weekday-standard":
      await clickRequired(
        page.locator(".fee-explorer .fee-field").filter({ hasText: "Program" })
          .getByRole("button", { name: "Intermediate", exact: true }),
        action,
      )
      await clickRequired(
        page.locator(".fee-explorer .fee-field").filter({ hasText: "Frequency" })
          .getByRole("button", { name: "4 days", exact: true }),
        action,
      )
      break
    case "public-fee-weekend":
      await clickRequired(
        page.locator(".fee-explorer").getByRole("button", { name: /Weekend/i }).first(),
        action,
      )
      await clickRequired(
        page.locator(".fee-explorer .fee-field").filter({ hasText: "Program" })
          .getByRole("button", { name: "Adult", exact: true }),
        action,
      )
      break
    case "public-mobile-menu-open":
      await openPublicNavigation(page, action)
      break
    case "public-nav-academy":
      await choosePublicNavigationItem(page, action, "Academy")
      break
    case "public-nav-contact":
      await choosePublicNavigationItem(page, action, "Contact")
      break
    case "public-nav-programs":
      await choosePublicNavigationItem(page, action, "Programs")
      break
    case "public-nav-trial":
      await openPublicNavigation(page, action)
      await clickRequired(
        page.getByRole("navigation", { name: "Mobile navigation" })
          .getByRole("link", { name: "Book a free trial", exact: true }),
        action,
      )
      break
    case "public-nav-why":
      await choosePublicNavigationItem(page, action, "Why SMBA")
      break
    case "public-trial-filled":
      await fillTrialForm(page)
      break
    case "public-trial-popup-blocked":
      await fillTrialForm(page)
      await page.evaluate(() => {
        window.open = () => null
      })
      await clickRequired(page.getByRole("button", { name: /Continue on WhatsApp/i }), action)
      await page.locator(".whatsapp-status-blocked").waitFor({ state: "visible", timeout: 12_000 })
      break
    case "register-validation-error":
      await clickRequired(page.getByRole("button", { name: "Request registration" }), action)
      await page.getByRole("alert").waitFor({ state: "visible", timeout: 12_000 })
      break
    case "report-checklist-collapse": {
      const closeButton = page.getByRole("button", { name: "Hide checklist" })
      if (await closeButton.count()) {
        await clickRequired(closeButton, action)
      } else {
        await page.getByRole("button", { name: "Change player" })
          .waitFor({ state: "visible", timeout: 12_000 })
      }
      break
    }
    case "report-preview-open":
      await clickRequired(page.getByRole("button", { name: "Preview", exact: true }), action)
      await page.getByRole("dialog").waitFor({ state: "visible", timeout: 12_000 })
      break

    case "coach-published-report-open":
      await clickRequired(
        page.locator(".coach-published-report-actions a").first(),
        action,
      )
      await page.waitForURL(/\/coach\/reports\/publications\//u)
      break
    case "schedule-create-weekend":
      await page.locator(".coach-series-form").getByLabel("Programme").selectOption("Adult")
      await page.locator(".coach-series-form").getByLabel("Batch").selectOption("Weekend")
      await page.locator(".coach-series-form").getByLabel("Start time").fill("08:00")
      await page.locator(".coach-series-form").getByLabel("Duration").selectOption("120")
      break
    case "schedule-programmes-collapse": {
      const toggles = page.locator(".coach-schedule-programme-toggle-heading button")
      const count = await toggles.count()
      if (!count) throw new Error(`Capture action ${action} found no programme groups`)
      for (let index = 0; index < count; index += 1) {
        const toggle = toggles.nth(index)
        if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click()
      }
      break
    }
    case "schedule-roster-open": {
      const programme = page.locator(".coach-schedule-programme-toggle-heading button").first()
      await programme.waitFor({ state: "visible", timeout: 12_000 })
      if (await programme.getAttribute("aria-expanded") !== "true") await programme.click()
      const roster = page.locator(".coach-series-roster-card > button").first()
      await roster.waitFor({ state: "visible", timeout: 12_000 })
      if (await roster.getAttribute("aria-expanded") !== "true") await roster.click()
      break
    }
    case "schedule-roster-player-selected": {
      const programmes = page.locator(".coach-schedule-programme-toggle-heading button")
      let selected = false
      for (let programmeIndex = 0; programmeIndex < await programmes.count() && !selected; programmeIndex += 1) {
        const programme = programmes.nth(programmeIndex)
        if (await programme.getAttribute("aria-expanded") !== "true") await programme.click()
        const group = programme.locator("xpath=ancestor::section[1]")
        const schedules = group.locator(".coach-series-roster-card > button")
        for (let scheduleIndex = 0; scheduleIndex < await schedules.count(); scheduleIndex += 1) {
          const schedule = schedules.nth(scheduleIndex)
          if (await schedule.getAttribute("aria-expanded") !== "true") await schedule.click()
          const select = group.locator(".coach-roster-assign select").first()
          const option = select.locator('option[value]:not([value=""])').first()
          const playerId = await option.getAttribute("value")
          if (!playerId) continue
          await select.selectOption(playerId)
          selected = true
          break
        }
      }
      if (!selected) throw new Error(`Capture action ${action} found no eligible player`)
      break
    }
    case "student-report-open":
      await clickRequired(page.locator(".report-month-trigger").first(), action)
      break
  }
  await settlePage(page)
  return Date.now() - startedAt
}

async function warmFullPage(page: Page, viewport: CaptureViewport) {
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  const step = Math.max(240, Math.floor(viewport.height * 0.8))
  const maximum = Math.min(scrollHeight, step * captureSettings.maxSegments)
  for (let scrollY = 0; scrollY < maximum; scrollY += step) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY)
    await twoFrames(page)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await twoFrames(page)
}

function segmentPositions(scrollHeight: number, clientHeight: number) {
  const last = Math.max(0, scrollHeight - clientHeight)
  const step = Math.max(1, Math.floor(clientHeight * 0.82))
  const positions: number[] = []
  for (let scrollY = 0; scrollY < last; scrollY += step) positions.push(scrollY)
  positions.push(last)
  const unique = [...new Set(positions)]
  if (unique.length <= captureSettings.maxSegments) return unique
  if (captureSettings.maxSegments === 1) return [0]
  return Array.from({ length: captureSettings.maxSegments }, (_, index) => (
    unique[Math.round((index * (unique.length - 1)) / (captureSettings.maxSegments - 1))]
  ))
}

export async function captureScreenshots(
  page: Page,
  definition: CaptureDefinition,
  viewport: CaptureViewport,
  captureKey: string,
) {
  const startedAt = Date.now()
  const artifacts: CaptureArtifact[] = []
  if (!definition.viewportOnly) await warmFullPage(page, viewport)

  if (definition.focusSelector) {
    const focusTarget = page.locator(definition.focusSelector).first()
    await focusTarget.waitFor({ state: "visible", timeout: 12_000 })
    await focusTarget.evaluate((element) => {
      element.scrollIntoView({ behavior: "auto", block: "start" })
    })
    await twoFrames(page)
  }

  const viewportScrollY = await page.evaluate(() => Math.round(window.scrollY))

  const viewportPath = screenshotFilePath(`${captureKey}-viewport.png`)
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    path: viewportPath,
  })
  artifacts.push({ kind: "viewport", path: artifactPath(viewportPath), scrollY: viewportScrollY })

  if (definition.viewportOnly) {
    return { artifacts, captureMs: Date.now() - startedAt }
  }

  const dimensions = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }))
  const segmented = definition.segmentPolicy === "always"
    || dimensions.scrollHeight > captureSettings.maxFullPageHeight
  if (!segmented) {
    const fullPagePath = screenshotFilePath(`${captureKey}-full.png`)
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: fullPagePath,
    })
    artifacts.push({ kind: "full-page", path: artifactPath(fullPagePath) })
  } else {
    const positions = segmentPositions(dimensions.scrollHeight, dimensions.clientHeight)
    for (let index = 0; index < positions.length; index += 1) {
      const requestedY = positions[index]
      await page.evaluate((y) => window.scrollTo(0, y), requestedY)
      await twoFrames(page)
      const actualY = await page.evaluate(() => Math.round(window.scrollY))
      const segmentPath = screenshotFilePath(
        `${captureKey}-segment-${String(index + 1).padStart(3, "0")}-y${String(actualY).padStart(5, "0")}.png`,
      )
      await page.screenshot({
        animations: "disabled",
        caret: "hide",
        path: segmentPath,
      })
      artifacts.push({ kind: "segment", path: artifactPath(segmentPath), scrollY: actualY })
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await twoFrames(page)
  }

  return { artifacts, captureMs: Date.now() - startedAt }
}

export async function captureFailureScreenshot(page: Page, captureKey: string) {
  const filePath = screenshotFilePath(`${captureKey}-failure.png`)
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: filePath,
  })
  return { kind: "viewport", path: artifactPath(filePath), scrollY: 0 } as const
}

export async function collectDomEvidence(page: Page): Promise<DomEvidence> {
  return page.evaluate(() => {
    const root = document.documentElement
    const selectorPath = (element: Element) => {
      const segments: string[] = []
      let current: Element | null = element
      while (current && current !== document.body && segments.length < 6) {
        let segment = current.tagName.toLowerCase()
        if (current.id) {
          segment += `#${current.id}`
          segments.unshift(segment)
          break
        }
        const classes = typeof current.className === "string"
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
          : []
        if (classes.length) segment += `.${classes.join(".")}`
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter((sibling) => sibling.tagName === current?.tagName)
          : []
        if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`
        segments.unshift(segment)
        current = current.parentElement
      }
      return segments.join(" > ")
    }
    const overflowElements = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const overflowX = style.overflowX
        return {
          className: element.className,
          clientWidth: element.clientWidth,
          id: element.id,
          intentional: ["auto", "clip", "hidden", "scroll"].includes(overflowX),
          overflowX,
          path: selectorPath(element),
          rect: { left: rect.left, right: rect.right, width: rect.width },
          scrollWidth: element.scrollWidth,
          tagName: element.tagName.toLowerCase(),
        }
      })
      .filter((entry) => entry.rect.width > 0)
      .sort((first, second) => (second.scrollWidth - second.clientWidth) - (first.scrollWidth - first.clientWidth))
      .slice(0, 100)

    return {
      activeElement: document.activeElement ? selectorPath(document.activeElement) : null,
      ariaExpanded: [...document.querySelectorAll<HTMLElement>("[aria-expanded]")].map((element) => ({
        expanded: element.getAttribute("aria-expanded"),
        text: (element.innerText || element.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 180),
      })),
      bodyTextLength: document.body.innerText.length,
      counts: {
        buttons: document.querySelectorAll("button").length,
        forms: document.querySelectorAll("form").length,
        headings: document.querySelectorAll("h1, h2, h3, h4, h5, h6").length,
        images: document.images.length,
        incompleteImages: [...document.images].filter((image) => {
          if (image.complete && image.naturalWidth > 0) return false
          if (image.loading !== "lazy") return true
          const rect = image.getBoundingClientRect()
          return rect.bottom >= -window.innerHeight && rect.top <= window.innerHeight * 2
        }).length,
        inputs: document.querySelectorAll("input, select, textarea").length,
        landmarks: document.querySelectorAll("header, main, nav, aside, footer, [role='main'], [role='navigation'], [role='complementary'], [role='contentinfo']").length,
        links: document.querySelectorAll("a[href]").length,
      },
      document: {
        clientHeight: root.clientHeight,
        clientWidth: root.clientWidth,
        readyState: document.readyState,
        scrollHeight: root.scrollHeight,
        scrollWidth: root.scrollWidth,
      },
      fontsStatus: "fonts" in document ? document.fonts.status : "unsupported",
      headings: [...document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: heading.innerText.trim().replace(/\s+/g, " ").slice(0, 240),
      })),
      overflow: {
        elements: overflowElements,
        pageOverflow: root.scrollWidth > root.clientWidth + 1,
      },
      title: document.title,
      url: window.location.href,
    }
  })
}

export async function collectPerformanceEvidence(
  page: Page,
  captureMs: number,
  settleMs: number,
  totalMs: number,
): Promise<PerformanceEvidence> {
  const browserPerformance = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    return {
      navigation: navigation ? {
        connectEnd: navigation.connectEnd,
        connectStart: navigation.connectStart,
        decodedBodySize: navigation.decodedBodySize,
        domComplete: navigation.domComplete,
        domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
        duration: navigation.duration,
        encodedBodySize: navigation.encodedBodySize,
        fetchStart: navigation.fetchStart,
        loadEventEnd: navigation.loadEventEnd,
        name: navigation.name,
        responseEnd: navigation.responseEnd,
        responseStart: navigation.responseStart,
        transferSize: navigation.transferSize,
        type: navigation.type,
      } : null,
      resources: {
        count: resources.length,
        durationMs: resources.reduce((total, resource) => total + resource.duration, 0),
        transferSize: resources.reduce((total, resource) => total + resource.transferSize, 0),
      },
    }
  })
  return {
    captureMs,
    navigation: browserPerformance.navigation,
    resources: {
      count: browserPerformance.resources.count,
      durationMs: Math.round(browserPerformance.resources.durationMs * 10) / 10,
      transferSize: browserPerformance.resources.transferSize,
    },
    settleMs,
    totalMs,
  }
}

export function evidenceViolations(evidence: CaptureEvidence) {
  const violations: string[] = []
  if (evidence.dom?.overflow.pageOverflow) {
    violations.push(
      `horizontal document overflow: ${evidence.dom.document.scrollWidth}px content in ${evidence.dom.document.clientWidth}px viewport`,
    )
  }
  for (const pageError of evidence.pageErrors) {
    violations.push(`page error: ${pageError.message}`)
  }
  for (const message of evidence.console.filter((entry) => entry.type === "error")) {
    violations.push(`console error: ${message.text}`)
  }
  for (const request of evidence.requestFailures) {
    if (request.failure?.includes("ERR_ABORTED")) continue
    violations.push(`network failure: ${request.method} ${request.url} (${request.failure})`)
  }
  for (const response of evidence.httpErrors) {
    violations.push(`HTTP ${response.status}: ${response.method} ${response.url}`)
  }
  if ((evidence.dom?.counts.incompleteImages ?? 0) > 0) {
    violations.push(`${evidence.dom?.counts.incompleteImages} image(s) failed to load`)
  }
  return [...new Set(violations)]
}

export async function closeContext(context: BrowserContext | undefined) {
  await context?.close().catch(() => undefined)
}
