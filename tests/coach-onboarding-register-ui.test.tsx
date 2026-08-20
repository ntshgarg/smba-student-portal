import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/onboarding",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("player=assessment-player"),
}))

vi.mock("@/app/coach/actions", () => ({
  approveRegistrationAction: vi.fn(),
  rejectRegistrationAction: vi.fn(),
  saveMemberAction: vi.fn(),
}))

vi.mock("@/app/coach/financials/actions", () => ({
  replaceFeeAgreementAction: vi.fn(),
}))

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

import { PlayerOnboardingRegister } from "@/components/coach/onboarding/player-onboarding-register"
import type { PlayerOnboardingWorkspace } from "@/lib/coach/onboarding"

const workspace: PlayerOnboardingWorkspace = {
  cases: [
    {
      academyId: null,
      academyPlan: null,
      batch: null,
      feePlanRecorded: false,
      fullName: "Myra Shah",
      id: "request-player",
      joinedAt: null,
      level: null,
      primaryContact: null,
      recordRevision: null,
      requestedRole: "player",
      requestedAt: "2026-08-15T09:00:00.000Z",
      stage: "request",
    },
    {
      academyId: "SMBA#0014",
      academyPlan: null,
      batch: null,
      feePlanRecorded: false,
      fullName: "Rohan Kulkarni",
      id: "assessment-player",
      joinedAt: "2026-08-11",
      level: null,
      primaryContact: { name: "", phone: "", relationship: "" },
      recordRevision: 0,
      requestedRole: "player",
      requestedAt: null,
      stage: "assessment",
    },
  ],
  summary: {
    assessment: 1,
    feePlan: 0,
    newRequests: 1,
    session: 0,
    total: 2,
  },
}

describe("Player Onboarding Next-Step Register", () => {
  it("renders the selected register direction with one inline next action", () => {
    const html = renderToStaticMarkup(
      <PlayerOnboardingRegister
        financeActive
        referenceDate="2026-08-16"
        sessionSeries={[]}
        workspace={workspace}
      />,
    )

    expect(html).toContain("Academy intake register.")
    expect(html).toContain('aria-label="Academy onboarding progress"')
    expect(html).toContain("One ordered queue")
    expect(html).toContain("New requests")
    expect(html).toContain("Assessment")
    expect(html).toContain("Session")
    expect(html).toContain("Fee Plan")
    expect(html).toContain("01")
    expect(html).toContain("02")
    expect(html).toContain("Complete Rohan’s assessment")
    expect(html).toContain("Training plan")
    expect(html).toContain("Save assessment &amp; continue")
    expect(html.match(/role="region"/gu)).toHaveLength(1)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-current="step"')
    expect(html).not.toContain("<main")
    expect(html).not.toContain("View application")
  })

  it("renders junior-coach requests as staff approval without player assessment copy", () => {
    const coachWorkspace: PlayerOnboardingWorkspace = {
      cases: [{
        academyId: null,
        academyPlan: null,
        batch: null,
        feePlanRecorded: false,
        fullName: "Arjun Kumar",
        id: "assessment-player",
        joinedAt: null,
        level: null,
        primaryContact: null,
        recordRevision: null,
        requestedRole: "coach",
        requestedAt: "2026-08-15T09:00:00.000Z",
        stage: "request",
      }],
      summary: { assessment: 0, feePlan: 0, newRequests: 1, session: 0, total: 1 },
    }
    const html = renderToStaticMarkup(
      <PlayerOnboardingRegister
        financeActive
        referenceDate="2026-08-16"
        sessionSeries={[]}
        workspace={coachWorkspace}
      />,
    )

    expect(html).toContain("Review Arjun’s staff request")
    expect(html).toContain("Junior coach")
    expect(html).toContain("Coaching staff")
    expect(html).toContain("Approve staff access")
    expect(html).not.toContain("court assessment")
  })
})
