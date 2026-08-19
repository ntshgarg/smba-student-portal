import { expect, test } from "@playwright/test"
import type { Browser, Page } from "@playwright/test"

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
) {
  const context = await browser.newContext({ baseURL, viewport: { height: 844, width: 390 } })
  const page = await context.newPage()
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.getByLabel("SMBA username").fill(academyId)
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
  return { context, page }
}

async function verifyLoginRoute(
  browser: Browser,
  baseURL: string,
  academyId: string,
  destination: "/coach" | "/player",
) {
  const { context } = await loginAs(browser, baseURL, academyId, destination)
  await context.close()
}

test("shared password and PIN login remains contained in all three views", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto("/login", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible()
    await expect(page.getByLabel("SMBA username")).toBeVisible()
    await expect(page.getByLabel("Password")).toBeVisible()
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

test("registration, activation and recovery surfaces remain contained in all three views", async ({ page }) => {
  const surfaces = [
    { heading: "Join the portal.", path: "/register" },
    { heading: "Open your account.", path: "/activate" },
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

test("password login routes head coach, junior coach, and player independently", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL)
  await verifyLoginRoute(browser, baseURL, "SMBA-HC-0001", "/coach")
  await verifyLoginRoute(browser, baseURL, "SMBA-JC-0001", "/coach")
  await verifyLoginRoute(browser, baseURL, "SMBA-PL-0001", "/player")
})

test("Account security offers PIN to academy accounts", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL)
  const head = await loginAs(browser, baseURL, "SMBA-HC-0001", "/coach")
  await head.page.goto("/account/security", { waitUntil: "networkidle" })
  await expect(head.page.getByRole("heading", { name: "Account security." })).toBeVisible()
  await expect(head.page.getByRole("heading", { name: /(?:Add a 6-digit|Change(?: or remove)?) PIN/u })).toBeVisible()
  await expect(head.page.getByRole("heading", { name: "Add an authenticator app" })).toBeVisible()
  await head.context.close()

  for (const actor of [
    { academyId: "SMBA-JC-0001", destination: "/coach" as const },
    { academyId: "SMBA-PL-0001", destination: "/player" as const },
  ]) {
    const session = await loginAs(browser, baseURL, actor.academyId, actor.destination)
    await session.page.goto("/account/security", { waitUntil: "networkidle" })
    await expect(session.page.getByRole("heading", { name: /(?:Add a 6-digit|Change(?: or remove)?) PIN/u })).toBeVisible()
    await expect(session.page.getByRole("heading", { name: "Add an authenticator app" })).toHaveCount(0)
    await session.context.close()
  }
})
