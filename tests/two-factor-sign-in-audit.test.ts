/**
 * Second-factor sign-in leaves a trail.
 *
 * A wrong authenticator code at sign-in wrote nothing, and a recovery code --
 * which gets the head coach and the owner past the authenticator -- wrote
 * nothing either, success or failure. Guessing the second factor on the most
 * privileged accounts was invisible, and so was someone using a stolen code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieHeader: vi.fn<() => string | undefined>(() => "smba.two_factor=challenge-id.signature%3D; other=1"),
  findVerificationValue: vi.fn(),
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
  verifyBackupCode: vi.fn(),
  verifyTOTP: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const cookie = mocks.cookieHeader()
    return new Headers(cookie === undefined ? {} : { cookie })
  }),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({
    $context: Promise.resolve({
      createAuthCookie: (name: string) => ({ attributes: {}, name: `smba.${name}` }),
      internalAdapter: { findVerificationValue: mocks.findVerificationValue },
    }),
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
  releaseLoginAttempt: vi.fn(),
  releaseSecondFactorAttempt: mocks.releaseSecondFactorAttempt,
  reserveLoginAttempt: vi.fn(() => true),
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

describe("second-factor sign-in is audited and metered per account", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookieHeader.mockReturnValue("smba.two_factor=challenge-id.signature%3D; other=1")
    mocks.getRawAuthSession.mockResolvedValue(null)
    mocks.findVerificationValue.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      value: "head-coach",
    })
    mocks.reserveSecondFactorAttempt.mockReturnValue(true)
    mocks.postAuthenticationDestination.mockReturnValue("/coach")
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.selectGet.mockReturnValue({ role: "coach" })
  })

  it("spends one guess from the challenged account's budget before checking the code", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    await verifyTotpSignIn(initialState, form("code", "123456"))
    expect(mocks.findVerificationValue).toHaveBeenCalledWith("challenge-id")
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "challenge")
    expect(mocks.reserveSecondFactorAttempt.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.verifyTOTP.mock.invocationCallOrder[0]!)
    expect(mocks.releaseSecondFactorAttempt).not.toHaveBeenCalled()
  })

  it("refuses without checking the code once the account's budget is spent", async () => {
    mocks.reserveSecondFactorAttempt.mockReturnValue(false)
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "Too many attempts. Wait a few minutes before trying again.",
    })
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh"))).resolves.toEqual({
      error: "Too many attempts. Wait a few minutes before trying again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "login_rate_limited",
      metadata: { factor: "second_factor", operation: "sign_in" },
      outcome: "blocked",
    }))
  })

  it("records a wrong authenticator code against the account being challenged", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "That code was not accepted. Wait for a new code and try again.",
    })
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "totp_failed",
      ipHash: "ip-hash",
      metadata: { method: "totp", operation: "sign_in" },
      outcome: "failure",
    }))
  })

  it("refuses, without checking a code, a request that has no sign-in waiting on a second factor", async () => {
    mocks.cookieHeader.mockReturnValue(undefined)
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "Your sign-in has expired. Sign in again.",
    })
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh"))).resolves.toEqual({
      error: "Your sign-in has expired. Sign in again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled()
    expect(mocks.reserveSecondFactorAttempt).not.toHaveBeenCalled()
  })

  // With a session in the request, Better Auth checks the code against the
  // session's account on a path with no lockout: an unlimited guessing oracle
  // for anyone holding a head-coach or owner session.
  it("sends a signed-in caller on without checking any code", async () => {
    mocks.getRawAuthSession.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyTotpSignIn(initialState, form("code", "123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled()
  })

  // The old check matched the cookie's name only, so `two_factor=x` from anyone
  // wrote a failure row and could trip the monitor's second-factor alert.
  it("refuses a made-up challenge cookie that matches no real sign-in", async () => {
    mocks.findVerificationValue.mockResolvedValue(null)
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "Your sign-in has expired. Sign in again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled()
  })

  it("refuses an expired challenge", async () => {
    mocks.findVerificationValue.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1_000),
      value: "head-coach",
    })
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "Your sign-in has expired. Sign in again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("refuses a cookie with no signature part", async () => {
    mocks.cookieHeader.mockReturnValue("smba.two_factor=no-signature")
    await verifyTotpSignIn(initialState, form("code", "123456"))
    expect(mocks.findVerificationValue).not.toHaveBeenCalled()
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  // Next's cookie parser keeps the last duplicate and Better Auth's keeps the
  // first, so two copies could show this code one challenge (or none) while
  // Better Auth checked another, skipping the budget.
  it("refuses a request carrying the challenge cookie twice", async () => {
    mocks.cookieHeader.mockReturnValue(
      "smba.two_factor=challenge-id.signature%3D; smba.two_factor=decoy.sig%3D",
    )
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "Your sign-in has expired. Sign in again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.reserveSecondFactorAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ["padding around the name", "a=1;smba.two_factor =challenge-id.signature%3D"],
    ["a quoted value", "smba.two_factor=\"challenge-id.signature%3D\""],
  ])("reads the challenge the way Better Auth does despite %s", async (_label, cookie) => {
    mocks.cookieHeader.mockReturnValue(cookie)
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    await verifyTotpSignIn(initialState, form("code", "123456"))
    expect(mocks.findVerificationValue).toHaveBeenCalledWith("challenge-id")
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "challenge")
  })

  it("records a wrong recovery code", async () => {
    mocks.verifyBackupCode.mockRejectedValue(new Error("INVALID_BACKUP_CODE"))
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh")))
      .resolves.toEqual({ error: "That recovery code was not accepted." })
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "challenge")
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "totp_failed",
      metadata: { method: "backup_code", operation: "sign_in" },
      outcome: "failure",
    }))
  })

  it("records a recovery code being used, tagged so the monitor can alert on it, and hands the guess back", async () => {
    mocks.verifyBackupCode.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.releaseSecondFactorAttempt).toHaveBeenCalledWith("head-coach")
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "totp_verified",
      metadata: { method: "backup_code" },
      outcome: "success",
    }))
  })

  it("tags an ordinary authenticator sign-in differently, and hands the guess back", async () => {
    mocks.verifyTOTP.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyTotpSignIn(initialState, form("code", "123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.releaseSecondFactorAttempt).toHaveBeenCalledWith("head-coach")
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "totp_verified",
      metadata: { method: "totp" },
    }))
  })

  it("still signs the person in when the success audit write fails", async () => {
    mocks.verifyBackupCode.mockResolvedValue({ user: { id: "head-coach" } })
    mocks.writeAuthSecurityEvent.mockImplementation(() => { throw new Error("database is down") })
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
  })

  it("never lets a failed audit write change what the person is told", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    mocks.writeAuthSecurityEvent.mockImplementation(() => { throw new Error("database is down") })
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "That code was not accepted. Wait for a new code and try again.",
    })
  })

  it("refuses rather than skip the budget when the challenge lookup itself fails", async () => {
    mocks.findVerificationValue.mockRejectedValue(new Error("database is down"))
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "Your sign-in has expired. Sign in again.",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })
})
