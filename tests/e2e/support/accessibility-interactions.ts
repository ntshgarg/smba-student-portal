import { expect, type Locator, type Page } from "@playwright/test"

import type { AccessibilityInteraction } from "./accessibility-matrix"

async function clickFirstVisible(locator: Locator) {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)
      && await candidate.isEnabled().catch(() => false)) {
      await candidate.scrollIntoViewIfNeeded()
      await candidate.click()
      return candidate
    }
  }
  throw new Error("The interaction did not find an enabled, visible control.")
}

export async function executeAccessibilityInteraction(
  page: Page,
  interaction: AccessibilityInteraction,
) {
  switch (interaction) {
    case "account-security-errors": {
      await clickFirstVisible(page.getByRole("button", { name: "Change password" }))
      break
    }
    case "attendance-session-open": {
      const initialUrl = page.url()
      const selectedSession = await clickFirstVisible(page.locator(
        '.attendance-occurrence-list > button[aria-controls="attendance-roster-panel"]:not([disabled])',
      ))
      await page.waitForURL((url) => url.href !== initialUrl
        && Boolean(url.searchParams.get("occurrence")), { timeout: 10_000 })
      await expect(selectedSession).toHaveAttribute("aria-expanded", "true")
      await expect(page.locator("#attendance-roster-panel")).toHaveClass(/has-selection/u)
      break
    }
    case "authenticator-recovery-queue": {
      await page.getByRole("heading", { name: "Authenticator recovery" })
        .waitFor({ state: "visible" })
      break
    }
    case "calendar-session-open": {
      await clickFirstVisible(page.locator('.coach-day-session > button[aria-expanded="false"]'))
      break
    }
    case "financial-player-open": {
      await clickFirstVisible(page.getByRole("link", { name: /View fee record for/u }))
      await page.waitForLoadState("domcontentloaded")
      break
    }
    case "login-error": {
      await page.getByLabel("SMBA username").fill("invalid")
      await page.getByRole("button", { name: "Continue" }).click()
      await page.locator('[role="alert"]').first().waitFor({ state: "visible" })
      break
    }
    case "login-pin": {
      await page.getByRole("button", { name: "6-digit PIN" }).click()
      break
    }
    case "member-details-open": {
      await clickFirstVisible(page.getByRole("button", { name: "Details", exact: true }))
      break
    }
    case "member-filters-open": {
      const toggle = page.locator(".coach-member-filter-toggle")
      if (await toggle.isVisible().catch(() => false)
        && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click()
      break
    }
    case "mobile-navigation-open": {
      const trigger = page.getByRole("button", { name: "Open navigation" })
      if (await trigger.isVisible().catch(() => false)) await trigger.click()
      break
    }
    case "onboarding-first-open": {
      await clickFirstVisible(page.getByRole("link", { name: /^(Open|Continue)$/u }))
      break
    }
    case "player-announcement-open": {
      await clickFirstVisible(page.getByRole("link", { name: /Read announcement:/u }))
      await page.waitForLoadState("domcontentloaded")
      break
    }
    case "player-report-open": {
      await clickFirstVisible(page.locator('button[aria-expanded="false"]'))
      break
    }
    case "profile-menu-open": {
      await page.getByRole("button", { name: /Open account menu/u }).click()
      break
    }
    case "register-error": {
      await page.getByRole("button", { name: "Request registration" }).click()
      await page.locator('[role="alert"]').first().waitFor({ state: "visible" })
      break
    }
    case "register-junior-coach": {
      await page.getByLabel("Account type").selectOption("coach")
      break
    }
    case "report-preview-open": {
      const trigger = page.getByRole("button", { name: "Preview", exact: true })
      await trigger.evaluate((element) => element.setAttribute("data-accessibility-dialog-opener", "true"))
      await trigger.click()
      await page.locator("dialog[open]").waitFor({ state: "visible" })
      break
    }
    case "search-admin-directory": {
      const search = page.getByLabel("Search accounts")
      if (await search.count()) await search.fill("coach")
      break
    }
  }
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  }))
}
