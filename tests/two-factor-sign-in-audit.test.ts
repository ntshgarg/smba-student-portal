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
  requestHeaders: vi.fn(() => new Headers()),
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
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mocks.requestHeaders()) }))
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


import { verifyBackupCodeSignIn, verifyTotpSignIn } from "@/app/auth/two-factor/actions"

const initialState = { error: null }

function form(field: string, value: string) {
  const formData = new FormData()
  formData.set(field, value)
  return formData
}

describe("second-factor sign-in is audited", () => {
  const withChallenge = () => new Headers({ cookie: "smba.two_factor=signed-challenge; other=1" })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestHeaders.mockImplementation(withChallenge)
    mocks.postAuthenticationDestination.mockReturnValue("/coach")
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.selectGet.mockReturnValue({ role: "coach" })
  })

  it("records a wrong authenticator code, without naming an account that is not signed in yet", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    await expect(verifyTotpSignIn(initialState, form("code", "123456"))).resolves.toEqual({
      error: "That code was not accepted. Wait for a new code and try again.",
    })
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "totp_failed",
      ipHash: "ip-hash",
      metadata: { method: "totp", operation: "sign_in" },
      outcome: "failure",
    }))
    expect(mocks.writeAuthSecurityEvent.mock.calls[0]?.[0]).not.toHaveProperty("accountId")
  })

  it("does not record a failure from a request that has no sign-in waiting on a second factor", async () => {
    mocks.requestHeaders.mockImplementation(() => new Headers())
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_TWO_FACTOR_COOKIE"))
    await verifyTotpSignIn(initialState, form("code", "123456"))
    await verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh"))
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled()
  })

  it("recognises the challenge cookie under its HTTPS prefix too", async () => {
    mocks.requestHeaders.mockImplementation(
      () => new Headers({ cookie: "__Secure-smba.two_factor=signed" }),
    )
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    await verifyTotpSignIn(initialState, form("code", "123456"))
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledOnce()
  })

  it("records a wrong recovery code", async () => {
    mocks.verifyBackupCode.mockRejectedValue(new Error("INVALID_BACKUP_CODE"))
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh")))
      .resolves.toEqual({ error: "That recovery code was not accepted." })
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "totp_failed",
      metadata: { method: "backup_code", operation: "sign_in" },
      outcome: "failure",
    }))
  })

  it("records a recovery code being used, tagged so the monitor can alert on it", async () => {
    mocks.verifyBackupCode.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyBackupCodeSignIn(initialState, form("backupCode", "abcd-efgh")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "totp_verified",
      metadata: { method: "backup_code" },
      outcome: "success",
    }))
  })

  it("tags an ordinary authenticator sign-in differently", async () => {
    mocks.verifyTOTP.mockResolvedValue({ user: { id: "head-coach" } })
    await expect(verifyTotpSignIn(initialState, form("code", "123456")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")
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

  // Last on purpose: the cap is per address and lives for the life of the module,
  // so exhausting it earlier would silence every failure test after it.
  it("caps how many failures one address can write in an hour", async () => {
    mocks.requestHeaders.mockImplementation(
      () => new Headers({ cookie: "smba.two_factor=signed", "x-test-cap": "1" }),
    )
    mocks.verifyTOTP.mockRejectedValue(new Error("INVALID_CODE"))
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await verifyTotpSignIn(initialState, form("code", "123456"))
    }
    expect(mocks.writeAuthSecurityEvent.mock.calls.length).toBeLessThanOrEqual(10)
    expect(mocks.writeAuthSecurityEvent.mock.calls.length).toBeGreaterThan(0)
  })
})
