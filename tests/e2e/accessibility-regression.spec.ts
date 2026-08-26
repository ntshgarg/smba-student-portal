import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"

import { base32 } from "@better-auth/utils/base32"
import { createOTP } from "@better-auth/utils/otp"
import type { Browser, BrowserContext, CDPSession, Page, TestInfo } from "@playwright/test"
import Database from "better-sqlite3"

import { expect, test } from "./support/failure-evidence"

import {
  accessibilityAdvisoryClockMismatch,
  accessibilityAdvisoryRegressions,
  auditAccessibilityState,
  captureMaskedFailure,
  formatAccessibilityFailures,
  writeAccessibilityResults,
  type AccessibilityFinding,
  type AccessibilityResult,
} from "./support/accessibility-audit"
import {
  assertDisposableAccessibilityDatabase,
  assertPinnedFixtureClock,
  assertServerFixtureClock,
} from "./support/accessibility-environment"
import { executeAccessibilityInteraction } from "./support/accessibility-interactions"
import {
  accessibilityProfiles,
  accessibilityViewports,
  compactAccessibilityViewport,
  statesForProfile,
  viewportsForState,
  type AccessibilityActor,
  type AccessibilityProfile,
  type AccessibilityState,
  type AccessibilityViewport,
} from "./support/accessibility-matrix"
import {
  applyBrowserFontSizePreference,
  auditTextResizeLayout,
  textResizeResultId,
  textResizeStates,
  textResizeStatesForActor,
  TEXT_RESIZE_FONT_SIZES,
} from "./support/accessibility-text-resize"

