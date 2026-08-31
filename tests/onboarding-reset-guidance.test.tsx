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

  it("holds back the fee timeline until an amount is entered, and says so visually", () => {
    const html = render(player())
    const submit = /<button[^>]*type="submit"[^>]*>/u.exec(html)?.[0]
    expect(submit).toBeDefined()
    expect(html).toContain("Review fee timeline")
    expect(submit).toContain("disabled")
    // The faded fill is keyed off this, and `cursor: wait` is not -- a coach must
    // not be shown a spinner cursor for something only they can unblock.
    expect(submit).toContain('data-blocked="true"')
  })
})

const { AssessmentStep } = await import("@/components/coach/onboarding/register/assessment-step")

/*
 * The same rule across every step: an action whose prerequisites are unmet is held
 * back and drawn as unavailable, rather than offered and then refused. Each step's
 * submit handler keeps its own validation -- these pin the affordance.
 */
describe("onboarding stage gating", () => {
  function assessment(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      <AssessmentStep
        item={{
          academyPlan: null,
          batch: null,
          feePlanRecorded: false,
          fullName: "Aditi Rao",
          id: "player-2",
          level: null,
          recordRevision: 1,
          trainingStartOn: null,
          ...overrides,
        } as never}
        onSuccess={() => {}}
      />,
    )
  }

  it("holds back the assessment until every classification field is set", () => {
    const submit = /<button[^>]*type="submit"[^>]*>/u.exec(assessment())?.[0]
    expect(submit).toBeDefined()
    expect(submit).toContain("disabled")
    expect(submit).toContain('data-blocked="true"')
  })

  it("releases it once the date, level, batch and plan are all present", () => {
    const html = assessment({
      academyPlan: "weekend-standard",
      batch: "Weekend",
      level: "Intermediate",
      trainingStartOn: "2026-07-01",
    })
    const submit = /<button[^>]*type="submit"[^>]*>/u.exec(html)?.[0]
    expect(submit).not.toContain("disabled")
    expect(submit).not.toContain("data-blocked")
  })

  it("still holds it back when only the training start date is missing", () => {
    const html = assessment({
      academyPlan: "weekend-standard",
      batch: "Weekend",
      level: "Intermediate",
    })
    expect(/<button[^>]*type="submit"[^>]*>/u.exec(html)?.[0]).toContain('data-blocked="true"')
  })
})
