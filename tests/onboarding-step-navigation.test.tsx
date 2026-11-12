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
const { SessionStep } = await import(
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
 * The date that made that unworkable has since moved to the Session step, so the
 * original symptom is gone at the root. The way back is still load-bearing: it is
 * how a coach reaches a finished step to correct it at all.
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
    assignedSession: null,
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
    expect(html).not.toContain("Fee Plan\"")
  })

  it("does not call a step ahead of the coach a way back", () => {
    /*
     * Once the coach steps back, the steps between them and the live edge are
     * ahead of where they stand. The aria-label is the only name a screen reader
     * gets -- it overrides the visible "03 Session" -- so calling a forward jump
     * "go back" is not a nuance, it is the wrong word for the only name there is.
     */
    const html = renderToStaticMarkup(
      <StepRail current="assessment" onSelect={() => undefined} reachedStage="feePlan" />,
    )

    expect(html).toContain('aria-label="Go forward to Session"')
    expect(html).toContain('aria-label="Go forward to Fee Plan"')
    expect(html).not.toContain("Go back to")
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
    expect(html).not.toContain("New requests\"")
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

    expect(html).not.toContain("aria-label=\"Go ")
  })

  it("renders the rail as inert when no way back is supplied", () => {
    // The rail is used as a progress indicator elsewhere; without onSelect it
    // must not sprout buttons.
    const html = renderToStaticMarkup(
      <StepRail current="session" reachedStage="session" />,
    )

    expect(html).not.toContain("<button")
    expect(html).toContain("Assess")
  })

  it("shows the short stage name but keeps the full one for a screen reader", () => {
    /*
     * The rail gives each stage a quarter of the screen, and at 320px that is 55px
     * against 63.5px of unbreakable "ASSESSMENT" -- it crossed into the step beside
     * it, and "NEW REQUESTS" only fitted by wrapping, which is what pulled the four
     * markers onto three different heights below 393px.
     *
     * The short form is visible-text only. Each one is a prefix of the full stage
     * name that the button's aria-label carries, so the accessible name still
     * contains what is painted and speech input matches it (WCAG 2.5.3).
     */
    const html = renderToStaticMarkup(
      <StepRail current="feePlan" onSelect={() => undefined} reachedStage="feePlan" />,
    )

    expect(html).toContain("<strong>Assess</strong>")
    expect(html).toContain("<strong>Request</strong>")
    expect(html).toContain('aria-label="Go back to Assessment"')
    expect(html).not.toContain("<strong>Assessment</strong>")

    for (const [visible, full] of [["Request", "New requests"], ["Assess", "Assessment"]]) {
      expect(full.toLowerCase()).toContain(visible.toLowerCase())
    }
  })
})

describe("revisiting a step whose work is already done", () => {
  it("says what is assigned instead of offering a form the server will refuse", () => {
    /*
     * assignSessionRecords only ever INSERTs, and the step seeds itself from the
     * first eligible series -- normally the one the player is already on. So a
     * pristine, plausible-looking form arrived here with a submit that could only
     * fail, carrying a raw CONFLICT on a field this step does not map.
     */
    const html = renderToStaticMarkup(
      <SessionStep
        item={playerCase({
          assignedSession: { batch: "Weekday", effectiveFrom: "2026-07-01", endsOn: null, programme: "Advanced", standing: "running" },
          stage: "feePlan",
        })}
        onSuccess={() => undefined}
        referenceDate="2026-09-03"
        sessionSeries={[SERIES]}
      />,
    )

    expect(html).toContain("is already assigned to")
    expect(html).not.toContain('name="effectiveFrom"')
    // Undoing the step from the step it undoes. Sending a coach two steps
    // forward to clear the assignment they are looking at was a pure detour.
    expect(html).toContain("Clear this assignment")
  })

  it("offers the assignment form when the player holds no schedule", () => {
    const html = renderToStaticMarkup(
      <SessionStep
        item={playerCase({ assignedSession: null, stage: "session" })}
        onSuccess={() => undefined}
        referenceDate="2026-09-03"
        sessionSeries={[SERIES]}
      />,
    )

    expect(html).toContain('name="effectiveFrom"')
    expect(html).not.toContain("is already assigned to")
  })
})

describe("a first schedule that ended before onboarding finished", () => {
  function sessionMarkup(item: PlayerOnboardingCase, onGoToFeePlan?: () => void) {
    return renderToStaticMarkup(
      <SessionStep
        item={item}
        onGoToFeePlan={onGoToFeePlan}
        onSuccess={() => undefined}
        referenceDate="2026-11-12"
        sessionSeries={[SERIES]}
      />,
    )
  }

  it("reports the ended schedule and offers finishing with it, or starting again", () => {
    /*
     * This used to fall through to the blank assign form, whose every date was
     * refused with advice to clear an assignment nothing on screen could clear
     * (head coach, 12 Nov 2026: finish onboarding with that first term).
     */
    const html = sessionMarkup(playerCase({
      assignedSession: { batch: "Weekday", effectiveFrom: "2026-11-02", endsOn: null, programme: "Advanced", standing: "ended" },
      hasRecords: false,
      stage: "feePlan",
    }), () => undefined)

    expect(html).toContain("first schedule, Advanced · Weekday from")
    expect(html).toContain("has ended")
    expect(html).toContain("Go to Fee Plan")
    expect(html).toContain("Start again")
    expect(html).not.toContain('name="effectiveFrom"')
    expect(html).not.toContain("court time is set")
  })

  it("only offers to finish once attendance or fees are recorded", () => {
    const html = sessionMarkup(playerCase({
      assignedSession: { batch: "Weekday", effectiveFrom: "2026-09-07", endsOn: "2026-10-30", programme: "Advanced", standing: "finished" },
      hasRecords: true,
      stage: "feePlan",
    }), () => undefined)

    expect(html).toContain("finished on 30 October 2026")
    expect(html).toContain("Go to Fee Plan")
    expect(html).not.toContain("Start again")
    expect(html).not.toContain("Clear this assignment")
  })

  it("does not call an ended schedule's court time set, nor promise edits on revisit", () => {
    const html = editorMarkup(playerCase({
      assignedSession: { batch: "Weekday", effectiveFrom: "2026-09-07", endsOn: "2026-10-30", programme: "Advanced", standing: "finished" },
      stage: "feePlan",
    }))

    expect(html).toContain("first term has finished")
    expect(html).not.toContain("Changes save as normal")
  })

  it("does not show a start date nobody has chosen yet", () => {
    // Approval stamps the day it happened as a stand-in for the start date.
    const html = editorMarkup(playerCase({
      assignedSession: null,
      stage: "session",
      trainingStartConfirmedAt: null,
      trainingStartOn: "2026-09-03",
    }))

    expect(html).toContain("<dt>Training start</dt><dd>Pending</dd>")
  })
})