const profileValue = process.env.SMBA_ACCESSIBILITY_PROFILE ?? "stress"
if (!accessibilityProfiles.includes(profileValue as AccessibilityProfile)) {
  throw new Error(`SMBA_ACCESSIBILITY_PROFILE must be one of: ${accessibilityProfiles.join(", ")}`)
}
const profile = profileValue as AccessibilityProfile
const fixtureClock = assertPinnedFixtureClock(profile, process.env.SMBA_ACCESSIBILITY_CLOCK)
const databasePath = assertDisposableAccessibilityDatabase(process.env.SMBA_ACCESSIBILITY_DB)
const baseURL = process.env.SMBA_ACCESSIBILITY_BASE_URL ?? "http://127.0.0.1:3000"
// Read here, asserted at the very end. A ceiling counted on another day can only
// be repaired by re-recording from this run's own results, so refusing at import
// would withhold the one artifact that fixes it -- the matrix has to run and
// write output/accessibility/<profile>/ before this is allowed to fail the run.
const clockMismatch = accessibilityAdvisoryClockMismatch(profile, fixtureClock)
function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the accessibility regression.`)
  return value
}
const fixturePassword = requiredEnvironmentValue("SMBA_FIXTURE_PASSWORD")
const adminPassword = requiredEnvironmentValue("SMBA_ACCESSIBILITY_ADMIN_PASSWORD")
const accessibilityPin = requiredEnvironmentValue("SMBA_ACCESSIBILITY_PIN")
const outputRoot = path.resolve(
  process.env.SMBA_ACCESSIBILITY_OUTPUT_DIR ?? "output/accessibility",
  profile,
)
const stateFilter = process.env.SMBA_ACCESSIBILITY_STATE?.trim()
const recoverySecret = requiredEnvironmentValue("BETTER_AUTH_SECRET")

function recoveryDigest(label: string, value: string) {
  return createHmac("sha256", recoverySecret)
    .update(`${label}:${value}`)
    .digest("hex")
}

function selectedStatesForProfile(selectedProfile: AccessibilityProfile) {
  const states = statesForProfile(selectedProfile)
  return stateFilter ? states.filter((state) => state.id === stateFilter) : states
}

function executionFinding(error: unknown): AccessibilityFinding {
  return {
    id: "state-execution",
    impact: "critical",
    message: error instanceof Error ? error.message : String(error),
    source: "interaction",
  }
}

function accountIdForAcademyId(database: Database.Database, academyId: string) {
  const row = database.prepare(`
    select account_id as accountId
    from auth_methods
    where identifier = ? and method = 'academy_id' and revoked_at is null
  `).get(academyId) as { accountId: string } | undefined
  if (!row) throw new Error(`Accessibility fixture account ${academyId} was not found.`)
  return row.accountId
}

function insertRecoveryChallenge(academyId: string, email: string) {
  const database = new Database(databasePath)
  try {
    const accountId = accountIdForAcademyId(database, academyId)
    const challengeId = randomUUID()
    const token = randomBytes(32).toString("base64url")
    const now = Date.now()
    const subject = recoveryDigest("recovery-subject", `account:${accountId}`)
    const secretHash = recoveryDigest(
      "email-password_reset",
      `${subject}:${challengeId}:${token}`,
    )
    database.prepare(`
      insert into auth_email_challenges (
        id, account_id, subject_hash, purpose, email, secret_hash,
        failed_attempts, expires_at, claimed_at, created_at, updated_at
      ) values (?, ?, ?, 'password_reset', ?, ?, 0, ?, ?, ?, ?)
    `).run(
      challengeId,
      accountId,
      subject,
      email,
      secretHash,
      now + 20 * 60 * 1000,
      now,
      now,
      now,
    )
    return { accountId, challengeId, token }
  } finally {
    database.close()
  }
}

function deleteRecoveryChallenge(challengeId: string) {
  const database = new Database(databasePath)
  try {
    database.prepare("delete from auth_email_challenges where id = ?").run(challengeId)
  } finally {
    database.close()
  }
}

type RecoveryEmailSnapshot = {
  createdAt: number
  email: string
  updatedAt: number
  verifiedAt: number
}

function prepareHeadCoachRecovery(email: string) {
  const database = new Database(databasePath)
  const accountId = accountIdForAcademyId(database, "SMBA-HC-0001")
  const authUser = database.prepare(`
    select two_factor_enabled as twoFactorEnabled
    from auth_users
    where id = ?
  `).get(accountId) as { twoFactorEnabled: number } | undefined
  if (!authUser) {
    database.close()
    throw new Error("The stress fixture head coach has no authentication user.")
  }
  const originalRecoveryEmail = database.prepare(`
    select
      email,
      verified_at as verifiedAt,
      created_at as createdAt,
      updated_at as updatedAt
    from auth_recovery_emails
    where account_id = ?
  `).get(accountId) as RecoveryEmailSnapshot | undefined
  const now = Date.now()
  database.prepare("update auth_users set two_factor_enabled = 1, updated_at = ? where id = ?")
    .run(now, accountId)
  database.prepare(`
    insert into auth_recovery_emails (account_id, email, verified_at, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(account_id) do update set
      email = excluded.email,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
  `).run(accountId, email, now, originalRecoveryEmail?.createdAt ?? now, now)
  database.close()

  return {
    accountId,
    restore() {
      const restoreDatabase = new Database(databasePath)
      try {
        restoreDatabase.prepare(
          "update auth_users set two_factor_enabled = ?, updated_at = ? where id = ?",
        ).run(authUser.twoFactorEnabled, Date.now(), accountId)
        if (originalRecoveryEmail) {
          restoreDatabase.prepare(`
            update auth_recovery_emails
            set email = ?, verified_at = ?, created_at = ?, updated_at = ?
            where account_id = ?
          `).run(
            originalRecoveryEmail.email,
            originalRecoveryEmail.verifiedAt,
            originalRecoveryEmail.createdAt,
            originalRecoveryEmail.updatedAt,
            accountId,
          )
        } else {
          restoreDatabase.prepare("delete from auth_recovery_emails where account_id = ?")
            .run(accountId)
        }
      } finally {
        restoreDatabase.close()
      }
    },
  }
}

function prepareAuthenticatorRecoveryQueue() {
  const recovery = prepareHeadCoachRecovery("accessibility-recovery@example.test")
  const requestId = randomUUID()
  const database = new Database(databasePath)
  try {
    const now = Date.now()
    database.prepare(`
      insert into auth_authenticator_reset_requests (
        id, account_id, recovery_email, status, requested_at, expires_at,
        created_at, updated_at
      ) values (?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(
      requestId,
      recovery.accountId,
      "accessibility-recovery@example.test",
      now,
      now + 24 * 60 * 60 * 1000,
      now,
      now,
    )
  } catch (error) {
    recovery.restore()
    throw error
  } finally {
    database.close()
  }
  return {
    restore() {
      const cleanup = new Database(databasePath)
      try {
        cleanup.prepare("delete from auth_authenticator_reset_requests where id = ?")
          .run(requestId)
      } finally {
        cleanup.close()
      }
      recovery.restore()
    },
  }
}

async function newContext(browser: Browser) {
  return browser.newContext({
    baseURL,
    colorScheme: "light",
    locale: "en-IN",
    reducedMotion: "reduce",
    timezoneId: "Asia/Kolkata",
    viewport: accessibilityViewports[0],
  })
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded")
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined)
  await page.waitForFunction(() => document.title.trim().length > 0, undefined, {
    timeout: 5_000,
  }).catch(() => undefined)
  await page.evaluate(async () => {
    await document.fonts.ready.catch(() => undefined)
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
    })
  })
}

async function auditCurrentPage({
  actor,
  description,
  id,
  page,
  results,
  route,
  testInfo,
  viewport,
}: {
  actor: AccessibilityActor
  description: string
  id: string
  page: Page
  results: AccessibilityResult[]
  route: string
  testInfo: TestInfo
  viewport: AccessibilityViewport
}) {
  await page.setViewportSize({ height: viewport.height, width: viewport.width })
  // Interactions such as opening a dense row may scroll its trigger into view.
  // Normalize before layout checks so sticky navigation does not make controls
  // that are merely above the viewport look like overlapping content defects.
  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page)
  let result: AccessibilityResult
  try {
    result = await auditAccessibilityState({
      actor,
      description,
      id,
      page,
      profile,
      route,
      viewport,
    })
  } catch (error) {
    result = {
      actor,
      description,
      findings: [executionFinding(error)],
      id,
      profile,
      route,
      title: await page.title().catch(() => ""),
      url: page.url(),
      viewport,
    }
  }
  results.push(result)
  if (result.findings.length) {
    await captureMaskedFailure(page, testInfo, `${id}-${viewport.label}`).catch(() => undefined)
  }
}

