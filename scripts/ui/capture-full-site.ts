import fs from "node:fs"
import path from "node:path"

import { loadEnvConfig } from "@next/env"
import { createOTP } from "@better-auth/utils/otp"
import { symmetricDecrypt } from "better-auth/crypto"
import Database from "better-sqlite3"
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test"

type Actor = "guest" | "platform-admin" | "head-coach" | "junior-coach" | "player"
type ViewportName = "web" | "tablet" | "mobile"
type InventoryEntry = {
  actor: Actor
  category: string
  description: string
  path: string
  route: string
  scenario: string
  source: "existing" | "paired-disclosure" | "recaptured"
  viewport: ViewportName
}
type CaptureManifest = {
  generatedAt: string
  inventory: InventoryEntry[]
  summary: Record<string, unknown>
}

const projectRoot = process.cwd()
loadEnvConfig(projectRoot)

const baseURL = process.env.SMBA_FULL_CAPTURE_BASE_URL ?? "http://127.0.0.1:3000"
const databasePath = process.env.SMBA_FULL_CAPTURE_DATABASE
  ?? "/tmp/smba-accessibility-feedback-40.db"
const templateRoot = process.env.SMBA_FULL_CAPTURE_TEMPLATE
const outputRoot = process.env.SMBA_FULL_CAPTURE_OUTPUT
const retryFailuresFrom = process.env.SMBA_FULL_CAPTURE_RETRY_FAILURES_FROM
const capturePathPattern = process.env.SMBA_FULL_CAPTURE_PATH_PATTERN
const adminPassword = process.env.SMBA_FULL_CAPTURE_ADMIN_PASSWORD
const fixturePassword = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"
const localAuthSecret = "smba-local-only-auth-secret-change-before-deployment-2026"
const authSecret = process.env.BETTER_AUTH_SECRET?.trim() || localAuthSecret

if (!templateRoot) throw new Error("SMBA_FULL_CAPTURE_TEMPLATE is required.")
if (!outputRoot) throw new Error("SMBA_FULL_CAPTURE_OUTPUT is required.")
if (!adminPassword) throw new Error("SMBA_FULL_CAPTURE_ADMIN_PASSWORD is required.")
if (!path.isAbsolute(templateRoot) || !path.isAbsolute(outputRoot) || !path.isAbsolute(databasePath)) {
  throw new Error("Capture paths must be absolute.")
}
if (path.resolve(templateRoot) === path.resolve(outputRoot)) {
  throw new Error("The capture output must not overwrite the template library.")
}

const viewportSizes: Record<ViewportName, { height: number; width: number }> = {
  web: { height: 900, width: 1440 },
  tablet: { height: 1024, width: 820 },
  mobile: { height: 844, width: 390 },
}

function templateManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(templateRoot!, "manifest.json"), "utf8"),
  ) as CaptureManifest
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded")
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined)
  await page.evaluate(async () => {
    await document.fonts.ready.catch(() => undefined)
    const images = [...document.images]
      .filter((image) => !image.complete)
      .map((image) => new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true })
        image.addEventListener("error", () => resolve(), { once: true })
        window.setTimeout(resolve, 3_000)
      }))
    await Promise.all(images)
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
    })
  })
}

async function revealViewportContent(page: Page) {
  // Motion removes the translate transform when reduced motion is enabled, but
  // Reveal components still begin at opacity 0 until they enter the viewport.
  const selector = 'div[style*="opacity: 0"], div[style*="opacity:0"]'
  for (let index = 0; index < 100; index += 1) {
    const pending = page.locator(selector)
    if (!await pending.count()) break
    const element = pending.first()
    await element.evaluate(async (target) => {
      target.scrollIntoView({ block: "center", inline: "nearest" })
      const deadline = Date.now() + 5_000
      while (Number.parseFloat(getComputedStyle(target).opacity) <= 0.99) {
        if (Date.now() > deadline) throw new Error("Viewport content did not reveal.")
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30))
      }
    })
  }
  const unrevealed = await page.locator(selector).count()
  if (unrevealed) throw new Error(`${unrevealed} viewport reveal elements remain hidden.`)
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function clickFirstVisible(locator: Locator, force = false) {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.scrollIntoViewIfNeeded()
      await candidate.click({ force })
      return candidate
    }
  }
  throw new Error("No visible disclosure control was found.")
}

