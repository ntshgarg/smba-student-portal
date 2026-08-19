import path from "node:path"
import { expect, test } from "@playwright/test"

const SCREENSHOT_DIR = "/Users/nitishg/.codex/visualizations/2026/08/10/019fecfa-5069-7a21-9efb-a4976db01af9"
const viewports = [
  { height: 1000, name: "web", width: 1440 },
  { height: 1024, name: "tablet", width: 820 },
  { height: 844, name: "mobile", width: 390 },
] as const
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return
  await page.getByLabel("SMBA username").fill("SMBA-HC-0001")
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"))
}

test("Player Onboarding register is readable and contained at all three views", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await loginAsCoach(page)

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto("/coach/onboarding", { waitUntil: "networkidle" })
    await page.evaluate(() => document.fonts.ready)

    await expect(page.getByRole("heading", { name: "Player intake register." })).toBeVisible()
    await expect(page.getByRole("region", { name: "Onboarding stage totals" }).locator(":scope > div")).toHaveCount(4)
    await expect(page.getByRole("heading", { name: "Players needing action" })).toBeVisible()

    const firstExpander = page.locator("a[aria-controls^='onboarding-editor-']").first()
    if (await firstExpander.count()) {
      await firstExpander.click()
      await expect(page.locator("[role='region'][id^='onboarding-editor-']")).toBeVisible()
    }

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)

    await page.screenshot({
      fullPage: true,
      path: path.join(SCREENSHOT_DIR, `onboarding-implemented-${viewport.name}.png`),
    })
  }

  expect(consoleErrors).toEqual([])
})