async function auditDynamicState({
  actor,
  compact = true,
  description,
  id,
  page,
  results,
  testInfo,
}: {
  actor: AccessibilityActor
  compact?: boolean
  description: string
  id: string
  page: Page
  results: AccessibilityResult[]
  testInfo: TestInfo
}) {
  const viewports: readonly AccessibilityViewport[] = compact
    ? [...accessibilityViewports, compactAccessibilityViewport]
    : accessibilityViewports
  for (const viewport of viewports) {
    await auditCurrentPage({
      actor,
      description,
      id,
      page,
      results,
      route: new URL(page.url()).pathname,
      testInfo,
      viewport,
    })
  }
}

async function auditMatrixState(
  page: Page,
  state: AccessibilityState,
  results: AccessibilityResult[],
  testInfo: TestInfo,
) {
  for (const viewport of viewportsForState(state)) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    try {
      await page.goto(state.route, { waitUntil: "domcontentloaded" })
      await settle(page)
      const expectedPath = state.expectedRoute ?? new URL(state.route, baseURL).pathname
      const actualPath = new URL(page.url()).pathname
      if (actualPath !== expectedPath) {
        throw new Error(`Expected ${expectedPath}, but navigation resolved to ${actualPath}.`)
      }
      if (state.interaction) await executeAccessibilityInteraction(page, state.interaction)
      await auditCurrentPage({
        actor: state.actor,
        description: state.description,
        id: state.id,
        page,
        results,
        route: state.route,
        testInfo,
        viewport,
      })
    } catch (error) {
      const result: AccessibilityResult = {
        actor: state.actor,
        description: state.description,
        findings: [executionFinding(error)],
        id: state.id,
        profile,
        route: state.route,
        title: await page.title().catch(() => ""),
        url: page.url(),
        viewport,
      }
      results.push(result)
      await captureMaskedFailure(page, testInfo, `${state.id}-${viewport.label}`).catch(() => undefined)
    }
  }
}

function selectedTextResizeStates(actor: AccessibilityActor) {
  return textResizeStatesForActor(actor).filter((state) => state.profile === profile
    && (!stateFilter || state.id === stateFilter))
}

// The same walk auditMatrixState performs -- goto per viewport, route check,
// interaction, scroll to origin -- against a page whose browser font-size
// preference has been raised. It is a separate function rather than a flag on
// auditMatrixState because what it records afterwards is different in kind:
// three layout measurements, filed as advisories against a ceiling, and no axe
// pass. Merging the two would put a branch inside the walk that every ordinary
// state pays for.
async function auditTextResizeState(
  page: Page,
  state: AccessibilityState,
  results: AccessibilityResult[],
  testInfo: TestInfo,
  raiseBrowserTextSize: () => Promise<CDPSession>,
) {
  const id = textResizeResultId(state.id)
  for (const viewport of viewportsForState(state)) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    try {
      const client = await raiseBrowserTextSize()
      await page.goto(state.route, { waitUntil: "domcontentloaded" })
      await settle(page)
      const expectedPath = state.expectedRoute ?? new URL(state.route, baseURL).pathname
      const actualPath = new URL(page.url()).pathname
      if (actualPath !== expectedPath) {
        throw new Error(`Expected ${expectedPath}, but navigation resolved to ${actualPath}.`)
      }
      if (state.interaction) await executeAccessibilityInteraction(page, state.interaction)
      // Same normalisation auditCurrentPage applies, and for the same reason: an
      // interaction that scrolled its trigger into view would otherwise leave
      // sticky chrome sitting over controls that are merely above the fold.
      //
      // Unconditional, and kept unconditional on purpose. Twelve of the sixteen
      // states declare no interaction, so it looks like 41 of the 55 audits are
      // paying a second `settle` for nothing -- but a repeated `settle` on the
      // same document is nearly free: Playwright records `networkidle` as a
      // lifecycle event of the current document and `waitForLoadState` returns
      // immediately once it has fired ("not waiting, networkidle event already
      // fired"), so the 2s is a timeout rather than a cost, and what is left is
      // `document.fonts.ready` and two animation frames. Dropping it would buy
      // tens of milliseconds and give up the one wait that would catch content
      // arriving after hydration -- on the pass whose whole value is that its
      // measurements are trustworthy.
      await page.evaluate(() => window.scrollTo(0, 0))
      await settle(page)
      const { advisories, findings } = await auditTextResizeLayout({ client, page, viewport })
      results.push({
        actor: state.actor,
        advisories,
        description: `${state.description} at ${TEXT_RESIZE_FONT_SIZES.standard}px browser text`,
        findings,
        id,
        profile,
        route: state.route,
        title: await page.title().catch(() => ""),
        url: page.url(),
        viewport,
      })
      if (findings.length || advisories.length) {
        await captureMaskedFailure(page, testInfo, `${id}-${viewport.label}`).catch(() => undefined)
      }
    } catch (error) {
      results.push({
        actor: state.actor,
        description: state.description,
        findings: [executionFinding(error)],
        id,
        profile,
        route: state.route,
        title: await page.title().catch(() => ""),
        url: page.url(),
        viewport,
      })
      await captureMaskedFailure(page, testInfo, `${id}-${viewport.label}`).catch(() => undefined)
    }
  }
}

