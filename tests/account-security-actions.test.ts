import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  disableTwoFactor: vi.fn(),
  generateBackupCodes: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  loginIsBlocked: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
  removePinCredential: vi.fn(),
  revokeOtherSessions: vi.fn(),
  setPinCredential: vi.fn(),
  verifyBackupCode: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  verifyCurrentPasswordAttempt: vi.fn(),
  verifyTOTP: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/auth/better-auth", () => ({
  auth: { api: {} },
  // The reconnect flow's two calls are wired up here so the reissue tests can
  // prove they are never reached; see app/account/security/actions.ts.
  getAuth: () => ({
    api: {
      disableTwoFactor: mocks.disableTwoFactor,
      generateBackupCodes: mocks.generateBackupCodes,
      revokeOtherSessions: mocks.revokeOtherSessions,
      verifyBackupCode: mocks.verifyBackupCode,
      verifyTOTP: mocks.verifyTOTP,
    },
  }),
}))
vi.mock("@/lib/auth/account-service", () => ({
  approveRegistration: vi.fn(),
  rejectRegistration: vi.fn(),
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
}))
vi.mock("@/lib/auth/credential-service", () => ({
  hasPinCredential: vi.fn(),
  loginIsBlocked: mocks.loginIsBlocked,
  recordLoginFailure: mocks.recordLoginFailure,
  recordLoginSuccess: mocks.recordLoginSuccess,
  removePinCredential: mocks.removePinCredential,
  setPinCredential: mocks.setPinCredential,
  validateNewPassword: vi.fn(),
  validatePin: vi.fn(),
  verifyCurrentPassword: mocks.verifyCurrentPassword,
  verifyCurrentPasswordAttempt: mocks.verifyCurrentPasswordAttempt,
}))
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: (value: string) => `hash:${value}`,
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))
vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))

import {
  reissueRecoveryCodesAction,
  removePinAction,
  savePinAction,
} from "@/app/account/security/actions"

function passwordData() {
  const formData = new FormData()
  formData.set("currentPassword", "Current secure password!")
  return formData
}

describe("role-aware PIN management", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyCurrentPasswordAttempt.mockResolvedValue("verified")
  })

  it("prevents the head coach from removing the mandatory PIN", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })

    await expect(removePinAction({ error: null, success: null }, passwordData()))
      .resolves.toEqual({ error: "The head-coach account requires a PIN.", success: null })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })

  it("rejects an empty PIN form before checking credentials", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })

    await expect(savePinAction({ error: null, success: null }, new FormData()))
      .resolves.toEqual({ error: "Enter your current password.", success: null })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("prevents the platform owner from removing the mandatory PIN", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      role: "platform_admin",
      subjectId: "platform-owner",
    })

    await expect(removePinAction({ error: null, success: null }, passwordData()))
      .resolves.toEqual({ error: "The platform-owner account requires a PIN.", success: null })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })

  it("keeps PIN removal available to a assistant coach after password confirmation", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "junior-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "junior_coach" })

    await expect(removePinAction({ error: null, success: null }, passwordData()))
      .resolves.toEqual({
        error: null,
        success: "PIN login removed. Use your password to sign in.",
      })
    expect(mocks.removePinCredential).toHaveBeenCalledWith("junior-one")
  })
})

/**
 * F-8. The head coach who loses the printed codes had no way back short of the
 * platform-admin approval queue. Two hazards in adding one. Reaching for
 * `beginAuthenticatorReconnect`, which also ends in ten fresh codes but revokes
 * every other session and disables the factor on the way there. And gating ten
 * permanent second-factor bypasses on the password alone, which is weaker than
 * the gate the repo already puts on the one other action that touches this
 * credential.
 */
describe("reissuing the authenticator recovery codes", () => {
  const identity = {
    academyId: "SMBA-HC-0001",
    role: "coach",
    subjectId: "head-coach",
  }

  /** The password and a six-digit authenticator code, as the form sends them. */
  function reissueData(secondFactor = "123456") {
    const formData = passwordData()
    formData.set("secondFactor", secondFactor)
    return formData
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(identity)
    mocks.getRawAuthSession.mockResolvedValue({
      user: { id: "head-coach", twoFactorEnabled: true },
    })
    mocks.loginIsBlocked.mockReturnValue(false)
    mocks.verifyCurrentPassword.mockResolvedValue(true)
    mocks.verifyTOTP.mockResolvedValue({ status: true })
    mocks.verifyBackupCode.mockResolvedValue({ status: true })
    mocks.generateBackupCodes.mockResolvedValue({
      backupCodes: ["AAAA-1111", "BBBB-2222"],
      status: true,
    })
  })

  it("issues a replacement set without disturbing the factor or other devices", async () => {
    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: ["AAAA-1111", "BBBB-2222"],
        error: null,
        errorField: null,
      })

    expect(mocks.generateBackupCodes).toHaveBeenCalledWith(expect.objectContaining({
      body: { password: "Current secure password!" },
    }))
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled()
    expect(mocks.disableTwoFactor).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "head-coach",
      eventType: "totp_recovery_codes_reissued",
      outcome: "success",
    }))
  })

  it("checks the second factor the reconnect flow checks, not the password alone", async () => {
    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toMatchObject({ error: null })

    expect(mocks.verifyTOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: "123456", trustDevice: false },
    }))
    // The whole point of the local limiter here: the budget is only cleared
    // once both factors are past, so second-factor guesses accumulate.
    expect(mocks.recordLoginSuccess).toHaveBeenCalledWith("hash:SMBA-HC-0001")
  })

  it("reads anything that is not six digits as a recovery code", async () => {
    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData("AAAA-1111")))
      .resolves.toMatchObject({ error: null })

    expect(mocks.verifyBackupCode).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: "AAAA-1111", disableSession: false, trustDevice: false },
    }))
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("mints nothing when the second factor is rejected, and spends an attempt", async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error("invalid code"))

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "That authenticator or recovery code was not accepted.",
        errorField: "secondFactor",
      })
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith({
      ipHash: "ip",
      subjectHash: "hash:SMBA-HC-0001",
    })
    expect(mocks.recordLoginSuccess).not.toHaveBeenCalled()
  })

  it("asks for the second factor before spending one, when the field is empty", async () => {
    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, passwordData()))
      .resolves.toEqual({
        codes: null,
        error: "Enter a current authenticator code or an unused recovery code.",
        errorField: "secondFactor",
      })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled()
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
  })

  it("mints nothing until the current password is confirmed", async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false)

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "The current password could not be verified.",
        errorField: "currentPassword",
      })
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
    // A wrong password must not burn the recovery code typed beside it.
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled()
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
  })

  it("stops at the rate limiter rather than reporting a wrong password", async () => {
    mocks.loginIsBlocked.mockReturnValue(true)

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "Too many attempts. Wait a few minutes before trying again.",
        errorField: null,
      })
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled()
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
  })

  it("refuses an empty form before spending an attempt", async () => {
    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, new FormData()))
      .resolves.toEqual({
        codes: null,
        error: "Enter your current password.",
        errorField: "currentPassword",
      })
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled()
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
  })

  it("refuses a preview session, whose credential gates would test the wrong account", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ ...identity, previewMode: true })

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "Leave preview mode to manage recovery codes.",
        errorField: null,
      })
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled()
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
  })

  it("keeps the codes off screen when Better Auth refuses the call", async () => {
    mocks.generateBackupCodes.mockRejectedValue(new Error("nope"))

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "The recovery codes could not be reissued. Try again.",
        errorField: null,
      })
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: "totp_recovery_codes_reissued",
    }))
  })
})
