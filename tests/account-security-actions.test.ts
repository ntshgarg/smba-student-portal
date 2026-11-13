import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  disableTwoFactor: vi.fn(),
  forgetTrustedDevices: vi.fn<(accountId: string) => number>(() => 2),
  generateBackupCodes: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  hasActiveSession: vi.fn(),
  releaseLoginAttempt: vi.fn(),
  releaseSecondFactorAttempt: vi.fn(),
  reserveLoginAttempt: vi.fn(),
  reserveSecondFactorAttempt: vi.fn(),
  removePinCredential: vi.fn(),
  revalidatePath: vi.fn(),
  revokeOtherSessions: vi.fn(),
  setPinCredential: vi.fn(),
  verifyBackupCode: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  verifyCurrentPasswordAttempt: vi.fn(),
  verifyTOTP: vi.fn(),
  withdrawPendingAuthenticatorResetRequests: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  },
}))
vi.mock("@/lib/auth/better-auth", () => ({
  auth: { api: {} },
  // The reconnect flow's two calls are wired up here so the reissue tests can
  // prove they are never reached; see app/account/security/actions.ts.
  getAuth: () => ({
    api: {
      changePassword: mocks.changePassword,
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
  releaseLoginAttempt: mocks.releaseLoginAttempt,
  releaseSecondFactorAttempt: mocks.releaseSecondFactorAttempt,
  reserveLoginAttempt: mocks.reserveLoginAttempt,
  reserveSecondFactorAttempt: mocks.reserveSecondFactorAttempt,
  removePinCredential: mocks.removePinCredential,
  setPinCredential: mocks.setPinCredential,
  validateNewPassword: vi.fn(),
  validateNewPin: vi.fn(),
  verifyCurrentPassword: mocks.verifyCurrentPassword,
  verifyCurrentPasswordAttempt: mocks.verifyCurrentPasswordAttempt,
}))
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: (value: string) => `hash:${value}`,
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))
vi.mock("@/lib/auth/session", () => ({ getRawAuthSession: mocks.getRawAuthSession }))
vi.mock("@/lib/auth/second-factor-reset", () => ({
  forgetTrustedDevices: mocks.forgetTrustedDevices,
}))
vi.mock("@/lib/auth/authenticator-reset-service", () => ({
  withdrawPendingAuthenticatorResetRequests: mocks.withdrawPendingAuthenticatorResetRequests,
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: {
    getCurrentIdentity: mocks.getCurrentIdentity,
    hasActiveSession: mocks.hasActiveSession,
  },
}))

import {
  changePasswordAction,
  reissueRecoveryCodesAction,
  removePinAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  savePinAction,
} from "@/app/account/security/actions"
import { SESSION_EXPIRED_DIGEST } from "@/lib/actions/operational-result"

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
    mocks.reserveLoginAttempt.mockReturnValue(true)
    mocks.reserveSecondFactorAttempt.mockReturnValue(true)
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
    // The password guess is handed back once it is right; the code is metered
    // by the account's own second-factor budget, reserved before the check.
    expect(mocks.releaseLoginAttempt).toHaveBeenCalledWith({ ipHash: "ip", subjectHash: "hash:SMBA-HC-0001" })
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "session")
    expect(mocks.releaseSecondFactorAttempt).toHaveBeenCalledWith("head-coach")
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
    // Spent by the reservation before the check, and not handed back.
    expect(mocks.reserveSecondFactorAttempt).toHaveBeenCalledWith("head-coach", "session")
    expect(mocks.releaseSecondFactorAttempt).not.toHaveBeenCalled()
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
    mocks.reserveLoginAttempt.mockReturnValue(false)

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "Too many attempts. Wait a few minutes before trying again.",
        errorField: null,
      })
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled()
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
  })

  it("stops before checking the code once the account's second-factor budget is spent", async () => {
    mocks.reserveSecondFactorAttempt.mockReturnValue(false)

    await expect(reissueRecoveryCodesAction({ codes: null, error: null }, reissueData()))
      .resolves.toEqual({
        codes: null,
        error: "Too many attempts. Wait a few minutes before trying again.",
        errorField: null,
      })
    expect(mocks.verifyTOTP).not.toHaveBeenCalled()
    expect(mocks.generateBackupCodes).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "login_rate_limited",
      metadata: { factor: "second_factor", operation: "reissue_recovery_codes" },
      outcome: "blocked",
    }))
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

/**
 * M040. The current password is verified before Better Auth is asked to change
 * it, so a throw from the change is never a wrong current password -- and
 * Better Auth writes the new password and drops every session before the last
 * step that can still throw.
 */