// A second page in the actor's existing context, so the raised preference is
// scoped to a target that is closed straight afterwards and cannot follow the
// ordinary pass. It shares the context's cookies, so no second sign-in is paid
// for; it does not share the CDP session, because newCDPSession attaches per
// target.
async function sweepTextResizeStates({
  context,
  actor,
  results,
  testInfo,
}: {
  actor: AccessibilityActor
  context: BrowserContext
  results: AccessibilityResult[]
  testInfo: TestInfo
}) {
  const states = selectedTextResizeStates(actor)
  if (!states.length) return
  const page = await context.newPage()
  // Sent once and kept: Page.setFontSizes writes the tab's web preferences, so
  // it survives every navigation below rather than needing a resend per goto.
  //
  // Deferred into the first state's own try block rather than awaited here,
  // because a browser that cannot give us a CDP session at all is a gate
  // failure, and a gate failure thrown from this line would abort the sweep,
  // the actors after it and the recovery walkthrough that follows -- reporting
  // one unattributed stack instead of a finding per state with the state, the
  // viewport and a screenshot beside it.
  let preference: Promise<CDPSession> | null = null
  const raiseBrowserTextSize = async () => {
    preference ??= applyBrowserFontSizePreference(page)
    // The same session every time, because the probe in auditTextResizeLayout
    // lowers this preference and puts it back: a second session would be a
    // second override of the same setting, and whichever one lost would leave
    // the pass measuring a magnification nobody asked for.
    return preference
  }
  try {
    for (const state of states) {
      await auditTextResizeState(page, state, results, testInfo, raiseBrowserTextSize)
    }
  } finally {
    await page.close()
  }
}

async function loginWithPassword(
  page: Page,
  academyId: string,
  password: string,
) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("SMBA username").fill(academyId)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => [
    "/admin",
    "/auth/pin/setup",
    "/auth/two-factor",
    "/auth/two-factor/setup",
    "/coach",
    "/player",
  ].some((candidate) => url.pathname === candidate), { timeout: 20_000 })
}

async function completePinSetup(page: Page, pin = accessibilityPin) {
  if (new URL(page.url()).pathname !== "/auth/pin/setup") return
  await page.getByLabel("Enter PIN").fill(pin)
  await page.getByLabel("Confirm PIN").fill(pin)
  await page.getByRole("button", { name: "Set up PIN" }).click()
  await page.waitForURL((url) => url.pathname === "/admin"
    || url.pathname === "/coach"
    || url.pathname === "/player", { timeout: 20_000 })
}

async function completeAuthenticatorSetup({
  actor,
  page,
  password,
  results,
  testInfo,
}: {
  actor: "platform-admin" | "head-coach"
  page: Page
  password: string
  results: AccessibilityResult[]
  testInfo: TestInfo
}) {
  if (new URL(page.url()).pathname !== "/auth/two-factor/setup") {
    throw new Error(`${actor} did not reach first-time authenticator setup.`)
  }
  await auditDynamicState({
    actor,
    description: "First-time authenticator password confirmation",
    id: `${actor}-authenticator-setup-start`,
    page,
    results,
    testInfo,
  })
  await page.setViewportSize(accessibilityViewports[0])
  await page.getByLabel("Confirm password").fill(password)
  await page.getByRole("button", { name: "Set up authenticator" }).click()
  const manualSecret = (await page.locator(".totp-manual-key code").textContent())?.trim()
  if (!manualSecret) throw new Error("Authenticator setup did not expose a manual secret.")
  await auditDynamicState({
    actor,
    description: "Authenticator QR, manual key, backup codes, and confirmation",
    id: `${actor}-authenticator-setup-qr`,
    page,
    results,
    testInfo,
  })
  await page.setViewportSize(accessibilityViewports[0])
  const secret = new TextDecoder().decode(base32.decode(manualSecret))
  await page.getByLabel("Confirm six-digit code").fill(await createOTP(secret).totp())
  // The submit is gated on the recovery-code acknowledgement, which is the only
  // thing between a coach and losing those codes to this redirect.
  await page.getByLabel(/I have saved these recovery codes/u).check()
  await page.getByRole("button", { name: "Verify and enter workspace" }).click()
  await page.waitForURL((url) => url.pathname !== "/auth/two-factor/setup", { timeout: 20_000 })
  return secret
}

