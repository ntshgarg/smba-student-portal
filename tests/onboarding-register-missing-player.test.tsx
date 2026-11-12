import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const replace = vi.fn()

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/onboarding",
  useRouter: () => ({ refresh: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams("player=finished-player"),
}))

vi.mock("@/app/coach/actions", () => ({
  approveRegistrationAction: vi.fn(),
  rejectRegistrationAction: vi.fn(),
  saveMemberAction: vi.fn(),
}))

vi.mock("@/app/coach/financials/actions", () => ({
  completeOnboardingFinanceAction: vi.fn(),
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
  cases: [{
    academyId: "SMBA#0014",
    academyPlan: null,
    assignedSession: null,
    batch: null,
    feePlanRecorded: false,
    fullName: "Rohan Kulkarni",
    id: "assessment-player",
    trainingStartOn: "2026-08-11",
    trainingStartConfirmedAt: null,
    level: null,
    primaryContact: { name: "", phone: "", relationship: "" },
    recordRevision: 0,
    requestedRole: "player",
    requestedAt: null,
    stage: "assessment",
  }],
  summary: { assessment: 1, feePlan: 0, newRequests: 0, onboarded: 1, session: 0, total: 1 },
}

/*
 * A link to a player with no onboarding step left (the fee record of a player
 * who stopped training used to send one) opened whichever case came first,
 * with no word of explanation: the coach landed on another child's case.
 */
describe("opening onboarding for a player who is not in it", () => {
  it("opens nobody else's case and says where the player's record is", () => {
    const html = renderToStaticMarkup(
      <PlayerOnboardingRegister
        financeActive
        referenceDate="2026-08-16"
        sessionSeries={[]}
        workspace={workspace}
      />,
    )

    expect(html).toContain("This player has no onboarding step left")
    expect(html).toContain("/coach/members?player=finished-player")
    expect(html).not.toContain("Complete Rohan’s assessment")
    expect(replace).not.toHaveBeenCalled()
    // A start date approval stamped, which nobody chose, is not shown as one.
    expect(html).not.toContain("Training from")
  })
})
