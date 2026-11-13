import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  confirmRecoveryEmailVerification: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  getActivationClaimStatus: vi.fn(),
  getRecoveryEmail: vi.fn(),
  headCoachSetupAvailable: vi.fn(() => true),
  redirect: vi.fn((target: string) => {
    throw Object.assign(new Error(`redirect:${target}`), { target })
  }),
  requestRecoveryEmailVerification: vi.fn(),
  validHeadCoachSetupToken: vi.fn(() => true),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet, set: mocks.cookieSet })),
  headers: vi.fn(async () => new Headers()),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/credential-service", () => ({
  ACTIVATION_CLAIM_COOKIE: "activation",
  getActivationClaimStatus: mocks.getActivationClaimStatus,
  verifyCurrentPasswordAttempt: vi.fn(),
}))
vi.mock("@/lib/auth/cookie-policy", () => ({ secureAuthCookiesRequired: vi.fn(() => false) }))
vi.mock("@/lib/auth/recovery-service", () => ({
  confirmRecoveryEmailVerification: mocks.confirmRecoveryEmailVerification,
  getRecoveryEmail: mocks.getRecoveryEmail,
  HEAD_SETUP_EMAIL_COOKIE: "head-setup-email",
  HEAD_SETUP_VERIFIED_EMAIL_LIFETIME_MS: 30 * 60 * 1000,
  recoverySubjectKeyForAccount: vi.fn((accountId: string) => accountId),
  recoverySubjectKeyForHeadSetup: vi.fn(() => "head-setup-subject"),
  requestRecoveryEmailVerification: mocks.requestRecoveryEmailVerification,
  verifyFreshAccountSecondFactor: vi.fn(),
}))
vi.mock("@/lib/auth/initial-setup", () => ({
  HEAD_COACH_SETUP_COOKIE: "head-setup",
  HEAD_COACH_SETUP_NAME_COOKIE: "head-setup-name",
  headCoachSetupAvailable: mocks.headCoachSetupAvailable,
  validHeadCoachSetupToken: mocks.validHeadCoachSetupToken,
}))
vi.mock("@/lib/auth/identity", () => ({
  normalizeFullName: vi.fn((value: string) => value.trim().replace(/\s+/gu, " ")),
}))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
}))
vi.mock("@/lib/data", () => ({ sessionProvider: { getCurrentIdentity: vi.fn() } }))
vi.mock("@/lib/auth/coach-access", () => ({ getCoachAccessProfile: vi.fn() }))

import {
  confirmActivationRecoveryEmail,
  confirmHeadSetupRecoveryEmail,
  requestActivationRecoveryEmail,
} from "@/app/account/recovery-email/actions"

const initialState = { email: "", error: null, sent: false }

function form(fields: Record<string, string>) {
  const formData = new FormData()
  for (const [name, value] of Object.entries(fields)) formData.set(name, value)
  return formData
}

/*
 * /activate only offers the recovery-email step when no address is on file, but
 * the two actions behind it checked nothing beyond "approved" -- and confirming
 * upserts, so a posted request could replace an address already verified. The
 * signed-in enrolment already refused that; these now hold the same line.
 */
describe("the recovery-email step before activation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookieGet.mockReturnValue({ value: "receipt" })
    mocks.getActivationClaimStatus.mockReturnValue({
      academyId: "SMBA-PL-0042",
      accountId: "player-1",
      fullName: "Mira Rao",
      role: "player",
      state: "approved",
    })
    mocks.getRecoveryEmail.mockReturnValue({ email: "family@example.com", verifiedAt: new Date() })
  })

  it("will not send a code to replace an address already on file", async () => {
    await expect(requestActivationRecoveryEmail(initialState, form({ email: "other@example.com" })))
      .rejects.toMatchObject({ target: "/activate" })
    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("will not confirm a replacement either", async () => {
    await expect(confirmActivationRecoveryEmail(
      initialState,
      form({ code: "123456", email: "other@example.com" }),
    )).rejects.toMatchObject({ target: "/activate" })
    expect(mocks.confirmRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("still enrols an account that has no address yet", async () => {
    mocks.getRecoveryEmail.mockReturnValue(undefined)
    mocks.requestRecoveryEmailVerification.mockResolvedValue({ email: "family@example.com" })

    await expect(requestActivationRecoveryEmail(initialState, form({ email: "family@example.com" })))
      .resolves.toEqual({ email: "family@example.com", error: null, sent: true })
  })
})

describe("head-coach setup email step", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookieGet.mockReturnValue({ value: "setup-token" })
    mocks.confirmRecoveryEmailVerification.mockReturnValue({
      email: "head.coach@example.com",
      receiptToken: "receipt-token",
    })
  })

  /*
   * The name used to travel to the next step as `?name=`, so the head coach's
   * full name landed in browser history and server logs. And the email cookie
   * lasted ten minutes, matching an expiry that was counted from when the code
   * was sent rather than verified.
   */
  it("carries the name in a cookie, not the address, for the verified email's own window", async () => {
    await expect(confirmHeadSetupRecoveryEmail(initialState, form({
      code: "123456",
      email: "head.coach@example.com",
      fullName: "Sathiya  Moorthy",
    }))).rejects.toMatchObject({ target: "/setup/head-coach" })

    expect(mocks.redirect).toHaveBeenCalledWith("/setup/head-coach")
    const expected = expect.objectContaining({
      httpOnly: true,
      maxAge: 30 * 60,
      path: "/setup/head-coach",
    })
    expect(mocks.cookieSet).toHaveBeenCalledWith("head-setup-email", "receipt-token", expected)
    expect(mocks.cookieSet).toHaveBeenCalledWith("head-setup-name", "Sathiya Moorthy", expected)
  })
})