async function loginReturningProtectedAccount({
  academyId,
  actor,
  browser,
  password,
  results,
  secret,
  testInfo,
}: {
  academyId: string
  actor: "platform-admin" | "head-coach"
  browser: Browser
  password: string
  results: AccessibilityResult[]
  secret: string
  testInfo: TestInfo
}) {
  const context = await newContext(browser)
  const page = await context.newPage()
  await loginWithPassword(page, academyId, password)
  if (new URL(page.url()).pathname !== "/auth/two-factor") {
    throw new Error(`${actor} returning login did not request an authenticator code.`)
  }
  await auditDynamicState({
    actor,
    description: "Returning authenticator verification",
    id: `${actor}-authenticator-verification`,
    page,
    results,
    testInfo,
  })
  await page.setViewportSize(accessibilityViewports[0])
  await page.getByRole("button", { name: "Use a recovery code" }).click()
  await auditDynamicState({
    actor,
    description: "Saved recovery-code verification",
    id: `${actor}-backup-code-verification`,
    page,
    results,
    testInfo,
  })
  await page.setViewportSize(accessibilityViewports[0])
  await page.getByRole("button", { name: "Use authenticator code" }).click()
  await page.getByLabel("Six-digit code").fill(await createOTP(secret).totp())
  await page.getByRole("button", { name: "Verify and continue" }).click()
  await page.waitForURL((url) => url.pathname !== "/auth/two-factor", { timeout: 20_000 })
  await completePinSetup(page)
  return { context, page }
}

async function authenticatedContext(
  browser: Browser,
  actor: "head-coach" | "junior-coach" | "player",
) {
  const context = await newContext(browser)
  const page = await context.newPage()
  const academyId = actor === "head-coach"
    ? "SMBA-HC-0001"
    : actor === "junior-coach" ? "SMBA-JC-0001" : "SMBA-PL-0001"
  await loginWithPassword(page, academyId, fixturePassword)
  await completePinSetup(page)
  const expectedPath = actor === "player" ? "/player" : "/coach"
  if (new URL(page.url()).pathname !== expectedPath) {
    throw new Error(`${actor} login resolved to ${new URL(page.url()).pathname}.`)
  }
  return { context, page }
}

async function scanContextStates({
  page,
  results,
  states,
  testInfo,
}: {
  page: Page
  results: AccessibilityResult[]
  states: readonly AccessibilityState[]
  testInfo: TestInfo
}) {
  for (const state of states) await auditMatrixState(page, state, results, testInfo)
}

async function registerActivationContext(browser: Browser, fullName: string) {
  const context = await newContext(browser)
  const page = await context.newPage()
  await page.goto("/register", { waitUntil: "domcontentloaded" })
  await page.getByLabel("Full name").fill(fullName)
  await page.getByRole("button", { name: "Request registration" }).click()
  await page.getByRole("heading", { name: "Registration received." }).waitFor()
  await page.getByRole("link", { name: "View activation status" }).click()
  await page.waitForURL((url) => url.pathname === "/activate")
  return { context, page }
}

function expireRegistration(fullName: string) {
  const database = new Database(databasePath)
  try {
    const account = database.prepare("select id from accounts where full_name = ?").get(fullName) as { id: string } | undefined
    if (!account) throw new Error(`Registration ${fullName} was not found.`)
    database.prepare("update auth_activation_claims set expires_at = 0 where account_id = ?").run(account.id)
  } finally {
    database.close()
  }
}

function verifyRecoveryEmail(fullName: string) {
  const database = new Database(databasePath)
  try {
    const account = database.prepare("select id from accounts where full_name = ?").get(fullName) as { id: string } | undefined
    if (!account) throw new Error(`Approved account ${fullName} was not found.`)
    const now = Date.now()
    database.prepare(`
      insert into auth_recovery_emails (account_id, email, verified_at, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(account_id) do update set
        email = excluded.email,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
    `).run(account.id, "accessibility@example.test", now, now, now)
  } finally {
    database.close()
  }
}

async function reviewRegistration(
  coachPage: Page,
  fullName: string,
  decision: "approve" | "reject",
) {
  await coachPage.setViewportSize(accessibilityViewports[0])
  await coachPage.goto("/coach/onboarding", { waitUntil: "domcontentloaded" })
  const row = coachPage.locator("ol > li").filter({ hasText: fullName }).first()
  await row.getByRole("link", { name: /^(Open|Continue)$/u }).click()
  if (decision === "approve") {
    await row.getByRole("button", { name: "Approve & continue" }).click()
    await expect(coachPage.getByText(new RegExp(`${fullName} approved as SMBA-PL-`, "u")))
      .toBeVisible()
  } else {
    coachPage.once("dialog", (dialog) => dialog.accept())
    await row.getByRole("button", { name: "Reject request" }).click()
    await expect(row).toBeHidden()
  }
}