describe("changing the password when Better Auth throws part-way", () => {
  function changeData() {
    const formData = passwordData()
    formData.set("newPassword", "A brand new secure password!")
    formData.set("confirmPassword", "A brand new secure password!")
    return formData
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({
      academyId: "SMBA-HC-0001",
      role: "coach",
      subjectId: "head-coach",
    })
    mocks.verifyCurrentPasswordAttempt.mockResolvedValue("verified")
    mocks.changePassword.mockRejectedValue(new Error("session could not be created"))
  })

  /*
   * This browser's session went with the others, so re-rendering the security
   * page would bounce to a bare sign-in page and swallow any returned message.
   * The news goes to the sign-in page instead.
   */
  it("sends the person to sign in with word that the password changed, when the new one took", async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(true)
    mocks.hasActiveSession.mockResolvedValue(false)

    await expect(changePasswordAction({ error: null, success: null }, changeData()))
      .rejects.toThrow("NEXT_REDIRECT:/login?notice=password-changed")
    expect(mocks.verifyCurrentPassword).toHaveBeenCalledWith({
      accountId: "head-coach",
      password: "A brand new secure password!",
    })
    expect(mocks.removePinCredential).toHaveBeenCalledWith("head-coach")
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("stays on the page when the throw came after this browser was signed in again", async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(true)
    mocks.hasActiveSession.mockResolvedValue(true)

    await expect(changePasswordAction({ error: null, success: null }, changeData()))
      .resolves.toEqual({
        error: null,
        success: "Password changed. Other devices were logged out and any PIN was removed.",
      })
    expect(mocks.removePinCredential).toHaveBeenCalledWith("head-coach")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/account/security")
  })

  it("does not blame the current password when the change did not take", async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false)
    mocks.hasActiveSession.mockResolvedValue(true)

    await expect(changePasswordAction({ error: null, success: null }, changeData()))
      .resolves.toEqual({
        error: "Your password could not be changed. Your current password still works. Try again.",
        errorField: null,
        success: null,
      })
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })

  it("says when every device was already logged out before the change failed", async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false)
    mocks.hasActiveSession.mockResolvedValue(false)

    const result = await changePasswordAction({ error: null, success: null }, changeData())
    expect(result.success).toBeNull()
    expect(result.error).toContain("every device, this one included, was logged out")
    expect(result.error).toContain("sign in again with it")
    expect(result.error).not.toContain("Try again.")
  })

})

describe("a sign-in that ran out while the security page was open", () => {
  it("is refused as an expired sign-in the browser can recognise", async () => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(null)

    await expect(changePasswordAction({ error: null, success: null }, passwordData()))
      .rejects.toMatchObject({ digest: SESSION_EXPIRED_DIGEST })
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })
})

describe("logging out other devices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A lost phone that was trusted to skip the code would otherwise sign
  // straight back in with its saved password.
  it("also forgets every browser trusted to skip the authenticator code", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })

    await revokeOtherSessionsAction()

    expect(mocks.revokeOtherSessions).toHaveBeenCalled()
    expect(mocks.forgetTrustedDevices).toHaveBeenCalledWith("head-one")
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "sessions_revoked",
      metadata: { forgottenDevices: 2, scope: "other_devices" },
    }))
    // Still never touches the PIN; see the action's own comment.
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })
})

describe("during an admin preview", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({
      academyId: "SMBA-PL-0004",
      actorSubjectId: "owner",
      previewMode: true,
      role: "player",
      subjectId: "player-4",
    })
    mocks.verifyCurrentPasswordAttempt.mockResolvedValue("verified")
  })

  it("refuses every account security change, before any credential or session is touched", async () => {
    const pinForm = passwordData()
    pinForm.set("pin", "482916")
    pinForm.set("confirmPin", "482916")
    const passwordForm = passwordData()
    passwordForm.set("newPassword", "A brand new secure password!")
    passwordForm.set("confirmPassword", "A brand new secure password!")

    await expect(revokeSessionAction("player-session")).rejects.toThrow(/read-only/u)
    await expect(revokeOtherSessionsAction()).rejects.toThrow(/read-only/u)
    await expect(savePinAction({ error: null, success: null }, pinForm)).rejects.toThrow(/read-only/u)
    await expect(removePinAction({ error: null, success: null }, passwordData())).rejects.toThrow(/read-only/u)
    await expect(changePasswordAction({ error: null, success: null }, passwordForm))
      .rejects.toThrow(/read-only/u)

    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled()
    expect(mocks.forgetTrustedDevices).not.toHaveBeenCalled()
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled()
  })
})
