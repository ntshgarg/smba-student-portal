import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  disableTwoFactor: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  loginIsBlocked: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
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
  loginIsBlocked: mocks.loginIsBlocked,
  recordLoginFailure: mocks.recordLoginFailure,
  recordLoginSuccess: mocks.recordLoginSuccess,
  verifyCurrentPassword: mocks.verifyCurrentPassword,
}))
vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
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
    mocks.loginIsBlocked.mockReturnValue(false)
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
    expect(mocks.recordLoginFailure).toHaveBeenCalled()
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
    expect(mocks.recordLoginSuccess).toHaveBeenCalledWith("subject-hash")
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
    expect(mocks.recordLoginFailure).toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "totp_failed",
      metadata: { operation: "reconnect" },
      outcome: "failure",
    }))
  })

  it("blocks repeated reconnect attempts before checking another credential", async () => {
    mocks.loginIsBlocked.mockReturnValue(true)

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
})
