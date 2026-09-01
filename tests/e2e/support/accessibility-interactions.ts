import { expect, type Locator, type Page } from "@playwright/test"

import type { AccessibilityInteraction } from "./accessibility-matrix"

export async function firstVisible(
  locator: Locator,
  matches: (candidate: Locator) => Promise<boolean> = async () => true,
) {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)
      && await candidate.isEnabled().catch(() => false)
      && await matches(candidate).catch(() => false)) {
      await candidate.scrollIntoViewIfNeeded()
      return candidate
    }
  }
  throw new Error("The interaction did not find an enabled, visible control.")
}

async function clickFirstVisible(locator: Locator) {
  const candidate = await firstVisible(locator)
  await candidate.click()
  return candidate
}

// The audit only checks that closing a dialog restores focus when it can identify
// the trigger, which it does through this attribute. Marking the trigger here
// keeps that check available to every dialog state rather than just one.
async function openDialogFrom(trigger: Locator) {
  await trigger.evaluate((element) => {
    element.setAttribute("data-accessibility-dialog-opener", "true")
  })
  await trigger.click()
  await trigger.page().locator("dialog[open]").waitFor({ state: "visible" })
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
    case "announcement-review-open": {
      // The composer only opens the dialog once a title, a message and one
      // destination are present, so the audited state has to be typed first.
      await page.getByRole("textbox", { name: "Title" })
        .fill("Accessibility review dialog announcement")
      await page.getByRole("textbox", { name: "Message" })
        .fill("The audit opens the review dialog to check its focus handling.")
      await page.getByRole("checkbox", { name: "Homepage" }).check()
      await openDialogFrom(page.getByRole("button", { name: "Review announcement" }))
      break
    }
    case "announcement-withdraw-open": {
      // Scoped to the detail panel because the dialog it opens carries a button
      // with the same accessible name.
      await openDialogFrom(
        page.locator("article").getByRole("button", { name: "Withdraw announcement" }),
      )
      break
    }
    case "attendance-session-open": {
      const initialUrl = page.url()
      const selectedSession = await firstVisible(
        page.locator(
          '.attendance-occurrence-list > button[aria-controls="attendance-roster-panel"]:not([disabled])',
        ),
        async (candidate) => await candidate.getAttribute("aria-expanded") === "false",
      )
      await selectedSession.click()
      await expect.poll(() => {
        const url = new URL(page.url())
        return url.href !== initialUrl && Boolean(url.searchParams.get("occurrence"))
      }, { timeout: 10_000 }).toBe(true)
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
      await page.getByLabel("Academy ID").fill("invalid")
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
      // The submit is "Send code" now: registration writes nothing until the
      // emailed code comes back, so the first press asks for one.
      await page.getByRole("button", { name: "Send code" }).click()
      await page.locator('[role="alert"]').first().waitFor({ state: "visible" })
      break
    }
    case "register-junior-coach": {
      // The id and the option value both stay `coach` -- only the label and the
      // word a person reads changed.
      await page.getByLabel("I am registering a").selectOption("coach")
      break
    }
    case "report-preview-open": {
      await openDialogFrom(page.getByRole("button", { name: "Preview", exact: true }))
      break
    }
    case "report-publication-open": {
      // Publications get random ids, so the detail page is reached by opening one
      // from the archive. A report with several revisions renders the most.
      const withHistory = page.getByRole("link", { name: /latest revision [2-9]/u })
      await clickFirstVisible(await withHistory.count()
        ? withHistory
        : page.getByRole("link", { name: /^Open report for/u }))
      await page.waitForLoadState("domcontentloaded")
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
