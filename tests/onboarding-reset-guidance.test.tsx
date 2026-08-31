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

const { FeePlanStep } = await import("@/components/coach/onboarding/register/fee-plan-step")

/*
 * The register renders one step per player, chosen from `item.stage`, and the step
 * rail is a plain list rather than navigation. So once a session is assigned the
 * Assessment step -- the only place the training start date can be edited -- is no
 * longer reachable. The way back is resetOnboardingSessionAssignment, which deletes
 * the assignment and clears trainingStartConfirmedAt, returning the player to the
 * assessment stage. Nothing said so, and the button is labelled for the assignment
 * rather than for the date, so a coach who confirmed the wrong date read it as
 * permanent. These cases pin the signpost.
 */
function player(overrides: Record<string, unknown> = {}) {
  return {
    academyPlan: "weekend-standard",
    batch: "Weekend",
    feePlanRecorded: false,
    fullName: "Aditi Rao",
    id: "player-1",
    level: "Intermediate",
    trainingStartOn: "2026-07-01",
    ...overrides,
  } as never
}

function render(item: never) {
  return renderToStaticMarkup(
    <FeePlanStep
      financeActive
      item={item}
      onSuccess={() => {}}
      referenceDate="2026-09-01"
    />,
  )
}

describe("onboarding reset guidance", () => {
  it("says resetting the assignment is what reopens the training start date", () => {
    const html = render(player())
    expect(html).toContain("Reset session assignment")
    expect(html).toContain("reopens")
    expect(html).toContain("training start date")
  })

  it("names the condition that makes the reset stop working", () => {
    // resetOnboardingSessionAssignment refuses once dependent academy records exist,
    // so promising an unconditional way back would be a lie.
    expect(render(player())).toContain("academy records")
  })

  it("also signposts it on the future-training-date panel, which offers the same reset", () => {
    // That panel renders instead of the fee form and carries its own reset button.
    const html = render(player({ trainingStartOn: "2026-12-01" }))
    expect(html).toContain("Fee completion opens on")
    expect(html).toContain("Reset session assignment")
    expect(html).toContain("training start date can be changed")
  })
})