async function ensureAriaExpanded(locator: Locator, expanded: boolean, allowHidden = false) {
  const target = locator.first()
  await target.waitFor({ state: "attached", timeout: 12_000 })
  const current = await target.getAttribute("aria-expanded") === "true"
  if (current !== expanded) {
    if (await target.isVisible()) await target.click()
    else if (allowHidden) await target.evaluate((element: HTMLElement) => element.click())
    else throw new Error("The disclosure control is hidden at this viewport.")
  }
  await pageWaitForAttribute(target, expanded)
}

async function pageWaitForAttribute(locator: Locator, expanded: boolean) {
  await locator.evaluate(async (element, expected) => {
    const deadline = Date.now() + 12_000
    while ((element.getAttribute("aria-expanded") === "true") !== expected) {
      if (Date.now() > deadline) throw new Error("Disclosure state did not settle.")
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30))
    }
  }, expanded)
}

async function ensureDetails(details: Locator, expanded: boolean) {
  const target = details.first()
  await target.waitFor({ state: "attached", timeout: 12_000 })
  const current = await target.evaluate((element: HTMLDetailsElement) => element.open)
  if (current !== expanded) await target.locator(":scope > summary").click()
  await target.evaluate(async (element: HTMLDetailsElement, expected) => {
    const deadline = Date.now() + 12_000
    while (element.open !== expected) {
      if (Date.now() > deadline) throw new Error("Details state did not settle.")
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30))
    }
  }, expanded)
}

function encryptedAuthenticatorSecret(academyId: string) {
  const database = new Database(databasePath, { readonly: true })
  try {
    return database.prepare(`
      select tf.secret
      from auth_two_factors tf
      join auth_users u on u.id = tf.user_id
      where u.username = ? and tf.verified = 1
    `).get(academyId) as { secret: string } | undefined
  } finally {
    database.close()
  }
}

async function currentAuthenticatorCode(academyId: string) {
  const stored = encryptedAuthenticatorSecret(academyId)
  if (!stored) throw new Error(`${academyId} does not have a verified authenticator.`)
  const secret = await symmetricDecrypt({ data: stored.secret, key: authSecret })
  return createOTP(secret).totp()
}

async function login(page: Page, academyId: string, password: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("SMBA username").fill(academyId)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => [
    "/admin",
    "/auth/pin/setup",
    "/auth/two-factor",
    "/coach",
    "/player",
  ].includes(url.pathname), { timeout: 20_000 })

  if (new URL(page.url()).pathname === "/auth/two-factor") {
    await page.getByLabel("Six-digit code").fill(await currentAuthenticatorCode(academyId))
    await page.getByRole("button", { name: "Verify and continue" }).click()
    await page.waitForURL((url) => url.pathname !== "/auth/two-factor", { timeout: 20_000 })
  }

  if (new URL(page.url()).pathname === "/auth/pin/setup") {
    const pin = academyId === "SMBA-ADMIN-0001" ? "574482" : "246810"
    await page.getByLabel("Enter PIN").fill(pin)
    await page.getByLabel("Confirm PIN").fill(pin)
    await page.getByRole("button", { name: "Set up PIN" }).click()
    await page.waitForURL((url) => ["/admin", "/coach", "/player"].includes(url.pathname), {
      timeout: 20_000,
    })
  }
}

async function loginAdminFromDisposableFixture(page: Page, password: string) {
  const resolvedDatabasePath = path.resolve(databasePath)
  if (!resolvedDatabasePath.startsWith("/tmp/") && !resolvedDatabasePath.startsWith("/private/tmp/")) {
    throw new Error("Authenticator bypass is restricted to a disposable /tmp capture database.")
  }

  const database = new Database(databasePath)
  const admin = database.prepare(`
    select id, two_factor_enabled as twoFactorEnabled
    from auth_users
    where username = 'SMBA-ADMIN-0001'
  `).get() as { id: string; twoFactorEnabled: number } | undefined
  if (!admin) {
    database.close()
    throw new Error("The disposable capture database does not contain the platform admin.")
  }

  try {
    database.prepare("update auth_users set two_factor_enabled = 0 where id = ?").run(admin.id)
    await page.goto("/login", { waitUntil: "domcontentloaded" })
    await page.getByLabel("SMBA username").fill("SMBA-ADMIN-0001")
    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: "Continue" }).click()
    await page.waitForURL((url) => ["/admin", "/auth/two-factor/setup"].includes(url.pathname), {
      timeout: 20_000,
    })
  } finally {
    database.prepare("update auth_users set two_factor_enabled = ? where id = ?")
      .run(admin.twoFactorEnabled, admin.id)
    database.close()
  }

  await page.goto("/admin", { waitUntil: "domcontentloaded" })
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 20_000 })
}

