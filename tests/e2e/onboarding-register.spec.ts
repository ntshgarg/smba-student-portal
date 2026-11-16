import { expect, test } from "./support/failure-evidence"

const viewports = [
  { height: 1000, name: "web", width: 1440 },
  { height: 1024, name: "tablet", width: 820 },
  { height: 844, name: "mobile", width: 390 },
] as const
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname.startsWith("/coach")) return
  await page.getByLabel("Academy ID").fill("SMBA-HC-0001")
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => (
    url.pathname === "/auth/pin/setup" || url.pathname.startsWith("/coach")
  ))
  if (new URL(page.url()).pathname === "/auth/pin/setup") {
    await page.getByLabel("Enter PIN").fill("739251")
    await page.getByLabel("Confirm PIN").fill("739251")
    await page.getByRole("button", { name: "Set up PIN" }).click()
    await page.waitForURL((url) => url.pathname.startsWith("/coach"))
  }
}

test("Onboarding is readable and contained at all three views", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await loginAsCoach(page)

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto("/coach/onboarding", { waitUntil: "networkidle" })
    await page.evaluate(() => document.fonts.ready)

    await expect(page.getByRole("heading", { name: "Onboarding", level: 1 })).toBeVisible()
    await expect(page.getByRole("group", { name: "Show people at a stage" }).getByRole("button")).toHaveCount(5)

    const firstCase = page.getByRole("list", { name: "People needing a next step" })
      .locator("a[href*='player=']").first()
    if (await firstCase.count()) {
      if (await firstCase.getAttribute("aria-expanded") !== "true") await firstCase.click()
      await expect(page.locator("[role='region'][id^='onboarding-editor-']")).toBeVisible()
    }

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`onboarding-implemented-${viewport.name}.png`),
    })
  }

  expect(consoleErrors).toEqual([])
})
