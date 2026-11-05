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
  enableTwoFactor: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  postAuthenticationDestination: vi.fn(() => "/coach"),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  releaseSecondFactorAttempt: vi.fn(),
  reserveSecondFactorAttempt: vi.fn(() => true),
  selectGet: vi.fn(),
  findVerificationValue: vi.fn(),
  releaseLoginAttempt: vi.fn(),
  requestHeaders: vi.fn(() => new Headers()),
  reserveLoginAttempt: vi.fn(() => true),
  twoFactorRow: vi.fn<() => { id: string } | undefined>(() => undefined),
  verifyBackupCode: vi.fn(),
  verifyTOTP: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mocks.requestHeaders()) }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({
    $context: Promise.resolve({
      createAuthCookie: (name: string) => ({ attributes: {}, name: `smba.${name}` }),
      internalAdapter: { findVerificationValue: mocks.findVerificationValue },
    }),
    api: {
      disableTwoFactor: vi.fn(),
      enableTwoFactor: mocks.enableTwoFactor,
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
  releaseLoginAttempt: mocks.releaseLoginAttempt,
  releaseSecondFactorAttempt: mocks.releaseSecondFactorAttempt,
  reserveLoginAttempt: mocks.reserveLoginAttempt,
  reserveSecondFactorAttempt: mocks.reserveSecondFactorAttempt,
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
vi.mock("@/lib/db/client", async () => {
  const { authTwoFactors } = await import("@/lib/db/schema")
  return {
    initializeDatabase: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({ get: table === authTwoFactors ? mocks.twoFactorRow : mocks.selectGet }),
        }),
      }),
    }),
  }
})

import { confirmTotpSetup, startTotpSetup, verifyTotpSignIn } from "@/app/auth/two-factor/actions"

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
    mocks.twoFactorRow.mockReturnValue(undefined)
    mocks.reserveSecondFactorAttempt.mockReturnValue(true)
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
    // A half-finished sign-in: no session yet, and a live challenge cookie.
    mocks.getRawAuthSession.mockResolvedValue(null)
    mocks.requestHeaders.mockImplementation(() => new Headers({ cookie: "smba.two_factor=2fa-id.sig%3D" }))
    mocks.findVerificationValue.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      value: "head-coach",
    })
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

/*
 * The setup screen confirms a code for an authenticator being added. It used to
 * run for an account that already had one, where the code was tested against
 * the real secret with no lockout -- Better Auth locks only at sign-in -- so a
 * stolen head-coach or owner session could guess the live code without limit
 * and then use it to replace the authenticator.
 */
describe("authenticator setup is only for an account without one", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: false },
    })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.postAuthenticationDestination.mockReturnValue("/coach")
    mocks.selectGet.mockReturnValue({ role: "coach" })
    mocks.verifyTOTP.mockResolvedValue({ user: { id: "head-coach" } })
    mocks.twoFactorRow.mockReturnValue(undefined)
    mocks.reserveSecondFactorAttempt.mockReturnValue(true)
  })

  it("sends an account with a working authenticator away without checking the code", async () => {
    mocks.twoFactorRow.mockReturnValue({ id: "existing-factor" })
    await expect(confirmTotpSetup(initialState, codeData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.reserveSecondFactorAttempt).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled()
  })

  it("trusts the database over a session that says no authenticator", async () => {
    mocks.twoFactorRow.mockReturnValue({ id: "existing-factor" })
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: false },
    })
    await expect(confirmTotpSetup(initialState, codeData("123456")))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("also refuses when the session says the authenticator is on", async () => {
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: true },
    })
    await expect(confirmTotpSetup(initialState, codeData("123456")))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("meters enrolment codes from the account's second-factor budget", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    await expect(confirmTotpSetup(initialState, codeData("123456"))).resolves.toEqual({
      error: "That code was not accepted. Wait for a new code and try again.",
    })
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "session")
    expect(mocks.releaseSecondFactorAttempt).not.toHaveBeenCalled()
  })

  it("stops once that budget is spent", async () => {
    mocks.reserveSecondFactorAttempt.mockReturnValue(false)
    await expect(confirmTotpSetup(initialState, codeData("123456"))).resolves.toEqual({
      error: "Too many attempts. Wait a few minutes before trying again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("hands the guess back when the new authenticator is confirmed", async () => {
    await expect(confirmTotpSetup(initialState, codeData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.releaseSecondFactorAttempt).toHaveBeenCalledWith("head-coach")
  })
})

describe("starting authenticator setup meters the password check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: false },
    })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.postAuthenticationDestination.mockReturnValue("/coach")
    mocks.selectGet.mockReturnValue({ identifier: "SMBA-HC-0001", role: "coach" })
    mocks.twoFactorRow.mockReturnValue(undefined)
    mocks.reserveLoginAttempt.mockReturnValue(true)
    mocks.enableTwoFactor.mockResolvedValue({
      backupCodes: ["AAAA-1111"],
      method: "totp",
      totpURI: "otpauth://totp/x",
    })
  })

  function passwordData(password = "Current secure password!") {
    const formData = new FormData()
    formData.set("password", password)
    return formData
  }

  it("reserves a guess before Better Auth checks the password, and hands it back when right", async () => {
    await expect(startTotpSetup({ error: null, setup: null }, passwordData()))
      .resolves.toMatchObject({ error: null })
    expect(mocks.reserveLoginAttempt).toHaveBeenCalledWith({ ipHash: "ip-hash", subjectHash: "subject-hash" })
    expect(mocks.reserveLoginAttempt.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.enableTwoFactor.mock.invocationCallOrder[0]!)
    expect(mocks.releaseLoginAttempt).toHaveBeenCalled()
  })

  it("keeps the guess spent when the password is wrong", async () => {
    mocks.enableTwoFactor.mockRejectedValue(new Error("INVALID_PASSWORD"))
    await expect(startTotpSetup({ error: null, setup: null }, passwordData("wrong")))
      .resolves.toEqual({ error: "That password could not be verified.", setup: null })
    expect(mocks.releaseLoginAttempt).not.toHaveBeenCalled()
  })

  it("stops before the check once the budget is spent", async () => {
    mocks.reserveLoginAttempt.mockReturnValue(false)
    await expect(startTotpSetup({ error: null, setup: null }, passwordData()))
      .resolves.toEqual({
        error: "Too many attempts. Wait a few minutes before trying again.",
        setup: null,
      })
    expect(mocks.enableTwoFactor).not.toHaveBeenCalled()
  })

  it("refuses an account that already has a working authenticator", async () => {
    mocks.twoFactorRow.mockReturnValue({ id: "existing-factor" })
    await expect(startTotpSetup({ error: null, setup: null }, passwordData()))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.enableTwoFactor).not.toHaveBeenCalled()
  })
})
