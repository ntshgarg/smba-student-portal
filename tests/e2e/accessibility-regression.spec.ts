import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"

import { base32 } from "@better-auth/utils/base32"
import { createOTP } from "@better-auth/utils/otp"
import type { Browser, Page, TestInfo } from "@playwright/test"
import Database from "better-sqlite3"

import { expect, test } from "./support/failure-evidence"

import {
  auditAccessibilityState,
  captureMaskedFailure,
  formatAccessibilityFailures,
  writeAccessibilityResults,
  type AccessibilityFinding,
  type AccessibilityResult,
} from "./support/accessibility-audit"
import { assertDisposableAccessibilityDatabase } from "./support/accessibility-environment"
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

const profileValue = process.env.SMBA_ACCESSIBILITY_PROFILE ?? "stress"
if (!accessibilityProfiles.includes(profileValue as AccessibilityProfile)) {
  throw new Error(`SMBA_ACCESSIBILITY_PROFILE must be one of: ${accessibilityProfiles.join(", ")}`)
}
const profile = profileValue as AccessibilityProfile
const databasePath = assertDisposableAccessibilityDatabase(process.env.SMBA_ACCESSIBILITY_DB)
const baseURL = process.env.SMBA_ACCESSIBILITY_BASE_URL ?? "http://127.0.0.1:3000"
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
  if (!stateFilter) return states
  const filtered = states.filter((state) => state.id === stateFilter)
  if (!filtered.length) {
    throw new Error(
      `SMBA_ACCESSIBILITY_STATE=${stateFilter} matches no ${selectedProfile} state. `
      + `Valid ids: ${states.map((state) => state.id).join(", ")}`,
    )
  }
  return filtered
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
  await page.evaluate(async () => {
    await document.fonts.ready.catch(() => undefined)
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
    })
  })
  // Next's streamed metadata can briefly replace the title after a responsive
  // reflow. Let that transition finish before asking Axe to inspect the head;
  // otherwise Axe can observe an empty intermediate <title> even though the
  // page title is correct immediately before and after the audit.
  await page.waitForTimeout(100)
  await page.waitForFunction(() => document.title.trim().length > 0, undefined, {
    timeout: 5_000,
  }).catch(() => undefined)
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

type SessionKey = `${AccessibilityProfile}/${AccessibilityActor}`

type SessionContext = {
  browser: Browser
  results: AccessibilityResult[]
  testInfo: TestInfo
}

type ActorSession = {
  // Dynamic states that need this session's live page, audited after the pair's
  // matrix states and before the context closes.
  after?: (page: Page) => Promise<void>
  close: () => Promise<void>
  page: Page
  // Fixture state that must exist only while this pair's states are scanned.
  wrap?: (scan: () => Promise<void>) => Promise<void>
}

type SessionProvider = (context: SessionContext) => Promise<ActorSession>

async function guestSession({ browser }: SessionContext): Promise<ActorSession> {
  const context = await newContext(browser)
  const page = await context.newPage()
  return { close: () => context.close(), page }
}

async function protectedAdminSession({
  browser,
  results,
  testInfo,
}: SessionContext): Promise<ActorSession> {
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
  return { close: () => admin.context.close(), page: admin.page }
}

async function cleanHeadCoachSession({
  browser,
  results,
  testInfo,
}: SessionContext): Promise<ActorSession> {
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
  return { close: () => coach.context.close(), page: coach.page }
}

async function passwordAndPinSession(
  browser: Browser,
  actor: "head-coach" | "junior-coach" | "player",
): Promise<ActorSession> {
  const session = await authenticatedContext(browser, actor)
  return { close: () => session.context.close(), page: session.page }
}

