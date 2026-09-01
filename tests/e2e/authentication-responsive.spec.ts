import type { Browser, Page, TestInfo } from "@playwright/test"

import { expect, stageFailureEvidence, test } from "./support/failure-evidence"

const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

const viewports = [
  { height: 900, label: "web", width: 1440 },
  { height: 1024, label: "tablet", width: 820 },
  { height: 844, label: "mobile", width: 390 },
] as const

async function expectNoDocumentOverflow(page: Page, label: string) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(width.scroll, `${label} login widened the document`).toBeLessThanOrEqual(width.client + 1)
}

async function loginAs(
  browser: Browser,
  baseURL: string,
  academyId: string,
  destination: "/coach" | "/player",
  testInfo?: TestInfo,
) {
  const context = await browser.newContext({ baseURL, viewport: { height: 844, width: 390 } })
  const page = await context.newPage()
  try {
    await page.goto("/login", { waitUntil: "networkidle" })
    await page.getByLabel("Academy ID").fill(academyId)
    await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
    await page.getByRole("button", { name: "Continue" }).click()
    await page.waitForURL((url) => (
      url.pathname.startsWith(destination) || url.pathname === "/auth/pin/setup"
    ), { timeout: 20_000 })
    if (new URL(page.url()).pathname === "/auth/pin/setup") {
      await page.getByLabel("Enter PIN").fill("246810")
      await page.getByLabel("Confirm PIN").fill("246810")
      await page.getByRole("button", { name: "Set up PIN" }).click()
      await page.waitForURL((url) => url.pathname.startsWith(destination), { timeout: 20_000 })
    }
  } catch (error) {
    if (testInfo) await stageFailureEvidence(page, testInfo, [], error).catch(() => undefined)
    await context.close()
    throw error
  }
  return { context, page }
}

async function verifyLoginRoute(
  browser: Browser,
  baseURL: string,
  academyId: string,
  destination: "/coach" | "/player",
  testInfo: TestInfo,
) {
  const { context } = await loginAs(browser, baseURL, academyId, destination, testInfo)
  await context.close()
}

test("shared password and PIN login remains contained in all three views", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto("/login", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible()
    await expect(page.getByLabel("Academy ID")).toBeVisible()
    const password = page.getByLabel("Password")
    await expect(password).toBeVisible()
    await expect(password).toHaveAttribute("type", "password")
    await page.getByRole("button", { name: "Reveal entered characters" }).click()
    await expect(password).toHaveAttribute("type", "text")
    await expect(page.getByRole("button", { name: "Mask entered characters" })).toBeVisible()
    await page.getByRole("button", { name: "Mask entered characters" }).click()
    await expect(password).toHaveAttribute("type", "password")
    await expectNoDocumentOverflow(page, viewport.label)

    await page.getByRole("button", { name: "6-digit PIN" }).click()
    const pin = page.getByLabel("6-digit PIN")
    await expect(pin).toBeVisible()
    await expect(pin).toHaveAttribute("inputmode", "numeric")
    await expect(pin).toHaveAttribute("minlength", "6")
    await expect(pin).toHaveAttribute("maxlength", "6")
    await expectNoDocumentOverflow(page, `${viewport.label} PIN`)

    await page.getByRole("button", { name: "Password" }).click()
    await expect(page.getByLabel("Password")).toBeVisible()
  }
})

/*
 * Both halves of this belong in a browser rather than in a unit test, because
 * both are browser behaviour rather than component logic: React resets a form
 * once its action settles, and switching the login method unmounts one form
 * type and mounts another. A rendered-markup assertion sees neither.
 *
 * The refused attempt deliberately uses a well-formed Academy ID that no
 * fixture issues. `attemptKeys` in lib/auth/credential-service.ts meters
 * `subject:` at 5 failures and `ip:` at 20 in a 15-minute window, so spending
 * one on a subject nothing else in this suite signs in as leaves every real
 * account's budget untouched.
 */
test("a refused sign-in and a method switch both keep the Academy ID", async ({ page }) => {
  const unissuedAcademyId = "SMBA-PL-9999"
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.getByLabel("Academy ID").fill(unissuedAcademyId)

  await page.getByRole("button", { name: "6-digit PIN" }).click()
  await expect(page.getByLabel("Academy ID")).toHaveValue(unissuedAcademyId)
  await page.getByRole("button", { name: "Password" }).click()
  await expect(page.getByLabel("Academy ID")).toHaveValue(unissuedAcademyId)

  await page.getByLabel("Password").fill("not the stored password")
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.locator("#academy-id-error")).toContainText("incorrect")
  await expect(page.getByLabel("Academy ID")).toHaveValue(unissuedAcademyId)
  // The password is the one field the reset should still be clearing.
  await expect(page.getByLabel("Password")).toHaveValue("")
})

test("registration, activation and recovery surfaces remain contained in all three views", async ({ page }) => {
  const surfaces = [
    { heading: "Join the portal.", path: "/register" },
    // A browser with no receipt now gets the status lookup rather than a dead end.
    { heading: "Check your status.", path: "/activate" },
    { heading: "Reset your password.", path: "/recover" },
    { heading: "This recovery link is unavailable.", path: "/recover/reset" },
    { heading: "Recover protected access.", path: "/auth/two-factor/recovery" },
  ]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const surface of surfaces) {
      await page.goto(surface.path, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: surface.heading })).toBeVisible()
      await expectNoDocumentOverflow(page, `${viewport.label} ${surface.path}`)
    }
  }
})

test("password login routes head coach, assistant coach, and player independently", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL)
  await verifyLoginRoute(browser, baseURL, "SMBA-HC-0001", "/coach", testInfo)
  await verifyLoginRoute(browser, baseURL, "SMBA-JC-0001", "/coach", testInfo)
  await verifyLoginRoute(browser, baseURL, "SMBA-PL-0001", "/player", testInfo)
})

test("Account security offers PIN to academy accounts", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL)
  const head = await loginAs(browser, baseURL, "SMBA-HC-0001", "/coach", testInfo)
  await head.page.goto("/account/security", { waitUntil: "networkidle" })
  await expect(head.page.getByRole("heading", { name: "Account security." })).toBeVisible()
  await expect(head.page.getByRole("heading", { name: /(?:Add a 6-digit|Change(?: or remove)?) PIN/u })).toBeVisible()
  await expect(head.page.getByRole("heading", { name: "Add an authenticator app" })).toBeVisible()
  await head.context.close()

  for (const actor of [
    { academyId: "SMBA-JC-0001", destination: "/coach" as const },
    { academyId: "SMBA-PL-0001", destination: "/player" as const },
  ]) {
    const session = await loginAs(browser, baseURL, actor.academyId, actor.destination, testInfo)
    await session.page.goto("/account/security", { waitUntil: "networkidle" })
    await expect(session.page.getByRole("heading", { name: /(?:Add a 6-digit|Change(?: or remove)?) PIN/u })).toBeVisible()
    await expect(session.page.getByRole("heading", { name: "Add an authenticator app" })).toHaveCount(0)
    await session.context.close()
  }
})
