import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const css = readFileSync(
  path.join(process.cwd(), "components/coach/onboarding/player-onboarding-register.module.css"),
  "utf8",
)

/*
 * The chosen chip, switch side, plan card, day tile and schedule card were told
 * apart only by their fill, which Windows high-contrast mode throws away.
 */
describe("onboarding choices in high-contrast mode", () => {
  it("draws the chosen option, filter and current step in the system highlight", () => {
    const block = css.slice(css.indexOf("@media (forced-colors: active)"))

    expect(block).toContain(":is(.chips, .switch, .cards, .days) label:has(:checked)")
    expect(block).toContain('.filters button[aria-pressed="true"]')
    expect(block).toContain(".stepRail .currentStep")
    expect(block).toMatch(/forced-color-adjust: none;\s+background: Highlight;\s+color: HighlightText;/u)
  })
})
