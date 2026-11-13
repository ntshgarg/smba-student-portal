import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/coach/actions", () => ({
  approveRegistrationAction: vi.fn(),
  rejectRegistrationAction: vi.fn(),
  undoRegistrationRejectionAction: vi.fn(),
}))

const { RejectedRequests } = await import("@/components/coach/onboarding/rejected-requests")
const { RequestStep } = await import("@/components/coach/onboarding/register/request-step")

import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"

describe("the head coach's Rejected list", () => {
  it("lists each rejected request with a way to undo it", () => {
    const html = renderToStaticMarkup(
      <RejectedRequests
        onRestored={vi.fn()}
        requests={[{
          contactEmail: "mira.family@example.com",
          fullName: "Mira Rao",
          id: "request-1",
          rejectedAt: "2026-11-03T04:00:00.000Z",
          requestedRole: "player",
        }]}
      />,
    )

    expect(html).toContain("Rejected requests")
    expect(html).toContain("Mira Rao")
    expect(html).toContain("mira.family@example.com")
    expect(html).toContain("Undo rejection")
  })

  it("dates a rejection in India time, not UTC", () => {
    const html = renderToStaticMarkup(
      <RejectedRequests
        onRestored={vi.fn()}
        requests={[{
          contactEmail: "mira.family@example.com",
          fullName: "Mira Rao",
          id: "request-1",
          // 01:30 on 13 Nov in India.
          rejectedAt: "2026-11-12T20:00:00.000Z",
          requestedRole: "player",
        }]}
      />,
    )

    expect(html).toContain("Rejected 13 Nov")
  })

  it("shows nothing when nothing has been rejected", () => {
    expect(renderToStaticMarkup(<RejectedRequests onRestored={vi.fn()} requests={[]} />)).toBe("")
  })
})

describe("the duplicate hint on a request", () => {
  const request: PlayerOnboardingCase = {
    academyId: null,
    academyPlan: null,
    assignedSession: null,
    batch: null,
    contactEmail: "kiran.family@example.com",
    duplicateSignals: [{
      academyId: "SMBA-PL-0042",
      fullName: "Kiran Rao",
      reason: "same-contact",
      standing: "archived",
    }],
    feePlanRecorded: false,
    fullName: "Kiran Rao",
    id: "request-1",
    level: null,
    primaryContact: null,
    recordRevision: null,
    requestedAt: "2026-11-10T04:00:00.000Z",
    requestedRole: "player",
    stage: "request",
    trainingStartOn: null,
  }

  it("names a returning ex-member's old record and what approving will do", () => {
    const html = renderToStaticMarkup(<RequestStep item={request} onSuccess={vi.fn()} />)

    expect(html).toContain("was SMBA-PL-0042, has left the academy")
    expect(html).toContain("Approving gives them a new Academy ID")
  })

  it("dates a request in India time, not UTC", () => {
    const html = renderToStaticMarkup(
      // 01:30 on 13 Nov in India.
      <RequestStep item={{ ...request, requestedAt: "2026-11-12T20:00:00.000Z" }} onSuccess={vi.fn()} />,
    )

    expect(html).toContain("<dd>13 Nov</dd>")
  })
})
