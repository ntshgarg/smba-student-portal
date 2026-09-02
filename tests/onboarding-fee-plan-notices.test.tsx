import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/coach/financials/actions", () => ({
  completeOnboardingFinanceAction: vi.fn(),
  previewOnboardingFinanceAction: vi.fn(),
}))

vi.mock("@/app/coach/onboarding/actions", () => ({
  resetOnboardingSessionAssignmentAction: vi.fn(),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: vi.fn(() => true),
    confirmNavigation: vi.fn(() => true),
    navigateAfterCommit: (navigate: () => void) => navigate(),
  }),
}))

import {
  FeePreviewBlockers,
  FeePreviewWarnings,
} from "@/components/coach/onboarding/register/fee-plan-step"

/**
 * The list a coach must clear before onboarding can be completed. It is only
 * reachable inside the step after a preview action returns, which no static
 * render can drive, so until now nothing exercised it at all -- not a unit test,
 * not the browser suites, not the accessibility matrix. Rendering the two
 * notices on their own is what makes that possible.
 */
describe("what a fee preview refuses to let past", () => {
  it("announces the blockers rather than leaving them to be noticed", () => {
    const markup = renderToStaticMarkup(
      <FeePreviewBlockers blockers={["Assign a matching session before completing fees."]} />,
    )

    // role="alert" and the wording carry this, never the colour: the styling
    // marks it with red type, and a coach who cannot see that still gets told.
    expect(markup).toContain('role="alert"')
    expect(markup).toContain("Resolve before completion")
    expect(markup).toContain("Assign a matching session before completing fees.")
  })

  it("lists every blocker, not just the first", () => {
    const markup = renderToStaticMarkup(
      <FeePreviewBlockers
        blockers={[
          "Assign a matching session before completing fees.",
          "An existing Fee Plan must be resolved in the finance record.",
        ]}
      />,
    )

    expect(markup.match(/<li>/gu)).toHaveLength(2)
  })

  it("renders nothing when there is nothing to resolve", () => {
    // The step swaps this block for the confirmation checkbox, so an empty
    // blocker list must not leave an empty alert sitting above it.
    expect(renderToStaticMarkup(<FeePreviewBlockers blockers={[]} />)).toBe("")
    expect(renderToStaticMarkup(<FeePreviewWarnings warnings={[]} />)).toBe("")
  })

  it("escapes a blocker that arrives carrying markup", () => {
    const markup = renderToStaticMarkup(
      <FeePreviewBlockers blockers={["<img src=x onerror=alert(1)>"]} />,
    )

    expect(markup).not.toContain("<img")
    expect(markup).toContain("&lt;img")
  })

  it("keeps warnings advisory: no alert role, no blocking wording", () => {
    const markup = renderToStaticMarkup(
      <FeePreviewWarnings warnings={["The first month is partly billed."]} />,
    )

    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain("Resolve before completion")
    expect(markup).toContain("The first month is partly billed.")
  })
})
