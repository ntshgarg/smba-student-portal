import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  confirmRecoveryEmailVerification: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRecoveryEmail: vi.fn(),
  notifyRecoveryEmailReplaced: vi.fn(async () => true),
  recoveryEmailSendRefusal: vi.fn<() => string | null>(() => null),
  redirect: vi.fn(),
  requestRecoveryEmailVerification: vi.fn(),
  verifyCurrentPasswordAttempt: vi.fn(),
  verifyFreshAccountSecondFactor: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/credential-service", () => ({
  ACTIVATION_CLAIM_COOKIE: "activation",
  getActivationClaimStatus: vi.fn(),
  verifyCurrentPasswordAttempt: mocks.verifyCurrentPasswordAttempt,
}))
vi.mock("@/lib/auth/cookie-policy", () => ({ secureAuthCookiesRequired: vi.fn() }))
vi.mock("@/lib/auth/recovery-service", () => ({
  EMAIL_VERIFICATION_LIFETIME_MS: 10 * 60 * 1000,
  normalizeEmailAddress: vi.fn((value: string) => value.trim().toLowerCase()),
  notifyRecoveryEmailReplaced: mocks.notifyRecoveryEmailReplaced,
  recoveryEmailSendRefusal: mocks.recoveryEmailSendRefusal,
  confirmRecoveryEmailVerification: mocks.confirmRecoveryEmailVerification,
  getRecoveryEmail: mocks.getRecoveryEmail,
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

import {
  confirmRecoveryEmailChange,
  requestRecoveryEmailChange,
} from "@/app/account/recovery-email/actions"

const initialState = { email: "", error: null, sent: false }

describe("recovery email change requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })
    mocks.recoveryEmailSendRefusal.mockReturnValue(null)
  })

  // A head coach used to spend a recovery code on the second-factor step only
  // to be told "wait one minute" by the send that followed it.
  it("says a code cannot be sent yet before asking for any credential", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.recoveryEmailSendRefusal.mockReturnValue("Wait one minute before requesting another code.")
    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("currentPassword", "Current secure password!")
    formData.set("secondFactor", "SPARE-CODE")

    await expect(requestRecoveryEmailChange(initialState, formData)).resolves.toEqual({
      email: "new@example.com",
      error: "Wait one minute before requesting another code.",
      sent: false,
    })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.verifyFreshAccountSecondFactor).not.toHaveBeenCalled()
  })

  it("tells the old address once the change is confirmed", async () => {
    mocks.getRecoveryEmail.mockReturnValue({ email: "old@example.com", verifiedAt: new Date() })
    mocks.confirmRecoveryEmailVerification.mockReturnValue({
      email: "new@example.com",
      previousEmail: "old@example.com",
      receiptToken: null,
    })
    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("code", "123456")

    await confirmRecoveryEmailChange(initialState, formData)
    expect(mocks.notifyRecoveryEmailReplaced).toHaveBeenCalledWith({
      accountId: "player-one",
      newEmail: "new@example.com",
      previousEmail: "old@example.com",
    })
    expect(mocks.redirect).toHaveBeenCalledWith("/account/security?emailChanged=1")
  })

  // The press went through but its answer was lost; pressing again finds the
  // code spent. It must not be told the code was invalid.
  it("recognises a change that already went through when the answer was lost", async () => {
    mocks.getRecoveryEmail.mockReturnValue({ email: "new@example.com", verifiedAt: new Date() })
    mocks.confirmRecoveryEmailVerification.mockReturnValue(null)
    const formData = new FormData()
    formData.set("email", "New@Example.com ")
    formData.set("code", "123456")

    await confirmRecoveryEmailChange(initialState, formData)
    expect(mocks.redirect).toHaveBeenCalledWith("/account/security?emailChanged=1")
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
