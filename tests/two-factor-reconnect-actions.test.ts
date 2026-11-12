import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  disableTwoFactor: vi.fn(),
  forgetTrustedDevices: vi.fn<(accountId: string) => number>(() => 0),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
  releaseLoginAttempt: vi.fn(),
  releaseSecondFactorAttempt: vi.fn(),
  reserveLoginAttempt: vi.fn(),
  reserveSecondFactorAttempt: vi.fn(),
  revokeOtherSessions: vi.fn(),
  verifyBackupCode: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  verifyTOTP: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({
    api: {
      disableTwoFactor: mocks.disableTwoFactor,
      revokeOtherSessions: mocks.revokeOtherSessions,
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
  verifyCurrentPassword: mocks.verifyCurrentPassword,
}))
vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
vi.mock("@/lib/auth/second-factor-reset", () => ({
  forgetTrustedDevices: mocks.forgetTrustedDevices,
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: vi.fn(() => "subject-hash"),
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip-hash", userAgent: "test-browser" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))

import { beginAuthenticatorReconnect } from "@/app/auth/two-factor/actions"

function reconnectData(secondFactor: string, password = "Current secure password!") {
  const formData = new FormData()
  formData.set("password", password)
  formData.set("secondFactor", secondFactor)
  return formData
}

describe("authenticator reconnection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({
      academyId: "SMBA-HC-0001",
      role: "coach",
      subjectId: "head-coach",
    })
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: true },
    })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    mocks.reserveLoginAttempt.mockReturnValue(true)
    mocks.reserveSecondFactorAttempt.mockReturnValue(true)
    mocks.verifyCurrentPassword.mockResolvedValue(true)
    mocks.verifyTOTP.mockResolvedValue({ status: true })
    mocks.verifyBackupCode.mockResolvedValue({ status: true })
    mocks.revokeOtherSessions.mockResolvedValue({ status: true })
    mocks.disableTwoFactor.mockResolvedValue({ status: true })
  })

  it("rejects an incorrect password before consuming a second factor", async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false)

    await expect(beginAuthenticatorReconnect(
      { error: null, errorField: null },
      reconnectData("123456", "wrong password"),
    )).resolves.toEqual({
      error: "The current password could not be verified.",
      errorField: "password",
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.disableTwoFactor).not.toHaveBeenCalled()
    // The guess was reserved before the check and is not handed back.
    expect(mocks.reserveLoginAttempt).toHaveBeenCalledWith({ ipHash: "ip-hash", subjectHash: "subject-hash" })
    expect(mocks.releaseLoginAttempt).not.toHaveBeenCalled()
  })

  it("uses a current authenticator code, retires other sessions and starts fresh setup", async () => {
    await expect(beginAuthenticatorReconnect(
      { error: null, errorField: null },
      reconnectData("123456"),
    )).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.verifyTOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: "123456", trustDevice: false },
    }))
    expect(mocks.revokeOtherSessions).toHaveBeenCalled()
    expect(mocks.disableTwoFactor).toHaveBeenCalledWith(expect.objectContaining({
      body: { password: "Current secure password!" },
    }))
    expect(mocks.redirect).toHaveBeenLastCalledWith("/auth/two-factor/setup?reconnect=1")
    // A lost phone's trust goes too, not only this browser's.
    expect(mocks.forgetTrustedDevices).toHaveBeenCalledWith("head-coach")
    expect(mocks.releaseLoginAttempt).toHaveBeenCalledWith({ ipHash: "ip-hash", subjectHash: "subject-hash" })
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "session")
    expect(mocks.releaseSecondFactorAttempt).toHaveBeenCalledWith("head-coach")
  })

  it("accepts an unused recovery code when the phone entry is gone", async () => {
    await expect(beginAuthenticatorReconnect(
      { error: null, errorField: null },
      reconnectData("saved-recovery-code"),
    )).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.verifyBackupCode).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        code: "saved-recovery-code",
        disableSession: false,
        trustDevice: false,
      },
    }))
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("keeps the existing authenticator intact when the second factor is rejected", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("invalid code"))

    await expect(beginAuthenticatorReconnect(
      { error: null, errorField: null },
      reconnectData("654321"),
    )).resolves.toEqual({
      error: "That authenticator or recovery code was not accepted.",
      errorField: "secondFactor",
    })
    expect(mocks.disableTwoFactor).not.toHaveBeenCalled()
    expect(mocks.forgetTrustedDevices).not.toHaveBeenCalled()
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "session")
    expect(mocks.releaseSecondFactorAttempt).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "totp_failed",
      metadata: { operation: "reconnect" },
      outcome: "failure",
    }))
  })

  it("blocks repeated reconnect attempts before checking another credential", async () => {
    mocks.reserveLoginAttempt.mockReturnValue(false)

    await expect(beginAuthenticatorReconnect(
      { error: null, errorField: null },
      reconnectData("123456"),
    )).resolves.toEqual({
      error: "Too many attempts. Wait a few minutes before trying again.",
      errorField: null,
    })
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled()
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "login_rate_limited",
      metadata: { operation: "totp_reconnect" },
      outcome: "blocked",
    }))
  })
  it("stops before checking the code once the account's second-factor budget is spent", async () => {
    mocks.reserveSecondFactorAttempt.mockReturnValue(false)

    await expect(beginAuthenticatorReconnect(
      { error: null, errorField: null },
      reconnectData("123456"),
    )).resolves.toEqual({
      error: "Too many attempts. Wait a few minutes before trying again.",
      errorField: null,
    })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.disableTwoFactor).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "login_rate_limited",
      metadata: { factor: "second_factor", operation: "totp_reconnect" },
      outcome: "blocked",
    }))
  })
})
