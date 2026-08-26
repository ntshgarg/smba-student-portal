import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  completeInitialHeadCoachSetup: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  redirect: vi.fn(),
  signInUsername: vi.fn(),
  /** Depth of the just-written-password exemption around the current call. */
  exemptDepth: 0,
  /** Whether the sign-in the action ran was inside that exemption. */
  signedInWhileExempt: false,
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: mocks.cookieDelete, get: mocks.cookieGet })),
  headers: vi.fn(async () => new Headers()),
}))

vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({
    api: {
      signInUsername: (...args: unknown[]) => {
        mocks.signedInWhileExempt = mocks.exemptDepth > 0
        return mocks.signInUsername(...args)
      },
    },
  }),
}))

// Counts the scope rather than the call, so a sign-in fired next to the wrapper
// instead of inside it reads as unexempt -- which is what it would be at
// runtime, where the exemption rides an AsyncLocalStorage store. The store
// itself is driven against the real endpoint in tests/better-auth-runtime.test.ts.
vi.mock("@/lib/auth/username-login-guard", () => ({
  signInWithJustWrittenPassword: async <T>(run: () => Promise<T>) => {
    mocks.exemptDepth += 1
    try {
      return await run()
    } finally {
      mocks.exemptDepth -= 1
    }
  },
}))

vi.mock("@/lib/auth/initial-setup", () => ({
  completeInitialHeadCoachSetup: mocks.completeInitialHeadCoachSetup,
  HEAD_COACH_SETUP_COOKIE: "smba_head_coach_setup",
  headCoachSetupAvailable: vi.fn(() => true),
  validHeadCoachSetupToken: vi.fn(() => true),
  validateInitialHeadCoachSetup: vi.fn(() => null),
}))

vi.mock("@/lib/auth/recovery-service", () => ({
  HEAD_SETUP_EMAIL_COOKIE: "smba_head_setup_email",
  recoverySubjectKeyForHeadSetup: vi.fn(() => "head-setup-subject"),
}))

import { completeHeadCoachSetupAction } from "@/app/setup/head-coach/actions"

function setupData() {
  const formData = new FormData()
  formData.set("fullName", "Sathiya Moorthy")
  formData.set("password", "Head coach secure password!")
  formData.set("confirmPassword", "Head coach secure password!")
  formData.set("pin", "482913")
  formData.set("confirmPin", "482913")
  return formData
}

describe("first-run head-coach setup action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exemptDepth = 0
    mocks.signedInWhileExempt = false
    mocks.cookieGet.mockReturnValue({ value: "a-one-time-setup-token" })
    mocks.completeInitialHeadCoachSetup.mockResolvedValue({ academyId: "SMBA#0001" })
  })

  it("signs the new head coach in and sends them to authenticator setup", async () => {
    mocks.signInUsername.mockResolvedValue({ user: {} })

    await completeHeadCoachSetupAction({ error: null, errorField: null }, setupData())

    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_head_coach_setup")
    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_head_setup_email")
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/two-factor/setup")
  })

  // The password presented here is the one this request just wrote, so there is
  // no guess for the login lockout to slow. Without the exemption, twenty
  // failures from anywhere behind the same address would refuse the academy's
  // only head coach their first session on a correct password.
  it("presents the just-written password under the login-lockout exemption", async () => {
    mocks.signInUsername.mockResolvedValue({ user: {} })

    await completeHeadCoachSetupAction({ error: null, errorField: null }, setupData())

    expect(mocks.signInUsername).toHaveBeenCalledOnce()
    expect(mocks.signedInWhileExempt).toBe(true)
  })

  // The academy exists from here on, so the setup did not fail -- only the
  // session did. Reporting the endpoint's refusal as a setup failure, or
  // leaving the one-time cookies behind for a retry that can only answer
  // "already used", strands the one account that can run the academy.
  it("reports a refused session as a missing session, not as a failed setup", async () => {
    mocks.signInUsername.mockRejectedValue(Object.assign(new Error("rate limited"), {
      status: "TOO_MANY_REQUESTS",
    }))

    await expect(completeHeadCoachSetupAction({ error: null, errorField: null }, setupData())).resolves.toEqual({
      error: "The head-coach account is ready, but we couldn’t sign you in."
        + " Open the sign-in page and use your new password.",
      errorField: null,
    })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_head_coach_setup")
    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_head_setup_email")
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  // A genuine creation failure still has to read as one, and the one-time
  // cookies have to survive it: nothing was written, so the person must be able
  // to submit the form again.
  it("keeps the setup session alive when the account itself could not be created", async () => {
    mocks.completeInitialHeadCoachSetup.mockRejectedValue(new Error("An academy already exists."))

    await expect(completeHeadCoachSetupAction({ error: null, errorField: null }, setupData())).resolves.toEqual({
      error: "An academy already exists.",
      errorField: null,
    })
    expect(mocks.cookieDelete).not.toHaveBeenCalled()
    expect(mocks.signInUsername).not.toHaveBeenCalled()
  })
})
