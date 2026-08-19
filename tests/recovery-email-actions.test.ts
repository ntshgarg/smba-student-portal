import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  requestRecoveryEmailVerification: vi.fn(),
  verifyCurrentPasswordAttempt: vi.fn(),
  verifyFreshAccountSecondFactor: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/auth/credential-service", () => ({
  ACTIVATION_CLAIM_COOKIE: "activation",
  getActivationClaimStatus: vi.fn(),
  verifyCurrentPasswordAttempt: mocks.verifyCurrentPasswordAttempt,
}))
vi.mock("@/lib/auth/cookie-policy", () => ({ secureAuthCookiesRequired: vi.fn() }))
vi.mock("@/lib/auth/recovery-service", () => ({
  confirmRecoveryEmailVerification: vi.fn(),
  getRecoveryEmail: vi.fn(),
  HEAD_SETUP_EMAIL_COOKIE: "head-setup-email",
  recoverySubjectKeyForAccount: vi.fn((accountId: string) => accountId),
  recoverySubjectKeyForHeadSetup: vi.fn(),
  requestRecoveryEmailVerification: mocks.requestRecoveryEmailVerification,
  verifyFreshAccountSecondFactor: mocks.verifyFreshAccountSecondFactor,
}))
vi.mock("@/lib/auth/initial-setup", () => ({
  HEAD_COACH_SETUP_COOKIE: "head-setup",
  headCoachSetupAvailable: vi.fn(),
  validHeadCoachSetupToken: vi.fn(),
}))
vi.mock("@/lib/auth/identity", () => ({ normalizeFullName: vi.fn() }))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
}))

import { requestRecoveryEmailChange } from "@/app/account/recovery-email/actions"

const initialState = { email: "", error: null, sent: false }

describe("recovery email change requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })
  })

  it("rejects an empty form before checking credentials or sending email", async () => {
    await expect(requestRecoveryEmailChange(initialState, new FormData())).resolves.toEqual({
      email: "",
      error: "Enter a valid recovery email address.",
      sent: false,
    })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("requires the current password before sending a verification code", async () => {
    const formData = new FormData()
    formData.set("email", "new@example.com")

    await expect(requestRecoveryEmailChange(initialState, formData)).resolves.toEqual({
      email: "new@example.com",
      error: "Enter your current password.",
      sent: false,
    })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("requires a second factor for the head coach", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.verifyCurrentPasswordAttempt.mockResolvedValue("verified")
    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("currentPassword", "Current secure password!")

    await expect(requestRecoveryEmailChange(initialState, formData)).resolves.toEqual({
      email: "new@example.com",
      error: "Enter an authenticator or backup code.",
      sent: false,
    })
    expect(mocks.verifyFreshAccountSecondFactor).not.toHaveBeenCalled()
    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
  })
})
