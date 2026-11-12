import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/login/actions", () => ({
  activateAccount: vi.fn(),
  confirmRegistrationCode: vi.fn(),
  requestRegistrationCode: vi.fn(),
}))
vi.mock("@/app/activate/actions", () => ({
  confirmRegistrationStatusCode: vi.fn(),
  requestRegistrationStatusCode: vi.fn(),
}))
vi.mock("@/app/coach/actions", () => ({
  approveRegistrationAction: vi.fn(),
  rejectRegistrationAction: vi.fn(),
  undoRegistrationRejectionAction: vi.fn(),
}))

const { RegistrationForm } = await import("@/components/registration-form")
const { RegistrationStatusForm } = await import("@/components/registration-status-form")
const { RejectedRequests } = await import("@/components/coach/onboarding/rejected-requests")
const { RequestStep } = await import("@/components/coach/onboarding/register/request-step")

import {
  EMPTY_REGISTRATION_STATE,
  EMPTY_REGISTRATION_STATUS_STATE,
  passwordStepReachable,
  registrationDetailsAgain,
  registrationForAnotherPlayer,
  registrationStatusDetailsAgain,
  type RegistrationFormState,
} from "@/lib/auth/registration-form"
import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"

const TYPED = {
  dateOfBirth: "2014-03-11",
  email: "rakesh@example.com",
  fullName: "Mira Rao",
  phone: "+91 98765 43210",
  requestedRole: "player" as const,
}

function registration(overrides: Partial<RegistrationFormState>): RegistrationFormState {
  return { ...EMPTY_REGISTRATION_STATE, values: TYPED, ...overrides }
}

/*
 * The registration form only ever moved forward on a server reply. The code
 * step told people to "go back and send again" and the result screen to "go
 * back and enter their full name", with no control for either -- so a mistyped
 * email or a second child meant reloading the page and typing everything again.
 */
describe("registration form: a way back", () => {
  it("offers a new code and a way back to the details on the code step", () => {
    const html = renderToStaticMarkup(
      <RegistrationForm initialState={registration({ step: "code" })} />,
    )

    expect(html).toContain("Send a new code")
    expect(html).toContain("Change details")
    expect(html).toContain("rakesh@example.com")
    expect(html).not.toContain("go back and send again")
  })

  it("goes back to the details with everything still typed in", () => {
    const back = registrationDetailsAgain(registration({ error: "That code is invalid or expired.", step: "code" }))

    expect(back).toMatchObject({ error: null, errorField: null, step: "details", values: TYPED })
  })

  it("offers to register another player, keeping the family's email and mobile", () => {
    const done = registration({ standing: "pending", step: "done" })
    const html = renderToStaticMarkup(<RegistrationForm initialState={done} />)

    expect(html).toContain("Register another player")
    expect(html).not.toContain("Go back and enter their full name")
    expect(registrationForAnotherPlayer(done)).toMatchObject({
      step: "details",
      values: {
        dateOfBirth: "",
        email: TYPED.email,
        fullName: "",
        phone: TYPED.phone,
        requestedRole: "player",
      },
    })
  })

  /*
   * Same standing, same next step on both doors. The registration door used to
   * say "create a password" and link to /activate, which -- away from the
   * original browser -- asked for the name, email and a second code again.
   */
  it("shows the password step itself when the player is ready for one", () => {
    const ready = registration({
      academyId: "SMBA-PL-0019",
      activated: false,
      onboardingCompleted: true,
      standing: "approved",
      step: "done",
    })
    expect(passwordStepReachable(ready)).toBe(true)

    const html = renderToStaticMarkup(<RegistrationForm initialState={ready} />)

    expect(html).toContain("Create password")
    expect(html).toContain("SMBA-PL-0019")
    expect(html).not.toContain("View activation status")
  })

  it("keeps sending a player still being set up to the status page, with no password form", () => {
    const html = renderToStaticMarkup(<RegistrationForm initialState={registration({
      academyId: "SMBA-PL-0019",
      onboardingCompleted: false,
      standing: "approved",
      step: "done",
    })} />)

    expect(html).not.toContain("Create password")
    expect(html).toContain("View activation status")
  })

  it("tells a rejected family their registration was not accepted and to contact the academy", () => {
    const html = renderToStaticMarkup(
      <RegistrationForm initialState={registration({ standing: "rejected", step: "done" })} />,
    )

    expect(html).toContain("Registration not accepted.")
    expect(html).toContain("This registration was not accepted. Please contact the academy.")
  })
})

describe("status lookup: a way back", () => {
  const codeStep = {
    ...EMPTY_REGISTRATION_STATUS_STATE,
    step: "code" as const,
    values: { email: "rakesh@example.com", fullName: "Mira Rao" },
  }

  it("offers a new code and different details on the code step", () => {
    const html = renderToStaticMarkup(<RegistrationStatusForm initialState={codeStep} />)

    expect(html).toContain("Send a new code")
    expect(html).toContain("Use different details")
    expect(registrationStatusDetailsAgain({ ...codeStep, error: "That code is invalid or expired." }))
      .toMatchObject({ error: null, step: "details", values: codeStep.values })
  })

  it("lets a parent look up a different child once one answer is shown", () => {
    const html = renderToStaticMarkup(<RegistrationStatusForm initialState={{
      ...codeStep,
      standing: "pending",
      step: "done",
    }} />)

    expect(html).toContain("Check a different player")
  })

  it("words a rejection the same way as the registration form", () => {
    const html = renderToStaticMarkup(<RegistrationStatusForm initialState={{
      ...codeStep,
      standing: "rejected",
      step: "done",
    }} />)

    expect(html).toContain("This registration was not accepted. Please contact the academy.")
  })
})

describe("the head coach's Rejected list", () => {
  it("lists each rejected request with a way to undo it", () => {
    const html = renderToStaticMarkup(
      <RejectedRequests
        onRestored={vi.fn()}
        requests={[{
          contactEmail: "mira.family@example.com",
          createdAt: "2026-11-01T04:00:00.000Z",
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
})