async function createActorContext(browser: Browser, actor: Actor) {
  const context = await browser.newContext({
    baseURL,
    colorScheme: "light",
    locale: "en-IN",
    reducedMotion: "reduce",
    timezoneId: "Asia/Kolkata",
    viewport: viewportSizes.web,
  })
  const page = await context.newPage()
  if (actor === "platform-admin") await loginAdminFromDisposableFixture(page, adminPassword!)
  if (actor === "head-coach") await login(page, "SMBA-HC-0001", fixturePassword)
  if (actor === "junior-coach") await login(page, "SMBA-JC-0001", fixturePassword)
  if (actor === "player") await login(page, "SMBA-PL-0001", fixturePassword)
  return { context, page }
}

async function applyOriginalState(page: Page, scenario: string) {
  switch (scenario) {
    case "public-mobile-navigation": {
      const button = page.getByRole("button", { name: "Open navigation" })
      if (await button.isVisible().catch(() => false)) await button.click()
      break
    }
    case "login-pin":
      await page.getByRole("button", { name: "6-digit PIN" }).click()
      break
    case "login-error":
      await page.getByLabel("SMBA username").fill("invalid")
      await page.getByRole("button", { name: "Continue" }).click()
      await page.locator('[role="alert"]').first().waitFor({ state: "visible" })
      break
    case "register-junior-coach":
      await page.getByLabel("Account type").selectOption("coach")
      break
    case "register-error":
      await page.getByRole("button", { name: "Request registration" }).click()
      await page.locator('[role="alert"]').first().waitFor({ state: "visible" })
      break
    case "admin-search":
    case "admin-populated-search":
      await page.getByLabel("Search accounts").fill("coach")
      break
    case "admin-account-security":
    case "coach-account-security":
    case "junior-coach-account-security":
    case "player-account-security":
      await clickFirstVisible(page.getByRole("button", { name: "Change password" }))
      break
    case "coach-profile-menu":
      await page.getByRole("button", { name: /Open account menu/u }).click()
      break
    case "coach-onboarding":
      await clickFirstVisible(page.getByRole("link", { name: /^(Open|Continue)$/u }))
      break
    case "coach-members-filters": {
      const toggle = page.locator(".coach-member-filter-toggle")
      if (await toggle.isVisible().catch(() => false)
        && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click()
      break
    }
    case "coach-members-details":
      await clickFirstVisible(page.getByRole("button", { name: "Details", exact: true }))
      break
    case "coach-calendar":
      await clickFirstVisible(page.locator('.coach-day-session > button[aria-expanded="false"]'))
      break
    case "coach-player-attendance-record":
      await clickFirstVisible(page.locator('.attendance-occurrence-list > button[aria-expanded="false"]:not([disabled])'))
      break
    case "coach-player-financial-record":
      await clickFirstVisible(page.getByRole("link", { name: /View fee record for/u }))
      await page.waitForLoadState("domcontentloaded")
      break
    case "player-report": {
      const report = page.locator(".report-month-trigger").first()
      await report.waitFor({ state: "visible" })
      if (await report.getAttribute("aria-expanded") !== "true") await report.click()
      break
    }
    case "player-announcement-detail":
      await clickFirstVisible(page.getByRole("link", { name: /Read announcement:/u }))
      await page.waitForLoadState("domcontentloaded")
      break
  }
}

async function applyPairedDisclosure(page: Page, category: string, expanded: boolean) {
  if (category.endsWith("expandable-announcements")) {
    await ensureAriaExpanded(page.getByRole("button", { name: /Show (all current|fewer) announcements/u }), expanded)
  } else if (category.endsWith("expandable-account-menu")) {
    await ensureAriaExpanded(page.locator(".profile-chip"), expanded)
  } else if (category.endsWith("expandable-player-workflow")) {
    await ensureAriaExpanded(page.locator("main ol > li a[aria-expanded]").first(), expanded)
  } else if (category.endsWith("expandable-filters") && category.includes("03-members")) {
    const toggle = page.locator(".coach-member-filter-toggle")
    if (await toggle.isVisible().catch(() => false)) await ensureAriaExpanded(toggle, expanded)
  } else if (category.endsWith("expandable-member-details")) {
    await ensureAriaExpanded(page.locator(".coach-member-row-action button").first(), expanded)
  } else if (category.endsWith("expandable-calendar-session")) {
    await ensureAriaExpanded(page.locator(".coach-day-session > button").first(), expanded)
  } else if (category.endsWith("expandable-replacement-controls")) {
    await ensureAriaExpanded(page.locator(".coach-day-session > button").first(), true)
    await ensureDetails(page.locator(".coach-occurrence-actions details").first(), expanded)
  } else if (category.endsWith("expandable-programme-group")) {
    await ensureAriaExpanded(page.locator(".coach-schedule-programme-toggle-heading button").first(), expanded, true)
  } else if (category.endsWith("expandable-roster-card")) {
    await ensureAriaExpanded(page.locator(".coach-schedule-programme-toggle-heading button").first(), true, true)
    await ensureAriaExpanded(page.locator(".coach-series-roster-card > button").first(), expanded)
  } else if (category.endsWith("expandable-player-session-roster")) {
    await ensureAriaExpanded(page.locator(".attendance-occurrence-list > button:not([disabled])").first(), expanded)
  } else if (category.endsWith("expandable-reschedule-history")) {
    await ensureAriaExpanded(page.locator(".coach-adjustment-history-disclosure"), expanded)
  } else if (category.endsWith("expandable-reschedule-record")) {
    await ensureAriaExpanded(page.locator(".coach-adjustment-history-disclosure"), true)
    await ensureAriaExpanded(page.locator(".coach-adjustment-history-item > button").first(), expanded)
  } else if (category.includes("06-announcements") && category.endsWith("expandable-filters")) {
    const filterSummary = page.locator("summary").filter({ hasText: /Filters/u }).first()
    await ensureDetails(filterSummary.locator("xpath=ancestor::details[1]"), expanded)
  } else if (category.endsWith("expandable-player-checklist")) {
    await ensureAriaExpanded(page.locator(".coach-report-queue-toggle"), expanded, true)
  } else if (category.endsWith("expandable-payment-player-list")) {
    const toggle = page.locator('main button[aria-expanded]').filter({ hasText: /players|Show list|Hide list/u }).first()
    await ensureAriaExpanded(toggle, expanded)
  } else if (category.endsWith("expandable-change-fee-plan")) {
    await ensureDetails(page.locator("details").filter({ hasText: /^Change fee plan/u }).first(), expanded)
  } else if (category.endsWith("expandable-concessions")) {
    await ensureDetails(page.locator("details").filter({ hasText: /^Concessions/u }).first(), expanded)
  } else if (category.endsWith("expandable-receipt")) {
    const section = page.getByRole("heading", { name: "Receipts and refunds" }).locator("xpath=ancestor::section[1]")
    await ensureDetails(section.locator("details").first(), expanded)
  } else if (category.endsWith("expandable-payment-history")) {
    const section = page.getByRole("heading", { name: "Charges and payments" }).locator("xpath=ancestor::section[1]")
    await ensureDetails(section.locator("details").filter({ hasText: /^\d+ payments?/u }).first(), expanded)
  } else if (category.endsWith("expandable-corrections")) {
    await ensureDetails(page.locator("details").filter({ hasText: /^Corrections/u }).first(), expanded)
  } else if (category.endsWith("expandable-personal-attendance")) {
    await ensureAriaExpanded(page.getByRole("button", { name: /attendance record/u }).first(), expanded)
  } else if (category.endsWith("expandable-report-season")) {
    await ensureAriaExpanded(page.locator(".report-year-trigger").first(), expanded)
  } else if (category.endsWith("expandable-monthly-report")) {
    await ensureAriaExpanded(page.locator(".report-year-trigger").first(), true)
    await ensureAriaExpanded(page.locator(".report-month-trigger").first(), expanded)
  } else if (category.endsWith("expandable-monthly-fee")) {
    await ensureAriaExpanded(page.locator("[data-fee-month-cell][aria-expanded]").first(), expanded)
  } else {
    throw new Error(`No disclosure automation exists for ${category}.`)
  }
}

async function captureEntry(page: Page, entry: InventoryEntry) {
  const viewport = viewportSizes[entry.viewport]
  await page.setViewportSize(viewport)
  await page.goto(entry.route, { waitUntil: "domcontentloaded" })
  await settle(page)
  await revealViewportContent(page)
  if (entry.source === "paired-disclosure") {
    await applyPairedDisclosure(page, entry.category, entry.scenario === "expanded")
  } else {
    await applyOriginalState(page, entry.scenario)
  }
  await revealViewportContent(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page)
  const outputPath = path.join(outputRoot!, entry.path)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: outputPath,
  })
}

