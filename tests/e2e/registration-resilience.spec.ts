import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import type { Browser, Page, Route, TestInfo } from "@playwright/test"
import { base32 } from "@better-auth/utils/base32"
import { createOTP } from "@better-auth/utils/otp"
import Database from "better-sqlite3"
import { symmetricDecrypt } from "better-auth/crypto"

import { expect, test } from "./support/failure-evidence"

const projectRoot = path.resolve(process.cwd())
const canonicalDataDirectory = path.join(projectRoot, ".data")
const configuredDatabasePath = process.env.SMBA_REGISTRATION_RESILIENCE_DB

type RegistrationRow = {
  approvalStatus: string
  fullName: string
  id: string
  normalizedName: string
  registrationRequestFingerprint: string | null
  registrationRequestKey: string | null
  requestedRole: string
  role: string | null
}

function pathIsInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function assertDisposableDatabase() {
  if (!configuredDatabasePath) {
    throw new Error(
      "SMBA_REGISTRATION_RESILIENCE_DB is required and must identify the disposable Clean clone used by the external server.",
    )
  }
  if (!path.isAbsolute(configuredDatabasePath)) {
    throw new Error("SMBA_REGISTRATION_RESILIENCE_DB must be an absolute path.")
  }
  if (!existsSync(configuredDatabasePath)) {
    throw new Error(`Disposable test database does not exist: ${configuredDatabasePath}`)
  }

  const databasePath = realpathSync(configuredDatabasePath)
  const dataDirectory = existsSync(canonicalDataDirectory)
    ? realpathSync(canonicalDataDirectory)
    : canonicalDataDirectory
  if (pathIsInside(dataDirectory, databasePath)) {
    throw new Error(
      `Refusing registration browser mutations inside the canonical data directory: ${databasePath}`,
    )
  }

  const databaseStat = statSync(databasePath)
  if (existsSync(dataDirectory)) {
    for (const entry of readdirSync(dataDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".db")) continue
      const canonicalStat = statSync(path.join(dataDirectory, entry.name))
      if (databaseStat.dev === canonicalStat.dev && databaseStat.ino === canonicalStat.ino) {
        throw new Error(
          `Refusing a hard link to canonical database ${entry.name}: ${databasePath}`,
        )
      }
    }
  }

  return databasePath
}

const databasePath = assertDisposableDatabase()

function readDatabase<T>(query: (database: Database.Database) => T) {
  const database = new Database(databasePath, { fileMustExist: true, readonly: true })
  try {
    database.pragma("query_only = ON")
    return query(database)
  } finally {
    database.close()
  }
}

function accountCount(fullName: string) {
  return readDatabase((database) => (
    database.prepare("SELECT count(*) AS count FROM accounts WHERE full_name = ?")
      .get(fullName) as { count: number }
  ).count)
}

function registrationRows(fullName: string) {
  return readDatabase((database) => database.prepare(`
    SELECT
      id,
      full_name AS fullName,
      normalized_name AS normalizedName,
      registration_request_fingerprint AS registrationRequestFingerprint,
      registration_request_key AS registrationRequestKey,
      requested_role AS requestedRole,
      role,
      approval_status AS approvalStatus
    FROM accounts
    WHERE full_name = ?
    ORDER BY created_at, id
  `).all(fullName) as RegistrationRow[])
}

function academyIdFor(accountId: string) {
  return readDatabase((database) => (
    database.prepare(`
      SELECT identifier FROM auth_methods
      WHERE account_id = ? AND method = 'academy_id' AND revoked_at IS NULL
    `).get(accountId) as { identifier: string } | undefined
  )?.identifier ?? null)
}

function markRecoveryEmailVerified(accountId: string, email: string) {
  const database = new Database(databasePath, { fileMustExist: true })
  try {
    const now = Date.now()
    database.prepare(`
      INSERT INTO auth_recovery_emails (
        account_id, email, verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        email = excluded.email,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
    `).run(accountId, email, now, now, now)
  } finally {
    database.close()
  }
}

