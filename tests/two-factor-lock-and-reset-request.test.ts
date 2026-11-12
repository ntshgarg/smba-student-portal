/**
 * The authenticator check after the password or PIN.
 *
 * While Better Auth's eight-miss lock stands, every code is refused -- the right
 * one too -- and the page used to say "That code was not accepted", so a head
 * coach typed the right code again and again and then spent recovery codes
 * that were refused the same way. And a coach who got back in left any reset
 * request they had sent waiting for the owner, who could then approve it and
 * wipe the authenticator the coach had just used.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findVerificationValue: vi.fn(),
  getRawAuthSession: vi.fn(),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  releaseSecondFactorAttempt: vi.fn(),
  reserveSecondFactorAttempt: vi.fn(() => true),
  selectGet: vi.fn(),
  verifyBackupCode: vi.fn(),
  verifyTOTP: vi.fn(),
  withdrawPendingAuthenticatorResetRequests: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "smba.two_factor=challenge-id.signature%3D" })),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({
    $context: Promise.resolve({
      createAuthCookie: (name: string) => ({ attributes: {}, name: `smba.${name}` }),
      internalAdapter: { findVerificationValue: mocks.findVerificationValue },
    }),
    api: {
      verifyBackupCode: mocks.verifyBackupCode,
      verifyTOTP: mocks.verifyTOTP,
    },
  }),
}))
vi.mock("@/lib/auth/authenticator-reset-service", () => ({
  withdrawPendingAuthenticatorResetRequests: mocks.withdrawPendingAuthenticatorResetRequests,
}))
vi.mock("@/lib/auth/coach-access", () => ({ getCoachAccessProfile: vi.fn() }))
vi.mock("@/lib/auth/credential-service", () => ({
  releaseLoginAttempt: vi.fn(),
  releaseSecondFactorAttempt: mocks.releaseSecondFactorAttempt,
  reserveLoginAttempt: vi.fn(() => true),
  reserveSecondFactorAttempt: mocks.reserveSecondFactorAttempt,
  verifyCurrentPassword: vi.fn(),
}))
vi.mock("@/lib/auth/post-auth-destination", () => ({
  postAuthenticationDestination: vi.fn(() => "/coach"),
}))
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: vi.fn(() => "subject-hash"),
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip-hash", userAgent: "test-browser" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))
vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
vi.mock("@/lib/data", () => ({ sessionProvider: { getCurrentIdentity: vi.fn() } }))
vi.mock("@/lib/db/client", () => ({
  initializeDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: mocks.selectGet }) }) }),
  }),
}))

import { verifyBackupCodeSignIn, verifyTotpSignIn } from "@/app/auth/two-factor/actions"

const initialState = { error: null }

function form(field: string, value: string) {
  const formData = new FormData()
  formData.set(field, value)
  return formData
}

describe("the authenticator check at sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRawAuthSession.mockResolvedValue(null)
    mocks.findVerificationValue.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      value: "head-coach",
    })
    mocks.reserveSecondFactorAttempt.mockReturnValue(true)
    mocks.selectGet.mockReturnValue({ role: "coach" })
  })

  it("tells the coach to wait while the lock stands, and checks no code", async () => {
    mocks.selectGet.mockReturnValue({ lockedUntil: new Date(Date.now() + 10 * 60_000), role: "coach" })

    const totp = await verifyTotpSignIn(initialState, form("code", "123456"))
    const backup = await verifyBackupCodeSignIn(initialState, form("backupCode", "SPARE-CODE"))

    for (const result of [totp, backup]) {
      expect(result.error).toMatch(/paused for up to 15 minutes/u)
      expect(result.error).not.toMatch(/not accepted/u)
    }
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled()
    expect(mocks.reserveSecondFactorAttempt).not.toHaveBeenCalled()
  })

  it("tells the coach to wait when the lock lands during the check", async () => {
    mocks.verifyTOTP.mockRejectedValue(Object.assign(new Error("ACCOUNT_TEMPORARILY_LOCKED"), {
      status: "TOO_MANY_REQUESTS",
    }))
    const result = await verifyTotpSignIn(initialState, form("code", "123456"))
    expect(result.error).toMatch(/paused for up to 15 minutes/u)
  })

  it("still calls a wrong code wrong", async () => {
    mocks.verifyTOTP.mockRejectedValue(Object.assign(new Error("INVALID_CODE"), { status: "UNAUTHORIZED" }))
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "That code was not accepted. Wait for a new code and try again.",
    })
  })

  it("leaves a waiting reset request alone when the coach signs in with a code", async () => {
    // The code may come from the stolen phone or printed recovery codes the
    // request is about; the owner's approval must still be able to shut them out.
    mocks.verifyTOTP.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyTotpSignIn(initialState, form("code", "123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")

    mocks.verifyBackupCode.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "SPARE-CODE")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.withdrawPendingAuthenticatorResetRequests).not.toHaveBeenCalled()
  })
})