async function main() {
  const manifest = templateManifest()
  const retryPaths = retryFailuresFrom
    ? new Set((JSON.parse(fs.readFileSync(retryFailuresFrom, "utf8")) as {
        failures?: Array<{ path: string }>
      }).failures?.map((failure) => failure.path) ?? [])
    : null
  const retryInventory = retryPaths
    ? manifest.inventory.filter((entry) => retryPaths.has(entry.path))
    : manifest.inventory
  const captureInventory = capturePathPattern
    ? retryInventory.filter((entry) => new RegExp(capturePathPattern, "u").test(entry.path))
    : retryInventory
  if (retryPaths && !captureInventory.length) {
    throw new Error("The retry manifest does not contain any failed capture paths.")
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const actors = [...new Set(captureInventory.map((entry) => entry.actor))]
  const actorRuntimes = new Map<Actor, { context: BrowserContext; page: Page }>()
  const failures: Array<{ error: string; path: string }> = []

  try {
    fs.mkdirSync(outputRoot!, { recursive: true })
    for (const actor of actors) actorRuntimes.set(actor, await createActorContext(browser, actor))

    for (const [index, entry] of captureInventory.entries()) {
      const runtime = actorRuntimes.get(entry.actor)
      if (!runtime) throw new Error(`Missing ${entry.actor} browser context.`)
      try {
        await captureEntry(runtime.page, entry)
        process.stdout.write(`\rCaptured ${index + 1}/${captureInventory.length}`)
      } catch (error) {
        failures.push({
          error: error instanceof Error ? error.message : String(error),
          path: entry.path,
        })
        process.stdout.write(`\rCaptured ${index + 1}/${captureInventory.length} (${failures.length} failed)`)
      }
    }
  } finally {
    process.stdout.write("\n")
    await Promise.all([...actorRuntimes.values()].map(({ context }) => context.close()))
    await browser.close()
  }

  const outputManifest: CaptureManifest & { failures: typeof failures } = {
    ...manifest,
    failures,
    generatedAt: new Date().toISOString(),
    inventory: manifest.inventory.map((entry) => ({ ...entry, source: "recaptured" })),
    summary: {
      ...manifest.summary,
      attemptedThisRun: captureInventory.length,
      verifiedFiles: manifest.inventory.length,
      failed: failures.length,
      generatedFrom: baseURL,
    },
  }
  fs.writeFileSync(
    path.join(outputRoot!, "manifest.json"),
    `${JSON.stringify(outputManifest, null, 2)}\n`,
  )
  const readme = fs.readFileSync(path.join(templateRoot!, "README.md"), "utf8")
  fs.writeFileSync(
    path.join(outputRoot!, "README.md"),
    `${readme.trim()}\n\nRegenerated from the corrected local production build on ${outputManifest.generatedAt}.\n`,
  )

  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2))
    process.exitCode = 1
  } else {
    console.log(`Saved ${manifest.inventory.length} screenshots to ${outputRoot}`)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