function credentialEvidence(accountId: string) {
  return readDatabase((database) => ({
    activationCodeCount: (database.prepare(`
      SELECT count(*) AS count FROM auth_access_codes
      WHERE account_id = ? AND purpose = 'activation'
    `).get(accountId) as { count: number }).count,
    claim: database.prepare(`
      SELECT token_hash AS tokenHash, consumed_at AS consumedAt
      FROM auth_activation_claims WHERE account_id = ?
    `).get(accountId) as { consumedAt: number | null; tokenHash: string } | undefined,
    pin: database.prepare(`
      SELECT pin_hash AS pinHash FROM auth_pin_credentials WHERE account_id = ?
    `).get(accountId) as { pinHash: string } | undefined,
  }))
}

function databaseHealth() {
  return readDatabase((database) => ({
    foreignKeyViolations: database.pragma("foreign_key_check"),
    integrity: database.pragma("integrity_check", { simple: true }),
  }))
}

async function attachDatabaseEvidence(
  testInfo: TestInfo,
  fullName: string,
  label: string,
) {
  const evidence = {
    health: databaseHealth(),
    rows: registrationRows(fullName),
  }
  const evidencePath = testInfo.outputPath(label)
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
  await testInfo.attach(label, {
    path: evidencePath,
    contentType: "application/json",
  })
}

async function openRegistration(page: Page) {
  await page.goto("/register", { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: "Join the portal." })).toBeVisible()
}

async function expectOnePendingPlayer(fullName: string) {
  await expect.poll(() => accountCount(fullName)).toBe(1)
  expect(registrationRows(fullName)).toEqual([
    expect.objectContaining({
      approvalStatus: "pending",
      fullName,
      registrationRequestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      registrationRequestKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
      requestedRole: "player",
      role: null,
    }),
  ])
}

function registrationAction(route: Route) {
  const request = route.request()
  return request.method() === "POST" && new URL(request.url()).pathname === "/register"
}

test.afterEach(() => {
  expect(databaseHealth()).toEqual({
    foreignKeyViolations: [],
    integrity: "ok",
  })
})

test("empty validation associates the error and focuses Full name without writing", async ({ page }, testInfo) => {
  const before = readDatabase((database) => (
    database.prepare("SELECT count(*) AS count FROM accounts").get() as { count: number }
  ).count)

  await openRegistration(page)
  const fullNameField = page.getByLabel("Full name")
  await page.getByRole("button", { name: "Send code" }).click()

  await expect(page.locator("#full-name-error")).toHaveText("Enter your full name.")
  await expect(fullNameField).toHaveAttribute("aria-describedby", "full-name-error")
  await expect(fullNameField).toHaveAttribute("aria-invalid", "true")
  await expect(fullNameField).toBeFocused()
  expect(readDatabase((database) => (
    database.prepare("SELECT count(*) AS count FROM accounts").get() as { count: number }
  ).count)).toBe(before)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("validation-focus.png"),
  })
})

test("two immediate form submissions create exactly one pending account", async ({ page }, testInfo) => {
  const fullName = "Registration Resilience Double Submit"
  expect(accountCount(fullName)).toBe(0)

  await openRegistration(page)
  await page.getByLabel("Full name").fill(fullName)
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })

  await expect(page.getByRole("heading", { name: "Registration received." })).toBeVisible()
  await expectOnePendingPlayer(fullName)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("double-submit-confirmation.png"),
  })
  await attachDatabaseEvidence(testInfo, fullName, "double-submit-database.json")
})

