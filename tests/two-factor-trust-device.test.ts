/**
 * SEC-6 — enrolment must not silently trust the enrolling browser.
 *
 * confirmTotpSetup hard-coded `trustDevice: true`. better-auth writes a signed
 * trust cookie with trustDeviceMaxAge (30 days, lib/auth/better-auth.ts:156),
 * and the two-factor plugin's /sign-in/username after-hook validates that
 * cookie and returns early — keeping the credential session instead of
 * challenging for TOTP. On a shared courtside tablet that hands anyone with
 * the head coach's password a full head-coach session for a month, defeating
 * SMBA_REQUIRE_COACH_TOTP, and the coach was never asked.
 *
 * The enrolment form has no trust-this-device control. The sign-in challenge
 * does (components/two-factor-verification-form.tsx:102), and the last case
 * here keeps that opt-in alive so the fix cannot be "flip every call to false".
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  postAuthenticationDestination: vi.fn(() => "/coach"),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  selectGet: vi.fn(),
  verifyBackupCode: vi.fn(),
  verifyTOTP: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({
    api: {
      disableTwoFactor: vi.fn(),
      enableTwoFactor: vi.fn(),
      revokeOtherSessions: vi.fn(),
      verifyBackupCode: mocks.verifyBackupCode,
      verifyTOTP: mocks.verifyTOTP,
    },
  }),
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
}))
vi.mock("@/lib/auth/credential-service", () => ({
  loginIsBlocked: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
  verifyCurrentPassword: vi.fn(),
}))
vi.mock("@/lib/auth/post-auth-destination", () => ({
  postAuthenticationDestination: mocks.postAuthenticationDestination,
}))
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: vi.fn(() => "subject-hash"),
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip-hash", userAgent: "test-browser" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))
vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))
vi.mock("@/lib/db/client", () => ({
  initializeDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: mocks.selectGet }) }) }),
  }),
}))

import { confirmTotpSetup, verifyTotpSignIn } from "@/app/auth/two-factor/actions"

const initialState = { error: null }

function codeData(code: string, trustDevice?: string) {
  const formData = new FormData()
  formData.set("code", code)
  if (trustDevice !== undefined) formData.set("trustDevice", trustDevice)
  return formData
}

describe("authenticator enrolment does not grant a trusted device", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: false },
    })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.postAuthenticationDestination.mockReturnValue("/coach")
    mocks.selectGet.mockReturnValue({ role: "coach" })
    mocks.verifyTOTP.mockResolvedValue({ user: { id: "head-coach" } })
  })

  it("verifies the enrolment code without asking for a trust cookie", async () => {
    await expect(confirmTotpSetup(initialState, codeData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")

    expect(mocks.verifyTOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: "123456", trustDevice: false },
    }))
    // Pinned explicitly: `undefined` would let better-auth fall back to its own
    // default, which is not the same guarantee as an explicit refusal.
    expect(mocks.verifyTOTP.mock.calls[0]?.[0]?.body?.trustDevice).toBe(false)
  })

  it("still records the enrolment as successful", async () => {
    await expect(confirmTotpSetup(initialState, codeData("123 456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")

    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "totp_enabled",
      outcome: "success",
    }))
  })

  it("never reaches better-auth when the code is malformed", async () => {
    await expect(confirmTotpSetup(initialState, codeData("12345"))).resolves.toEqual({
      error: "Enter the six-digit code from your authenticator app.",
    })

    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("keeps the sign-in challenge's explicit trust opt-in working", async () => {
    await expect(verifyTotpSignIn(initialState, codeData("123456", "on")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.verifyTOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: "123456", trustDevice: true },
    }))

    mocks.verifyTOTP.mockClear()

    await expect(verifyTotpSignIn(initialState, codeData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.verifyTOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: "123456", trustDevice: false },
    }))
  })
})
