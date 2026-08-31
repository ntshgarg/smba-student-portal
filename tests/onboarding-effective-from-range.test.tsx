import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// session-step pulls its server action in at module scope, which drags `server-only`
// into a unit test. The component itself is not rendered here -- only its pure range
// helper is exercised -- so the action is stubbed exactly as the register UI test does.
vi.mock("@/app/coach/onboarding/actions", () => ({
  assignOnboardingSessionAction: vi.fn(),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: vi.fn(() => true),
    confirmNavigation: vi.fn(() => true),
    navigateAfterCommit: (navigate: () => void) => navigate(),
  }),
}))

import { SessionStep, effectiveFromViolation } from "@/components/coach/onboarding/register/session-step"
import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"

/*
 * The picker deliberately carries no min/max. Clamping it left a coach unable to move
 * the calendar with nothing on screen saying why, and the browser's native message
 * ("Value must be 01/07/2026 or later") fires only on submit and never names the bound's
 * source. These cases pin the explanation that replaced the clamp: which bound was
 * crossed, and where that bound is changed.
 */
function playerCase(trainingStartOn: string | null) {
  return { fullName: "Aditi Rao", trainingStartOn } as unknown as PlayerOnboardingCase
}

function series(startsOn: string, endsOn: string | null) {
  return {
    endsOn,
    startsOn,
    title: "Intermediate_Weekend_8-9_AM",
  } as unknown as TrainingSessionSeries
}

describe("effective-from range guidance", () => {
  it("accepts a date inside the window", () => {
    expect(effectiveFromViolation(
      playerCase("2026-07-01"),
      series("2026-07-01", "2026-09-30"),
      "2026-08-10",
    )).toBeNull()
  })

  it("accepts both boundary dates", () => {
    const item = playerCase("2026-07-01")
    const chosen = series("2026-07-01", "2026-09-30")
    expect(effectiveFromViolation(item, chosen, "2026-07-01")).toBeNull()
    expect(effectiveFromViolation(item, chosen, "2026-09-30")).toBeNull()
  })

  it("names the training start date when that is the binding floor", () => {
    const message = effectiveFromViolation(
      playerCase("2026-08-01"),
      series("2026-07-01", "2026-09-30"),
      "2026-07-15",
    )
    expect(message).toContain("Aditi Rao")
    expect(message).toContain("Assessment")
    // The schedule is not the reason here, so it must not be blamed.
    expect(message).not.toContain("Intermediate_Weekend_8-9_AM")
  })

  it("names the schedule when the schedule is the binding floor", () => {
    const message = effectiveFromViolation(
      playerCase("2026-06-01"),
      series("2026-07-01", "2026-09-30"),
      "2026-06-15",
    )
    expect(message).toContain("Intermediate_Weekend_8-9_AM")
    expect(message).not.toContain("Assessment")
  })

  it("names the schedule's end when the date runs past it", () => {
    const message = effectiveFromViolation(
      playerCase("2026-07-01"),
      series("2026-07-01", "2026-09-30"),
      "2026-12-25",
    )
    expect(message).toContain("Intermediate_Weekend_8-9_AM")
    expect(message).toContain("end date")
  })

  it("imposes no ceiling on an open-ended schedule", () => {
    expect(effectiveFromViolation(
      playerCase("2026-07-01"),
      series("2026-07-01", null),
      "2027-12-25",
    )).toBeNull()
  })

  it("stays quiet with no schedule chosen or no date entered", () => {
    expect(effectiveFromViolation(playerCase("2026-07-01"), null, "2026-01-01")).toBeNull()
    expect(effectiveFromViolation(
      playerCase("2026-07-01"),
      series("2026-07-01", "2026-09-30"),
      "",
    )).toBeNull()
  })
})

/*
 * The clamp this replaced is the defect: `min`/`max` on the picker froze the calendar's
 * year and month with nothing on screen explaining the window. Re-adding either attribute
 * reintroduces exactly the bug a coach reported, so it is pinned here rather than left to
 * review.
 */
describe("effective-from picker", () => {
  function renderStep(trainingStartOn: string) {
    return renderToStaticMarkup(
      <SessionStep
        item={{
          academyPlan: "weekend-standard",
          batch: "Weekend",
          feePlanRecorded: true,
          fullName: "Aditi Rao",
          id: "player-1",
          level: "Intermediate",
          trainingStartOn,
        } as never}
        onSuccess={() => {}}
        referenceDate="2026-09-01"
        sessionSeries={[{
          batch: "Weekend",
          endsOn: "2026-09-30",
          id: "series-1",
          programme: "Intermediate",
          slots: [
            { durationMinutes: 60, id: "slot-0", startTime: "08:00", weekday: 0 },
            { durationMinutes: 60, id: "slot-6", startTime: "08:00", weekday: 6 },
          ],
          startsOn: "2026-07-01",
          status: "active",
          title: "Intermediate_Weekend_8-9_AM",
          venue: "SMBA Court",
        }] as never}
      />,
    )
  }

  it("leaves the date picker unclamped so every month stays reachable", () => {
    const html = renderStep("2026-07-01")
    const input = /<input[^>]*name="effectiveFrom"[^>]*>/u.exec(html)?.[0]
    // Guard the guard: a selector that matched nothing would pass every assertion below.
    expect(input).toBeDefined()
    expect(input).toContain('type="date"')
    expect(input).not.toContain("min=")
    expect(input).not.toContain("max=")
  })

  it("explains an out-of-range starting value instead of silently refusing it", () => {
    // The suggested date is max(training start, series start); a training start after the
    // schedule ends puts the field out of range on first render.
    const html = renderStep("2026-12-01")
    expect(html).toContain("cannot begin after it")
    expect(html).toContain('aria-invalid="true"')
  })
  it("refuses to let the session be assigned until the date is inside the window", () => {
    const outOfRange = renderStep("2026-12-01")
    const button = /<button[^>]*type="submit"[^>]*>/u.exec(outOfRange)?.[0]
    expect(button).toBeDefined()
    expect(button).toContain("disabled")

    const inRange = renderStep("2026-07-01")
    const enabled = /<button[^>]*type="submit"[^>]*>/u.exec(inRange)?.[0]
    expect(enabled).toBeDefined()
    expect(enabled).not.toContain("disabled")
  })

  it("marks the blocked submit so it reads as unavailable, not as busy", () => {
    const outOfRange = renderStep("2026-12-01")
    expect(/<button[^>]*type="submit"[^>]*>/u.exec(outOfRange)?.[0])
      .toContain('data-blocked="true"')

    const inRange = renderStep("2026-07-01")
    expect(/<button[^>]*type="submit"[^>]*>/u.exec(inRange)?.[0])
      .not.toContain("data-blocked")
  })
})