test("repeated 503s preserve the exact name, write nothing, and retry once", async ({ page }, testInfo) => {
  const fullName = "Registration Resilience Transport Failure"
  let intercepted = 0
  expect(accountCount(fullName)).toBe(0)

  await page.route("**/register", async (route) => {
    if (intercepted < 2 && registrationAction(route)) {
      intercepted += 1
      await new Promise((resolve) => setTimeout(resolve, 250))
      await route.fulfill({
        body: "Simulated registration transport failure",
        contentType: "text/plain",
        status: 503,
      })
      return
    }
    await route.continue()
  })

  await openRegistration(page)
  const fullNameField = page.getByLabel("Full name")
  const submit = page.getByRole("button", { name: "Send code" })
  const formError = page.locator("#registration-form-error")
  await fullNameField.fill(fullName)
  for (let failure = 1; failure <= 2; failure += 1) {
    await submit.click()
    await expect(formError).toHaveCount(0)
    await expect(formError).toContainText("We couldn’t send your request")
    await expect(fullNameField).toHaveValue(fullName)
    await expect(fullNameField).not.toHaveAttribute("aria-invalid", "true")
    await expect(submit).toBeEnabled()
    await expect(submit).toBeFocused()
    expect(intercepted).toBe(failure)
    expect(accountCount(fullName)).toBe(0)
  }

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("503-recoverable-form.png"),
  })

  await page.unroute("**/register")
  await submit.click()
  await expect(page.getByRole("heading", { name: "Registration received." })).toBeVisible()
  await expectOnePendingPlayer(fullName)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("503-retry-confirmation.png"),
  })
  await attachDatabaseEvidence(testInfo, fullName, "503-retry-database.json")
})

test("an aborted committed response retries idempotently", async ({ page }, testInfo) => {
  const fullName = "Registration Resilience Ambiguous Commit"
  let upstreamStatus: number | null = null
  let intercepted = false
  expect(accountCount(fullName)).toBe(0)

  await page.route("**/register", async (route) => {
    if (!intercepted && registrationAction(route)) {
      intercepted = true
      const response = await route.fetch()
      upstreamStatus = response.status()
      await route.abort("failed")
      return
    }
    await route.continue()
  })

  await openRegistration(page)
  const fullNameField = page.getByLabel("Full name")
  await fullNameField.fill(fullName)
  await page.getByRole("button", { name: "Send code" }).click()

  await expect(page.locator("#registration-form-error"))
    .toContainText("We couldn’t send your request")
  await expect(fullNameField).toHaveValue(fullName)
  expect(intercepted).toBe(true)
  expect(upstreamStatus).toBe(200)
  await expect.poll(() => accountCount(fullName)).toBe(1)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("ambiguous-commit-recoverable-form.png"),
  })

  await page.unroute("**/register")
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByRole("heading", { name: "Registration received." })).toBeVisible()
  await expectOnePendingPlayer(fullName)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("ambiguous-retry-confirmation.png"),
  })
  await attachDatabaseEvidence(testInfo, fullName, "ambiguous-retry-database.json")
})