async function auditCleanActivationStates(
  browser: Browser,
  coachPage: Page,
  results: AccessibilityResult[],
  testInfo: TestInfo,
) {
  const names = {
    approved: "Accessibility Approved Player",
    expired: "Accessibility Expired Player",
    pending: "Accessibility Pending Player",
    rejected: "Accessibility Rejected Player",
  }
  const pending = await registerActivationContext(browser, names.pending)
  const approved = await registerActivationContext(browser, names.approved)
  const rejected = await registerActivationContext(browser, names.rejected)
  const expired = await registerActivationContext(browser, names.expired)

  await reviewRegistration(coachPage, names.approved, "approve")
  await reviewRegistration(coachPage, names.rejected, "reject")
  expireRegistration(names.expired)
  await Promise.all([approved.page.reload(), rejected.page.reload(), expired.page.reload()])

  await auditDynamicState({
    actor: "guest",
    description: "Pending activation receipt",
    id: "activation-pending",
    page: pending.page,
    results,
    testInfo,
  })
  await auditDynamicState({
    actor: "guest",
    description: "Approved activation recovery-email form",
    id: "activation-approved-email",
    page: approved.page,
    results,
    testInfo,
  })
  await approved.page.setViewportSize(accessibilityViewports[0])
  await approved.page.getByRole("textbox", { name: "Recovery email" })
    .fill("accessibility@example.test")
  await approved.page.getByRole("button", { name: "Send verification code" }).click()
  await approved.page.getByText("Check your email", { exact: true })
    .waitFor({ state: "visible" })
  await auditDynamicState({
    actor: "guest",
    description: "Six-digit activation email verification",
    id: "activation-email-code",
    page: approved.page,
    results,
    testInfo,
  })
  verifyRecoveryEmail(names.approved)
  await approved.page.reload({ waitUntil: "domcontentloaded" })
  await auditDynamicState({
    actor: "guest",
    description: "Approved activation password form",
    id: "activation-approved-password",
    page: approved.page,
    results,
    testInfo,
  })
  await auditDynamicState({
    actor: "guest",
    description: "Rejected activation receipt",
    id: "activation-rejected",
    page: rejected.page,
    results,
    testInfo,
  })
  await auditDynamicState({
    actor: "guest",
    description: "Expired activation receipt",
    id: "activation-expired",
    page: expired.page,
    results,
    testInfo,
  })

  await Promise.all([
    pending.context.close(),
    approved.context.close(),
    rejected.context.close(),
    expired.context.close(),
  ])
}

async function auditStressRecoveryStates(
  browser: Browser,
  results: AccessibilityResult[],
  testInfo: TestInfo,
) {
  const playerChallenge = insertRecoveryChallenge(
    "SMBA-PL-0001",
    "accessibility-player@example.test",
  )
  const playerContext = await newContext(browser)
  try {
    await playerContext.addCookies([{
      httpOnly: true,
      name: "smba_password_recovery",
      sameSite: "Lax",
      url: `${baseURL}/recover`,
      value: playerChallenge.token,
    }])
    const playerPage = await playerContext.newPage()
    await playerPage.goto("/recover/reset", { waitUntil: "domcontentloaded" })
    await playerPage.getByRole("heading", { name: "Create a new password." })
      .waitFor({ state: "visible" })
    await auditDynamicState({
      actor: "player",
      description: "Valid player password-reset form",
      id: "player-password-reset",
      page: playerPage,
      results,
      testInfo,
    })
  } finally {
    await playerContext.close()
    deleteRecoveryChallenge(playerChallenge.challengeId)
  }

  const protectedRecovery = prepareHeadCoachRecovery("accessibility-coach@example.test")
  const coachPasswordChallenge = insertRecoveryChallenge(
    "SMBA-HC-0001",
    "accessibility-coach@example.test",
  )
  const coachAuthenticatorChallenge = insertRecoveryChallenge(
    "SMBA-HC-0001",
    "accessibility-coach@example.test",
  )
  const passwordContext = await newContext(browser)
  const authenticatorContext = await newContext(browser)
  try {
    await passwordContext.addCookies([{
      httpOnly: true,
      name: "smba_password_recovery",
      sameSite: "Lax",
      url: `${baseURL}/recover`,
      value: coachPasswordChallenge.token,
    }])
    const passwordPage = await passwordContext.newPage()
    await passwordPage.goto("/recover/reset", { waitUntil: "domcontentloaded" })
    await passwordPage.getByRole("heading", { name: "Verify it’s you." })
      .waitFor({ state: "visible" })
    await auditDynamicState({
      actor: "head-coach",
      description: "Protected password-recovery second factor",
      id: "head-coach-password-recovery-factor",
      page: passwordPage,
      results,
      testInfo,
    })

    await authenticatorContext.addCookies([{
      httpOnly: true,
      name: "smba_authenticator_recovery",
      sameSite: "Lax",
      url: `${baseURL}/auth/two-factor/recovery`,
      value: coachAuthenticatorChallenge.token,
    }])
    const authenticatorPage = await authenticatorContext.newPage()
    await authenticatorPage.goto("/auth/two-factor/recovery?verified=1", {
      waitUntil: "domcontentloaded",
    })
    await authenticatorPage.getByRole("heading", { name: "Ask the platform admin." })
      .waitFor({ state: "visible" })
    await auditDynamicState({
      actor: "head-coach",
      description: "Verified authenticator-recovery approval request",
      id: "head-coach-authenticator-recovery-verified",
      page: authenticatorPage,
      results,
      testInfo,
    })
  } finally {
    await Promise.all([passwordContext.close(), authenticatorContext.close()])
    deleteRecoveryChallenge(coachPasswordChallenge.challengeId)
    deleteRecoveryChallenge(coachAuthenticatorChallenge.challengeId)
    protectedRecovery.restore()
  }
}

