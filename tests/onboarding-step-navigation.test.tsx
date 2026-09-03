import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/coach/actions", () => ({
  approveRegistrationAction: vi.fn(),
  rejectRegistrationAction: vi.fn(),
  saveMemberAction: vi.fn(),
}))

vi.mock("@/app/coach/financials/actions", () => ({
  completeOnboardingFinanceAction: vi.fn(),
  previewOnboardingFinanceAction: vi.fn(),
}))

vi.mock("@/app/coach/onboarding/actions", () => ({
  assignOnboardingSessionAction: vi.fn(),
  resetOnboardingSessionAssignmentAction: vi.fn(),
  saveOnboardingAssessmentAction: vi.fn(),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: vi.fn(() => true),
    confirmNavigation: vi.fn(() => true),
    navigateAfterCommit: (navigate: () => void) => navigate(),
  }),
}))

const { OnboardingEditor } = await import("@/components/coach/onboarding/register/onboarding-editor")
const { StepRail } = await import("@/components/coach/onboarding/register/step-rail")
const { trainingStartIsTheBlockingBound } = await import(
  "@/components/coach/onboarding/register/session-step"
)

import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"

/*
 * Onboarding used to be a one-way street. The editor rendered whichever step
 * matched `item.stage` -- a value derived from how much data was filled in, not
 * from anything the coach chose -- and the rail above it was a picture. So the
 * moment the Assessment saved, the only screen carrying the training start date
 * stopped existing.
 *
 * That is what made a real case unworkable. Approval seeds trainingStartOn to
 * the approval date (lib/auth/account-service.ts:630), the session window is
 * floored at max(trainingStartOn, series.startsOn) (lib/sessions/service.ts:327),
 * and the head coach could not assign a player to an Elite series that began on
 * 1 September because the seeded start said 3 September. The Session step's own
 * error named the fix -- "Change the training start date in Assessment" -- and
 * pointed at a screen with no route to it.
 *
 * Nothing under the UI needed loosening: the service layer has always accepted a
 * start date up to 24 months back, including one before the player registered
 * (tests/onboarding-assessment-service.test.ts). These pin the way back.
 */

const SERIES = {
  batch: "Weekday",
  endsOn: "2026-12-31",
  id: "series-elite",
  programme: "Advanced",
  slots: [
    { durationMinutes: 90, id: "slot-1", startTime: "06:00", weekday: 1 },
    { durationMinutes: 90, id: "slot-3", startTime: "06:00", weekday: 3 },
    { durationMinutes: 90, id: "slot-5", startTime: "06:00", weekday: 5 },
  ],
  startsOn: "2026-09-01",
  status: "active",
  title: "Elite_Weekday_6-7_30_AM",
  venue: "SMBA Court",
} as TrainingSessionSeries

function playerCase(overrides: Partial<PlayerOnboardingCase> = {}): PlayerOnboardingCase {
  return {
    academyId: "SMBA#0031",
    academyPlan: "weekday-3-day",
    batch: "Weekday",
    feePlanRecorded: false,
    fullName: "Ishaan Verma",
    id: "player-1",
    level: "Advanced",
    primaryContact: null,
    recordRevision: 2,
    requestedAt: "2026-09-03T04:00:00.000Z",
    requestedRole: "player",
    stage: "session",
    trainingStartOn: "2026-09-03",
    trainingStartConfirmedAt: "2026-09-03T05:00:00.000Z",
    ...overrides,
  } as PlayerOnboardingCase
}

function editorMarkup(item: PlayerOnboardingCase) {
  return renderToStaticMarkup(
    <OnboardingEditor
      financeActive
      item={item}
      onSuccess={() => undefined}
      referenceDate="2026-09-03"
      sessionSeries={[SERIES]}
    />,
  )
}

describe("moving back through onboarding before it is finished", () => {
  it("offers a step the case has already passed as a control, not as a picture", () => {
    const html = editorMarkup(playerCase({ stage: "session" }))

    // Assessment is behind the case, so it is a way back.
    expect(html).toContain('aria-label="Go back to Assessment"')
    // Fee Plan is ahead of it: nothing there can be filled in yet.
    expect(html).not.toContain('aria-label="Go back to Fee Plan"')
  })

  it("never offers a way back to the request, because approval cannot be undone", () => {
    /*
     * Approving allocates an Academy ID (lib/auth/account-service.ts:591-598) and
     * no path anywhere deletes an allocation, so a rail button back to it would
     * promise something the system cannot do.
     */
    const html = editorMarkup(playerCase({ stage: "feePlan" }))

    expect(html).toContain('aria-label="Go back to Assessment"')
    expect(html).toContain('aria-label="Go back to Session"')
    expect(html).not.toContain('aria-label="Go back to New requests"')
  })

  it("shows nothing to go back to while the case is still a request", () => {
    const html = editorMarkup(playerCase({
      academyId: null,
      academyPlan: null,
      batch: null,
      level: null,
      recordRevision: null,
      stage: "request",
      trainingStartOn: null,
    }))

    expect(html).not.toContain("aria-label=\"Go back to")
  })

  it("renders the rail as inert when no way back is supplied", () => {
    // The rail is used as a progress indicator elsewhere; without onSelect it
    // must not sprout buttons.
    const html = renderToStaticMarkup(
      <StepRail current="session" reachedStage="session" />,
    )

    expect(html).not.toContain("<button")
    expect(html).toContain("Assessment")
  })
})

describe("what the session step does when the training start is what blocks the date", () => {
  it("names the training start as the bound when the series starts earlier", () => {
    // The reported case: series from 1 September, start date seeded to 3 September.
    expect(trainingStartIsTheBlockingBound(
      playerCase({ trainingStartOn: "2026-09-03" }),
      SERIES,
      "2026-09-01",
    )).toBe(true)
  })

  it("does not name it when the series itself is the later bound", () => {
    /*
     * Then the fix is a different schedule or a different series start date, and
     * offering Assessment would send the coach somewhere that cannot help.
     */
    expect(trainingStartIsTheBlockingBound(
      playerCase({ trainingStartOn: "2026-08-01" }),
      SERIES,
      "2026-08-15",
    )).toBe(false)
  })

  it("names nothing when the date sits inside the window", () => {
    expect(trainingStartIsTheBlockingBound(
      playerCase({ trainingStartOn: "2026-09-01" }),
      SERIES,
      "2026-09-10",
    )).toBe(false)
    expect(trainingStartIsTheBlockingBound(playerCase(), null, "2026-09-01")).toBe(false)
  })
})