// Session creation depends on the profile as well as the actor: the clean head
// coach starts at first-time authenticator setup, while the stress head coach
// only needs a password and a PIN. Declaration order is execution order, which
// is why stress/platform-admin stays ahead of the other stress pairs.
const sessionProviders = new Map<SessionKey, SessionProvider>([
  ["admin/guest", guestSession],
  ["admin/platform-admin", async (context) => ({
    ...await protectedAdminSession(context),
    after: async (page) => {
      await page.goto("/admin", { waitUntil: "domcontentloaded" })
      await page.getByRole("button", { name: "Open secure coach setup" }).click()
      await page.waitForURL((url) => url.pathname === "/setup/head-coach")
      await auditDynamicState({
        actor: "platform-admin",
        description: "Secure first-head-coach setup form",
        id: "admin-head-coach-setup",
        page,
        results: context.results,
        testInfo: context.testInfo,
      })
    },
  })],
  ["clean/guest", guestSession],
  ["clean/head-coach", async (context) => ({
    ...await cleanHeadCoachSession(context),
    // The activation walkthrough approves and rejects registrations, so it has
    // to follow the head-coach states that still expect a pristine academy.
    after: (page) => auditCleanActivationStates(
      context.browser,
      page,
      context.results,
      context.testInfo,
    ),
  })],
  ["stress/platform-admin", async (context) => ({
    ...await protectedAdminSession(context),
    wrap: async (scan) => {
      const recoveryQueue = prepareAuthenticatorRecoveryQueue()
      try {
        await scan()
      } finally {
        recoveryQueue.restore()
      }
    },
  })],
  // Public surfaces that need published content have to be audited here: the
  // stress academy is the only fixture that has any.
  ["stress/guest", guestSession],
  ["stress/head-coach", ({ browser }) => passwordAndPinSession(browser, "head-coach")],
  ["stress/junior-coach", ({ browser }) => passwordAndPinSession(browser, "junior-coach")],
  ["stress/player", ({ browser }) => passwordAndPinSession(browser, "player")],
])

test.describe("UI accessibility / WCAG 2.2 AA", () => {
  test("audits the representative role and state matrix", async ({ browser }, testInfo) => {
    // GitHub Actions owns the 25-minute wall-clock limit. Keep Playwright's
    // internal timeout generous so host clock adjustments cannot manufacture
    // a partial state-execution failure during a long sequential matrix.
    test.setTimeout(2 * 60 * 60_000)
    mkdirSync(outputRoot, { recursive: true })
    const results: AccessibilityResult[] = []
    const selected = selectedStatesForProfile(profile)
    const statesByPair = new Map<SessionKey, AccessibilityState[]>()
    for (const state of selected) {
      const key: SessionKey = `${state.profile}/${state.actor}`
      statesByPair.set(key, [...(statesByPair.get(key) ?? []), state])
    }
    // A matrix pair with no provider used to be filtered out of every branch and
    // vanish from the results. Refuse to run rather than under-report coverage.
    const unwired = [...statesByPair].filter(([key]) => !sessionProviders.has(key))
    if (unwired.length) {
      throw new Error(unwired.map(([key, states]) =>
        `No session provider for ${key}. ${states.length} state(s) would be skipped: `
        + states.map((state) => state.id).join(", ")).join(" "))
    }

    try {
      for (const [key, createSession] of sessionProviders) {
        const states = statesByPair.get(key)
        if (!states) continue
        const session = await createSession({ browser, results, testInfo })
        try {
          const scan = () => scanContextStates({ page: session.page, results, states, testInfo })
          if (session.wrap) await session.wrap(scan)
          else await scan()
          await session.after?.(session.page)
        } finally {
          await session.close()
        }
      }

      if (profile === "stress") await auditStressRecoveryStates(browser, results, testInfo)
    } finally {
      const { jsonPath } = writeAccessibilityResults(outputRoot, results)
      if (formatAccessibilityFailures(results).length) {
        await testInfo.attach(`${profile}-accessibility-results`, {
          contentType: "application/json",
          path: jsonPath,
        })
      }
    }

    // Compared against the filtered selection, not the whole matrix, so a
    // single-state run stays valid.
    const executed = new Set(results.map((result) => result.id))
    const missing = selected.filter((state) => !executed.has(state.id)).map((state) => state.id)
    expect(missing, `States selected but never executed: ${missing.join(", ")}`).toEqual([])

    const failures = formatAccessibilityFailures(results)
    expect(failures, failures.slice(0, 80).join("\n")).toEqual([])
  })
})