async function loginAsHeadCoach(browser: Browser) {
  const baseURL = process.env.SMBA_REGISTRATION_RESILIENCE_BASE_URL!
  const context = await browser.newContext({ baseURL, viewport: { height: 900, width: 1440 } })
  const page = await context.newPage()
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("Academy ID").fill("SMBA-HC-0001")
  await page.getByLabel("Password").fill(
    process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!",
  )
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => (
    url.pathname === "/auth/two-factor/setup"
      || url.pathname === "/auth/two-factor"
      || url.pathname === "/auth/pin/setup"
      || url.pathname.startsWith("/coach")
  ), { timeout: 20_000 })
  if (new URL(page.url()).pathname === "/auth/two-factor/setup") {
    await page.getByLabel("Confirm password").fill(
      process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!",
    )
    await page.getByRole("button", { name: "Set up authenticator" }).click()
    const manualSecret = await page.locator(".totp-manual-key code").textContent()
    if (!manualSecret) throw new Error("Authenticator setup did not expose a manual secret.")
    const authenticatorSecret = new TextDecoder().decode(base32.decode(manualSecret))
    await page.getByLabel("Confirm six-digit code").fill(
      await createOTP(authenticatorSecret).totp(),
    )
    // The submit is gated on the recovery-code acknowledgement, which is the
    // only thing between a coach and losing those codes to this redirect.
    await page.getByLabel(/I have saved these recovery codes/u).check()
    await page.getByRole("button", { name: "Verify and enter workspace" }).click()
    await page.waitForURL((url) => (
      url.pathname === "/auth/pin/setup" || url.pathname.startsWith("/coach")
    ), { timeout: 20_000 })
  }
  if (new URL(page.url()).pathname === "/auth/two-factor") {
    const row = readDatabase((database) => database.prepare(`
        SELECT secret
        FROM auth_two_factors
        WHERE user_id = '00000000-0000-4000-8000-000000000001'
          AND verified = 1
        LIMIT 1
      `).get() as { secret: string } | undefined)
    if (!row) throw new Error("The head coach has no verified authenticator secret.")
    const authenticatorSecret = await symmetricDecrypt({
      data: row.secret,
      key: process.env.BETTER_AUTH_SECRET ?? "smba-local-release-test-secret-2026",
    })
    await page.getByLabel("Six-digit code").fill(await createOTP(authenticatorSecret).totp())
    await page.getByRole("button", { name: "Verify and continue" }).click()
    await page.waitForURL((url) => (
      url.pathname === "/auth/pin/setup" || url.pathname.startsWith("/coach")
    ), { timeout: 20_000 })
  }
  if (new URL(page.url()).pathname === "/auth/pin/setup") {
    await page.getByLabel("Enter PIN").fill("135790")
    await page.getByLabel("Confirm PIN").fill("135790")
    await page.getByRole("button", { name: "Set up PIN" }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/coach"), { timeout: 20_000 })
  }
  return { context, page }
}

async function loginAsActivatedPlayer(
  browser: Browser,
  academyId: string,
  factor: { password: string } | { pin: string },
) {
  const baseURL = process.env.SMBA_REGISTRATION_RESILIENCE_BASE_URL!
  const context = await browser.newContext({ baseURL, viewport: { height: 844, width: 390 } })
  const page = await context.newPage()
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if ("pin" in factor) await page.getByRole("button", { name: "6-digit PIN" }).click()
  await page.getByLabel("Academy ID").fill(academyId)
  await page.getByLabel("pin" in factor ? "6-digit PIN" : "Password").fill(
    "pin" in factor ? factor.pin : factor.password,
  )
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/player"), { timeout: 20_000 })
  await context.close()
}

