import path from "node:path"

import type { Page } from "@playwright/test"

// Not "@playwright/test": the harness stages the masked failure evidence the
// browser job uploads. See playwright.responsive-overflow.config.ts.
import { expect, test } from "./support/failure-evidence"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const PLAYER_ACADEMY_ID = process.env.SMBA_CAPTURE_PLAYER_ACADEMY_ID ?? "SMBA-PL-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function login(page: Page, academyId: string, routePrefix: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("SMBA username").fill(academyId)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith(routePrefix), { timeout: 20_000 })
}

async function expectDomIntegrity(page: Page) {
  const result = await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter(Boolean)
    const describedByMissing = [...document.querySelectorAll<HTMLElement>("[aria-describedby]")]
      .flatMap((element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/u))
      .filter((id) => id && !document.getElementById(id))
    const headings = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")]
      .filter((heading) => {
        const style = getComputedStyle(heading)
        return style.display !== "none" && style.visibility !== "hidden"
      })
      .map((heading) => Number(heading.tagName.slice(1)))

    return {
      describedByMissing,
      duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
      headingSkips: headings.filter((level, index) => index > 0 && level > headings[index - 1] + 1),
    }
  })

  expect(result.duplicateIds).toEqual([])
  expect(result.describedByMissing).toEqual([])
  expect(result.headingSkips).toEqual([])
}

async function expectNoAxeViolations(page: Page) {
  await page.addScriptTag({
    path: path.join(process.cwd(), "node_modules/axe-core/axe.min.js"),
  })
  const violations = await page.evaluate(async () => {
    const axe = (window as typeof window & {
      axe: {
        run: (
          root: Document,
          options: unknown,
        ) => Promise<{ violations: Array<{ id: string; impact: string | null }> }>
      }
    }).axe
    const result = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    })
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
    }))
  })

  expect(violations).toEqual([])
}

async function expectNoDocumentOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1)
}

test("public navigation exposes disclosure semantics and restores keyboard focus", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto("/", { waitUntil: "networkidle" })

  const trigger = page.getByRole("button", { name: "Open navigation" })
  await expect(trigger).not.toHaveAttribute("aria-haspopup")
  await trigger.click()
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expectDomIntegrity(page)
  await expectNoAxeViolations(page)
  await expectNoDocumentOverflow(page)
})

test("player report hierarchy remains screen-reader navigable", async ({ page }) => {
  await login(page, PLAYER_ACADEMY_ID, "/player")
  await page.goto("/player/reports", { waitUntil: "networkidle" })

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.locator(".report-year-group > h2").first()).toBeVisible()
  await expectDomIntegrity(page)
  await expectNoAxeViolations(page)
})

test("attendance date labels meet contrast and the register stays viewport-contained", async ({ page }) => {
  await login(page, COACH_ACADEMY_ID, "/coach")
  await page.goto(
    "/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner",
    { waitUntil: "networkidle" },
  )
  await expect(page.locator(".coach-register-table")).toBeVisible()

  const contrastRatios = await page.locator(
    ".coach-register-date-row th.is-unavailable",
  ).evaluateAll((headers) => {
    const rgb = (value: string) => {
      const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0]
      return channels.map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      })
    }
    const ratio = (foreground: string, background: string) => {
      const foregroundLuminance = rgb(foreground)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      const backgroundLuminance = rgb(background)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    return headers.flatMap((header) => {
      const headerStyle = getComputedStyle(header)
      const date = header.querySelector("strong")
      const dateStyle = date ? getComputedStyle(date) : null
      return [
        ratio(headerStyle.color, headerStyle.backgroundColor),
        ...(dateStyle ? [ratio(dateStyle.color, headerStyle.backgroundColor)] : []),
      ]
    })
  })

  expect(contrastRatios.length).toBeGreaterThan(0)
  expect(Math.min(...contrastRatios)).toBeGreaterThanOrEqual(4.5)
  await expectDomIntegrity(page)
  await expectNoAxeViolations(page)

  for (const viewport of [
    { height: 568, width: 320 },
    { height: 800, width: 360 },
    { height: 844, width: 390 },
    { height: 932, width: 430 },
    { height: 390, width: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await expectNoDocumentOverflow(page)
  }
})