// Every profile/actor pair the branches inside the matrix test open a context for.
// fa88c08 derived this from a `sessionProviders` registry and refused to start when
// a pair was missing; dd0008c replaced the registry with those inline branches and
// dropped the refusal, so a state written against an unwired pair is now filtered
// out of every branch and audits nothing. Keep this in step with the branches.
const dispatchedSessionPairs = new Set<string>([
  "admin/guest",
  "admin/platform-admin",
  "clean/guest",
  "clean/head-coach",
  "stress/guest",
  "stress/head-coach",
  "stress/junior-coach",
  "stress/platform-admin",
  "stress/player",
])

test.describe("UI accessibility / WCAG 2.2 AA", () => {
  // The only check in this file that interrogates the server rather than the
  // runner. Everything above reads this process's environment; this reads the
  // process that will actually render the DOM axe measures.
  test.beforeAll(async () => {
    if (fixtureClock === null) return
    const healthUrl = new URL("/api/health", baseURL).toString()
    const response = await fetch(healthUrl)
    if (!response.ok) {
      throw new Error(`${healthUrl} returned HTTP ${response.status} before the audit began.`)
    }
    assertServerFixtureClock(fixtureClock, await response.json(), healthUrl)
  })

  test("audits the representative role and state matrix", async ({ browser }, testInfo) => {
    // GitHub Actions owns the 25-minute wall-clock limit. Keep Playwright's
    // internal timeout generous so host clock adjustments cannot manufacture
    // a partial state-execution failure during a long sequential matrix.
    test.setTimeout(2 * 60 * 60_000)
    mkdirSync(outputRoot, { recursive: true })
    const results: AccessibilityResult[] = []

    // Fail before the run, not after it: the full matrix takes most of the
    // 25-minute CI limit, so an unwired pair discovered at the end costs a whole
    // job to report what this loop can report in milliseconds.
    const unwired = new Map<string, string[]>()
    for (const state of selectedStatesForProfile(profile)) {
      const pair = `${state.profile}/${state.actor}`
      if (dispatchedSessionPairs.has(pair)) continue
      unwired.set(pair, [...(unwired.get(pair) ?? []), state.id])
    }
    const unwiredPairs = [...unwired].map(([pair, ids]) => `${pair}: ${ids.join(", ")}`)
    expect(unwiredPairs, `No session context is opened for ${unwiredPairs.join(" | ")}`)
      .toEqual([])

    try {
      if (profile === "admin") {
        const guestContext = await newContext(browser)
        const guestPage = await guestContext.newPage()
        await scanContextStates({
          page: guestPage,
          results,
          states: selectedStatesForProfile(profile).filter((state) => state.actor === "guest"),
          testInfo,
        })
        await guestContext.close()
      }

      if ((profile === "admin" || profile === "stress")
        && selectedStatesForProfile(profile).some((state) => state.actor === "platform-admin")) {
        const setupContext = await newContext(browser)
        const setupPage = await setupContext.newPage()
        await loginWithPassword(setupPage, "SMBA-ADMIN-0001", adminPassword)
        const secret = await completeAuthenticatorSetup({
          actor: "platform-admin",
          page: setupPage,
          password: adminPassword,
          results,
          testInfo,
        })
        await completePinSetup(setupPage)
        await setupContext.close()

        const admin = await loginReturningProtectedAccount({
          academyId: "SMBA-ADMIN-0001",
          actor: "platform-admin",
          browser,
          password: adminPassword,
          results,
          secret,
          testInfo,
        })
        const adminStates = selectedStatesForProfile(profile).filter((state) => state.actor === "platform-admin")
        const recoveryQueue = profile === "stress"
          ? prepareAuthenticatorRecoveryQueue()
          : null
        try {
          await scanContextStates({
            page: admin.page,
            results,
            states: adminStates,
            testInfo,
          })
        } finally {
          recoveryQueue?.restore()
        }
        if (profile === "admin") {
          await admin.page.goto("/admin", { waitUntil: "domcontentloaded" })
          await admin.page.getByRole("button", { name: "Open secure coach setup" }).click()
          await admin.page.waitForURL((url) => url.pathname === "/setup/head-coach")
          await auditDynamicState({
            actor: "platform-admin",
            description: "Secure first-head-coach setup form",
            id: "admin-head-coach-setup",
            page: admin.page,
            results,
            testInfo,
          })
        }
        await admin.context.close()
      }

      if (profile === "clean") {
        const guestContext = await newContext(browser)
        const guestPage = await guestContext.newPage()
        await scanContextStates({
          page: guestPage,
          results,
          states: selectedStatesForProfile(profile).filter((state) => state.actor === "guest"),
          testInfo,
        })
        await guestContext.close()

        const setupContext = await newContext(browser)
        const setupPage = await setupContext.newPage()
        await loginWithPassword(setupPage, "SMBA-HC-0001", fixturePassword)
        const secret = await completeAuthenticatorSetup({
          actor: "head-coach",
          page: setupPage,
          password: fixturePassword,
          results,
          testInfo,
        })
        if (new URL(setupPage.url()).pathname === "/auth/pin/setup") {
          await auditDynamicState({
            actor: "head-coach",
            description: "Mandatory head-coach PIN setup",
            id: "head-coach-pin-setup",
            page: setupPage,
            results,
            testInfo,
          })
        }
        await completePinSetup(setupPage)
        await setupContext.close()
        const coach = await loginReturningProtectedAccount({
          academyId: "SMBA-HC-0001",
          actor: "head-coach",
          browser,
          password: fixturePassword,
          results,
          secret,
          testInfo,
        })
        // Before the activation walkthrough approves and rejects registrations,
        // so head-coach states still see the pristine clean academy.
        await scanContextStates({
          page: coach.page,
          results,
          states: selectedStatesForProfile(profile).filter((state) => state.actor === "head-coach"),
          testInfo,
        })
        await auditCleanActivationStates(browser, coach.page, results, testInfo)
        await coach.context.close()
      }

      if (profile === "stress") {
        // Public surfaces that need published content have to be audited here:
        // the stress academy is the only fixture that has any.
        const guestStates = selectedStatesForProfile(profile)
          .filter((state) => state.actor === "guest")
        if (guestStates.length) {
          const guestContext = await newContext(browser)
          const guestPage = await guestContext.newPage()
          await scanContextStates({
            page: guestPage,
            results,
            states: guestStates,
            testInfo,
          })
          await guestContext.close()
        }

        for (const actor of ["head-coach", "junior-coach", "player"] as const) {
          const actorStates = selectedStatesForProfile(profile).filter((state) => state.actor === actor)
          if (!actorStates.length) continue
          const session = await authenticatedContext(browser, actor)
          await scanContextStates({
            page: session.page,
            results,
            states: actorStates,
            testInfo,
          })
          // After the ordinary pass, and inside the same signed-in context, so
          // the raised font-size preference cannot reach a state audited above.
          await sweepTextResizeStates({
            actor,
            context: session.context,
            results,
            testInfo,
          })
          await session.context.close()
        }
        await auditStressRecoveryStates(browser, results, testInfo)
      }
    } finally {
      const { jsonPath } = writeAccessibilityResults(outputRoot, results, fixtureClock)
      if (clockMismatch
        || formatAccessibilityFailures(results).length
        || accessibilityAdvisoryRegressions(results).length) {
        await testInfo.attach(`${profile}-accessibility-results`, {
          contentType: "application/json",
          path: jsonPath,
        })
      }
    }

    // dispatchedSessionPairs is hand-maintained, so it can call a pair wired that no
    // branch actually reaches. auditMatrixState records a result even when a state
    // throws, so an id absent here was never scanned at all rather than scanned and
    // failed, and the failures assertion below would not have reported it.
    const audited = new Set(results.map((result) => result.id))
    const undispatched = selectedStatesForProfile(profile)
      .filter((state) => !audited.has(state.id))
      .map((state) => `${state.id} (${state.actor})`)
    expect(undispatched, `No context audited: ${undispatched.join(", ")}`).toEqual([])

    // The same argument, for the text-resize pass. Its findings are advisory and
    // its ceiling is zero, so a sweep that never ran produces no advisory, no
    // breach and a green gate -- silence that reads exactly like success. An
    // actor whose sweep was never wired in fails here instead.
    const unresizedStates = textResizeStates
      .filter((state) => state.profile === profile
        && (!stateFilter || state.id === stateFilter)
        && !audited.has(textResizeResultId(state.id)))
      .map((state) => `${state.id} (${state.actor})`)
    expect(unresizedStates, `No text-resize sweep audited: ${unresizedStates.join(", ")}`)
      .toEqual([])

    const failures = formatAccessibilityFailures(results)
    expect(failures, failures.slice(0, 80).join("\n")).toEqual([])
    // Ahead of the ratchet, because it decides whether the ratchet means
    // anything: counts taken on a different day are neither a ceiling nor a
    // floor for this run, so its verdict would be noise rather than evidence.
    expect(clockMismatch, clockMismatch ?? "").toBeNull()
    // Second assertion rather than one merged list: a ratchet breach is a count
    // that rose, not a defect at a state, and it needs the advisory JSON above
    // to triage rather than the finding's own evidence line.
    const advisoryRegressions = accessibilityAdvisoryRegressions(results)
    expect(advisoryRegressions, advisoryRegressions.join("\n")).toEqual([])
  })
})