test("a player completes code-free browser activation, optional PIN, and password fallback", async ({ browser, page }) => {
  const fullName = "Browser Claim Activation Player"
  const password = "A durable browser password!"
  const pin = "246810"
  await openRegistration(page)
  await page.getByLabel("Full name").fill(fullName)
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByRole("heading", { name: "Registration received." })).toBeVisible()
  await page.getByRole("link", { name: "View activation status" }).click()
  await expect(page.getByRole("heading", { name: "Approval is pending." })).toBeVisible()

  const wrongBrowser = await browser.newContext({
    baseURL: process.env.SMBA_REGISTRATION_RESILIENCE_BASE_URL!,
    viewport: { height: 844, width: 390 },
  })
  const wrongBrowserPage = await wrongBrowser.newPage()
  await wrongBrowserPage.goto("/activate", { waitUntil: "domcontentloaded" })
  await expect(wrongBrowserPage.getByRole("heading", { name: "Open your account." })).toBeVisible()
  await wrongBrowser.close()

  const account = registrationRows(fullName)[0]
  expect(account).toBeTruthy()
  const coach = await loginAsHeadCoach(browser)
  await coach.page.goto(`/coach/onboarding?player=${encodeURIComponent(account.id)}`, {
    waitUntil: "domcontentloaded",
  })
  await coach.page.getByRole("button", { name: "Approve & continue" }).click()
  await expect(
    coach.page.getByRole("status").filter({ hasText: /approved as SMBA-PL-[0-9]{4}/u }),
  ).toContainText(/approved as SMBA-PL-[0-9]{4}/u)
  await expect(coach.page.getByRole("button", { name: "Copy ID" })).toHaveCount(0)
  await coach.context.close()

  await expect.poll(() => registrationRows(fullName)[0]?.approvalStatus).toBe("approved")
  const academyId = academyIdFor(account.id)
  expect(academyId).toMatch(/^SMBA-PL-[0-9]{4}$/u)
  expect(credentialEvidence(account.id).activationCodeCount).toBe(0)

  await page.goto("/activate", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: "Verify your recovery email." })).toBeVisible()
  await expect(page.getByLabel("Your Academy ID")).toHaveValue(academyId!)
  await expect(page.getByText("Save this ID. You will use it every time you sign in.")).toBeVisible()
  markRecoveryEmailVerified(account.id, "browser-claim-player@example.com")
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: "Create your password." })).toBeVisible()
  await expect(page.getByLabel("Academy ID")).toHaveValue(academyId!)
  await page.getByLabel("Create password").fill(password)
  await page.getByLabel("Confirm password").fill(password)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname === "/auth/pin/setup", { timeout: 20_000 })
  await page.getByLabel("Enter PIN").fill(pin)
  await page.getByLabel("Confirm PIN").fill(pin)
  await page.getByRole("button", { name: "Set up PIN" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/player"), { timeout: 20_000 })

  const evidence = credentialEvidence(account.id)
  expect(evidence.claim?.consumedAt).not.toBeNull()
  expect(evidence.claim?.tokenHash).toMatch(/^[0-9a-f]{64}$/u)
  expect(evidence.pin?.pinHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/u)
  await loginAsActivatedPlayer(browser, academyId!, { pin })
  await loginAsActivatedPlayer(browser, academyId!, { password })
})

test("a assistant coach is approved from Academy onboarding and activates staff access", async ({ browser, page }) => {
  const fullName = "Browser Claim Junior Coach"
  const password = "A durable junior password!"
  const pin = "975310"
  await openRegistration(page)
  await page.getByLabel("Account type").selectOption("coach")
  await page.getByLabel("Full name").fill(fullName)
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByRole("heading", { name: "Registration received." })).toBeVisible()
  await page.getByRole("link", { name: "View activation status" }).click()
  await expect(page.getByRole("heading", { name: "Approval is pending." })).toBeVisible()

  const account = registrationRows(fullName)[0]
  expect(account).toMatchObject({ approvalStatus: "pending", requestedRole: "coach" })
  const coach = await loginAsHeadCoach(browser)
  await coach.page.goto(`/coach/onboarding?player=${encodeURIComponent(account.id)}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(coach.page.getByText("Review Browser’s staff request")).toBeVisible()
  await coach.page.getByRole("button", { name: "Approve staff access" }).click()
  await expect(coach.page.getByRole("status").filter({
    hasText: /approved as SMBA-JC-[0-9]{4}/u,
  }))
    .toContainText(/approved as SMBA-JC-[0-9]{4}/u)
  await coach.context.close()

  await expect.poll(() => registrationRows(fullName)[0]?.approvalStatus).toBe("approved")
  const academyId = academyIdFor(account.id)
  expect(academyId).toMatch(/^SMBA-JC-[0-9]{4}$/u)
  await page.goto("/activate", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: "Verify your recovery email." })).toBeVisible()
  await expect(page.getByLabel("Your Academy ID")).toHaveValue(academyId!)
  markRecoveryEmailVerified(account.id, "browser-claim-junior@example.com")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByLabel("Create password").fill(password)
  await page.getByLabel("Confirm password").fill(password)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname === "/auth/pin/setup", { timeout: 20_000 })
  await page.getByLabel("Enter PIN").fill(pin)
  await page.getByLabel("Confirm PIN").fill(pin)
  await page.getByRole("button", { name: "Set up PIN" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Personal roll-call ledger" })).toBeVisible()
})
