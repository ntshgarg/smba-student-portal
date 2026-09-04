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
 * The training start date lives on the Session step now, with the schedule that
 * bounds it, and the rail reaches that step from anywhere -- so correcting a date
 * destroys nothing. Reset remains the only way to change the *classification*
 * under an open assignment (lib/coach/onboarding-service.ts), and it is still
 * refused once the player has attendance, fees or a report on record, so the
 * signpost these cases pin still matters. It just no longer claims to be the
 * only door, and no longer claims to be the door to the date.
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
  it("sends a date correction to the Session step and keeps reset for the classification", () => {
    /*
     * This used to assert that reset "reopens" the assessment because that was
     * the only door to the date. The date is not on the assessment any more, so
     * pointing a coach at a destructive reset to change it would send them down
     * a path that is both unnecessary and, once records exist, closed.
     */
    const html = render(player())
    expect(html).toContain("Reset session assignment")
    expect(html).toContain("set on the Session step")
    expect(html).toContain("level, batch or Training plan")
    expect(html).not.toContain("no other way back")
  })

  it("names the condition that makes the reset stop working", () => {
    // resetOnboardingSessionAssignment refuses once dependent academy records exist,
    // so promising an unconditional way back would be a lie.
    expect(render(player())).toContain("attendance, fees or a report on record")
  })

  it("also signposts it on the future-training-date panel, which offers the same reset", () => {
    // That panel renders instead of the fee form and carries its own reset button.
    const html = render(player({ trainingStartOn: "2026-12-01" }))
    expect(html).toContain("Fee completion opens on")
    expect(html).toContain("Reset session assignment")
    expect(html).toContain("go back to Session on the step list")
  })

  it("holds back the fee timeline until an amount is entered, and says so visually", () => {
    const html = render(player())
    const submit = /<button[^>]*type="submit"[^>]*>/u.exec(html)?.[0]
    expect(submit).toBeDefined()
    expect(html).toContain("Review fee timeline")
    expect(submit).toContain('aria-disabled="true"')
    // Held by aria-disabled, NOT the disabled attribute: a disabled button leaves
    // the tab order, so the coach cannot reach it to learn why it is held.
    expect(submit).not.toMatch(/\sdisabled/u)
    // The faded fill is keyed off this, and `cursor: wait` is not -- a coach must
    // not be shown a spinner cursor for something only they can unblock.
    expect(submit).toContain('aria-disabled="true"')
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
    expect(submit).toContain('aria-disabled="true"')
    expect(submit).not.toMatch(/\sdisabled/u)
  })

  it("releases it once the level, batch and plan are all present", () => {
    const html = assessment({
      academyPlan: "weekend-standard",
      batch: "Weekend",
      level: "Intermediate",
    })
    const submit = /<button[^>]*type="submit"[^>]*>/u.exec(html)?.[0]
    expect(submit).not.toContain("aria-disabled")
  })

  it("no longer waits on a training start date, which this step does not collect", () => {
    /*
     * The date moved to the Session step, where the schedule that bounds it is
     * known. Holding the assessment back for it would block the only step that
     * can supply the level and batch the schedule list is filtered by.
     */
    const html = assessment({
      academyPlan: "weekend-standard",
      batch: "Weekend",
      level: "Intermediate",
    })
    expect(/<button[^>]*type="submit"[^>]*>/u.exec(html)?.[0]).not.toContain("aria-disabled")
    expect(html).not.toContain('name="trainingStartOn"')
  })
})
