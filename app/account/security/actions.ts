"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { SessionExpiredError } from "@/lib/actions/operational-result"
import { getAuth } from "@/lib/auth/better-auth"
import {
  hasPinCredential,
  releaseLoginAttempt,
  releaseSecondFactorAttempt,
  removePinCredential,
  reserveLoginAttempt,
  reserveSecondFactorAttempt,
  setPinCredential,
  validateNewPin,
  validateNewPassword,
  verifyCurrentPassword,
  verifyCurrentPasswordAttempt,
} from "@/lib/auth/credential-service"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { normalizeAcademyId } from "@/lib/auth/identity"
import { forgetTrustedDevices } from "@/lib/auth/second-factor-reset"
import { getRawAuthSession } from "@/lib/auth/session"
import { sessionProvider } from "@/lib/data"
import {
  authSubjectHash,
  requestSecurityContext,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { authRuntimeSessions } from "@/lib/db/schema"
import { PASSWORD_CHANGED_LOGIN_NOTICE } from "@/lib/auth/login-notices"

/** Which input an error belongs to, so the form can flag and focus it. */
export type PasswordChangeField = "currentPassword" | "newPassword" | "confirmPassword"

export type PasswordChangeState = {
  error: string | null
  errorField?: PasswordChangeField | null
  success: string | null
}

export type PinManagementState = {
  error: string | null
  success: string | null
}

/**
 * `codes` is the whole handout. Better Auth returns the plaintext set once, on
 * the call that mints it, and stores only an encrypted copy afterwards, so this
 * state is the coach's only chance to read them.
 */
export type RecoveryCodeReissueState = {
  codes: string[] | null
  error: string | null
  /** Which credential the reissue form should flag; `null` marks neither. */
  errorField?: "currentPassword" | "secondFactor" | null
  /**
   * True when the action refused before it could replace the stored set, so a
   * set the coach is still reading on screen is still the live one.
   */
  storedSetUnchanged?: boolean
}

/** A reissue refused before the stored set was touched. */
function reissueRefused(
  error: string,
  errorField: RecoveryCodeReissueState["errorField"] = null,
): RecoveryCodeReissueState {
  return { codes: null, error, errorField, storedSetUnchanged: true }
}

/*
 * Every form here sits on a page that only renders for a signed-in person, so a
 * missing identity at submit time is a sign-in that ran out (or was ended
 * elsewhere) while the page was open. Thrown as the expiry it is, the form says
 * "sign in again" instead of a generic failure.
 */
async function requireIdentity() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) throw new SessionExpiredError()
  return identity
}

async function confirmCurrentPassword(input: {
  academyId: string
  accountId: string
  operation: string
  password: string
}) {
  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const result = await verifyCurrentPasswordAttempt({
    ...input,
    ipHash: security.ipHash,
    userAgent: security.userAgent,
  })
  return { requestHeaders, result, security }
}

function currentPasswordError(result: "blocked" | "invalid" | "verified") {
  return result === "blocked"
    ? "Too many attempts. Wait a few minutes before trying again."
    : "The current password could not be verified."
}

export async function changePasswordAction(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const identity = await requireIdentity()
  const currentPassword = String(formData.get("currentPassword") ?? "")
  const newPassword = String(formData.get("newPassword") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")
  if (!currentPassword) {
    return { error: "Enter your current password.", errorField: "currentPassword", success: null }
  }
  const passwordError = validateNewPassword(newPassword)
  if (passwordError) return { error: passwordError, errorField: "newPassword", success: null }
  if (newPassword !== confirmPassword) {
    return {
      error: "The new passwords do not match.",
      errorField: "confirmPassword",
      success: null,
    }
  }

  const confirmation = await confirmCurrentPassword({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    operation: "change_password",
    password: currentPassword,
  })
  if (confirmation.result !== "verified") {
    return {
      error: currentPasswordError(confirmation.result),
      errorField: "currentPassword",
      success: null,
    }
  }
  /*
   * The current password was verified just above, so a throw from here is not
   * a wrong password. Better Auth runs with no transaction (lib/auth/
   * better-auth.ts) and changes the password in three writes: it deletes every
   * session, this one included, then writes the new password, then mints this
   * browser's replacement session. Any of them can throw, and nothing before it
   * is undone -- so the new password is asked directly whether it took, and the
   * session table whether this browser is still signed in, rather than the
   * person being told their current password was wrong.
   */
  let signedOutHere = false
  try {
    await getAuth().api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: confirmation.requestHeaders,
    })
  } catch {
    const changed = await verifyCurrentPassword({
      accountId: identity.subjectId,
      password: newPassword,
    }).catch(() => false)
    if (!changed) {
      const stillSignedIn = await sessionProvider.hasActiveSession().catch(() => true)
      return {
        error: stillSignedIn
          ? "Your password could not be changed. Your current password still works. Try again."
          : "Your password could not be changed, but every device, this one included, was"
            + " logged out. Your current password still works: sign in again with it, then try again.",
        errorField: null,
        success: null,
      }
    }
    // The throw may have come after this browser's replacement session was
    // written, in which case it is still signed in; the session table says.
    signedOutHere = !(await sessionProvider.hasActiveSession().catch(() => false))
  }

  /*
   * The PIN is a second way in, and it was surviving both remediations someone
   * reaches for after a stolen cookie: it can be minted from a session alone
   * (app/auth/pin/actions.ts) and neither changing the password nor logging
   * other devices out removed it. So the attacker's door stayed open and the
   * success message below was not true. The emailed reset path already does
   * exactly this.
   */
  try {
    removePinCredential(identity.subjectId)
  } catch {
    return {
      error: signedOutHere
        ? "Your password was changed and every device, this one included, was logged out,"
          + " but your PIN could not be removed. Sign in with your new password, then change"
          + " it once more to remove the PIN."
        : "Your password was changed and other devices were logged out, but your PIN"
          + " could not be removed. Change your password again to remove it.",
      errorField: null,
      success: null,
    }
  }

  try {
    writeAuthSecurityEvent({
      accountId: identity.subjectId,
      eventType: "password_changed",
      ipHash: confirmation.security.ipHash,
      outcome: "success",
      userAgent: confirmation.security.userAgent,
    })
  } catch {
    // The password has already changed; a failed audit write must not say otherwise.
  }
  /*
   * When this browser's own session went with the others, the security page has
   * nothing left to render for it: re-rendering it after the action redirects
   * to a bare sign-in page, which would swallow any message returned here. So
   * the sign-in page is where the news goes, carried by its own notice.
   */
  if (signedOutHere) redirect(`/login?notice=${PASSWORD_CHANGED_LOGIN_NOTICE}`)
  revalidatePath("/account/security")
  return {
    error: null,
    success: "Password changed. Other devices were logged out and any PIN was removed.",
  }
}

export async function revokeOtherSessionsAction() {
  const identity = await requireIdentity()
  const requestHeaders = await headers()
  await getAuth().api.revokeOtherSessions({ headers: requestHeaders })
  /*
   * Trusted browsers go too, this one included. Ending a lost phone's session
   * is not enough while that phone is still trusted to skip the authenticator
   * code: with a saved password it signed straight back in. Telling this
   * browser's trust apart would mean reading the library's signed cookie, and
   * one extra code on the next sign-in here is the smaller cost.
   */
  const forgottenDevices = forgetTrustedDevices(identity.subjectId)
  /*
   * This deliberately does NOT remove the PIN, though the first attempt at
   * closing the stolen-cookie hole made it do so. This action is gated on a
   * session and nothing else, so deleting a credential here handed the thief the
   * very thing the deletion was meant to deny: `setupPinAction` refuses to mint
   * a PIN while one exists, so removing the victim's let a stolen cookie replace
   * it with the attacker's own. Verified end to end -- the new PIN signed in
   * from a client holding no cookie and no password.
   *
   * PIN removal stays where a credential is proved: changePasswordAction, which
   * confirms the current password, and removePinAction.
   */
  const security = requestSecurityContext(requestHeaders)
  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    actorAccountId: identity.subjectId,
    eventType: "sessions_revoked",
    ipHash: security.ipHash,
    metadata: { forgottenDevices, scope: "other_devices" },
    outcome: "success",
    userAgent: security.userAgent,
  })
  revalidatePath("/account/security")
}

export async function revokeSessionAction(sessionId: string) {
  const identity = await requireIdentity()
  if (typeof sessionId !== "string" || !sessionId.trim()) return
  const database = initializeDatabase()
  database.delete(authRuntimeSessions).where(and(
    eq(authRuntimeSessions.id, sessionId),
    eq(authRuntimeSessions.userId, identity.subjectId),
  )).run()
  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    actorAccountId: identity.subjectId,
    eventType: "sessions_revoked",
    metadata: { scope: "one_device" },
    outcome: "success",
  })
  revalidatePath("/account/security")
}

export async function savePinAction(
  _previousState: PinManagementState,
  formData: FormData,
): Promise<PinManagementState> {
  const identity = await requireIdentity()
  const currentPassword = String(formData.get("currentPassword") ?? "")
  const pin = String(formData.get("pin") ?? "")
  const confirmPin = String(formData.get("confirmPin") ?? "")
  if (!currentPassword) {
    return { error: "Enter your current password.", success: null }
  }
  if (!pin) return { error: "Enter a new 6-digit PIN.", success: null }
  if (!confirmPin) return { error: "Confirm the new PIN.", success: null }
  const confirmation = await confirmCurrentPassword({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    operation: "save_pin",
    password: currentPassword,
  })
  if (confirmation.result !== "verified") {
    return { error: currentPasswordError(confirmation.result), success: null }
  }
  const pinError = validateNewPin(pin)
  if (pinError) return { error: pinError, success: null }
  if (pin !== confirmPin) return { error: "The PINs do not match.", success: null }
  const existing = hasPinCredential(identity.subjectId)
  try {
    await setPinCredential({ accountId: identity.subjectId, pin })
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The PIN could not be saved.",
      success: null,
    }
  }
  revalidatePath("/account/security")
  return { error: null, success: existing ? "PIN changed." : "PIN login enabled." }
}

export async function removePinAction(
  _previousState: PinManagementState,
  formData: FormData,
): Promise<PinManagementState> {
  const identity = await requireIdentity()
  if (identity.role === "platform_admin") {
    return { error: "The platform-owner account requires a PIN.", success: null }
  }
  if (identity.role === "coach"
    && getCoachAccessProfile(identity.subjectId)?.accessLevel === "head_admin") {
    return { error: "The head-coach account requires a PIN.", success: null }
  }
  const currentPassword = String(formData.get("currentPassword") ?? "")
  if (!currentPassword) {
    return { error: "Enter your current password.", success: null }
  }
  const confirmation = await confirmCurrentPassword({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    operation: "remove_pin",
    password: currentPassword,
  })
  if (confirmation.result !== "verified") {
    return { error: currentPasswordError(confirmation.result), success: null }
  }
  removePinCredential(identity.subjectId)
  revalidatePath("/account/security")
  return { error: null, success: "PIN login removed. Use your password to sign in." }
}

/**
 * Mints a replacement set of authenticator recovery codes.
 *
 * `beginAuthenticatorReconnect` is the wrong instrument for this, even though
 * it also ends in ten fresh codes: it calls `revokeOtherSessions` and
 * `disableTwoFactor` first (app/auth/two-factor/actions.ts:164-165), which
 * signs the coach out of every device -- a courtside tablet mid-session
 * included -- and then demands a fresh QR scan. `generateBackupCodes` replaces
 * the stored set and nothing else: it emits no Set-Cookie, leaves other
 * sessions alive, and leaves the encrypted TOTP secret byte for byte the same.
 * tests/better-auth-runtime.test.ts holds that to the real plugin.
 *
 * Its *gate*, though, is the right one, and this action copies it rather than
 * the password-only gate the rest of this file uses. Everything else here
 * changes a password or a PIN; this mints ten durable second-factor bypass
 * credentials, so a password-only gate would hand a stolen session cookie plus
 * a known password exactly the TOTP bypass that TOTP exists to deny.
 *
 * The order is password then second factor, so a mistyped password cannot burn
 * a good recovery code. Both failures spend from one login-attempt budget,
 * which is why the limiter is driven here rather than through
 * `confirmCurrentPassword`: `verifyCurrentPasswordAttempt` clears the
 * subject's failures the moment the password verifies, which would leave
 * second-factor guessing an unlimited budget.
 */
export async function reissueRecoveryCodesAction(
  _previousState: RecoveryCodeReissueState,
  formData: FormData,
): Promise<RecoveryCodeReissueState> {
  const identity = await requireIdentity()
  // A previewing platform admin holds their own session while `identity`
  // describes the coach on screen, so the credential gates below would test one
  // account and Better Auth would reissue the other's codes. The page redirects
  // preview sessions away; a directly invoked action has to refuse for itself.
  if (identity.previewMode) {
    return reissueRefused("Leave preview mode to manage recovery codes.")
  }
  const rawSession = await getRawAuthSession()
  if (!rawSession?.user.twoFactorEnabled) {
    return reissueRefused("This account has no authenticator, so it has no recovery codes.")
  }

  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  // The same subject key `verifyCurrentPasswordAttempt` writes, so the budget
  // this action spends is the one the rest of the page shares.
  const subjectHash = authSubjectHash(normalizeAcademyId(identity.academyId))
  const attempt = { ipHash: security.ipHash, subjectHash }
  const rateLimited = (factor: "current_password" | "second_factor") => {
    writeAuthSecurityEvent({
      accountId: identity.subjectId,
      actorAccountId: identity.subjectId,
      eventType: "login_rate_limited",
      ipHash: security.ipHash,
      metadata: { factor, operation: "reissue_recovery_codes" },
      outcome: "blocked",
      subjectHash,
      userAgent: security.userAgent,
    })
    return reissueRefused("Too many attempts. Wait a few minutes before trying again.")
  }

  const currentPassword = String(formData.get("currentPassword") ?? "")
  const secondFactor = String(formData.get("secondFactor") ?? "").trim()
  if (!currentPassword) {
    return reissueRefused("Enter your current password.", "currentPassword")
  }
  // Each guess is reserved before its slow check rather than counted after it,
  // so parallel requests cannot all read "not blocked" first.
  if (!reserveLoginAttempt(attempt)) return rateLimited("current_password")
  if (!await verifyCurrentPassword({
    accountId: identity.subjectId,
    password: currentPassword,
  })) {
    writeAuthSecurityEvent({
      accountId: identity.subjectId,
      actorAccountId: identity.subjectId,
      eventType: "login_failed",
      ipHash: security.ipHash,
      metadata: { factor: "current_password", operation: "reissue_recovery_codes" },
      outcome: "failure",
      subjectHash,
      userAgent: security.userAgent,
    })
    return reissueRefused("The current password could not be verified.", "currentPassword")
  }
  releaseLoginAttempt(attempt)
  if (!secondFactor) {
    return reissueRefused(
      "Enter a current authenticator code or an unused recovery code.",
      "secondFactor",
    )
  }
  // A signed-in code check skips Better Auth's lockout, so the account's own
  // second-factor budget is the limit here.
  if (!reserveSecondFactorAttempt(identity.subjectId, "session")) return rateLimited("second_factor")

  const requestAuth = getAuth()
  try {
    // Both run against a signed-in session, where the plugin returns the
    // session it was handed rather than minting one, so neither call rotates
    // the cookie or drops a device. A recovery code spent here comes out of
    // the very set `generateBackupCodes` replaces below.
    if (/^\d{6}$/u.test(secondFactor)) {
      await requestAuth.api.verifyTOTP({
        body: { code: secondFactor, trustDevice: false },
        headers: requestHeaders,
      })
    } else {
      await requestAuth.api.verifyBackupCode({
        body: { code: secondFactor, disableSession: false, trustDevice: false },
        headers: requestHeaders,
      })
    }
  } catch {
    writeAuthSecurityEvent({
      accountId: identity.subjectId,
      actorAccountId: identity.subjectId,
      eventType: "totp_failed",
      ipHash: security.ipHash,
      metadata: { operation: "reissue_recovery_codes" },
      outcome: "failure",
      subjectHash,
      userAgent: security.userAgent,
    })
    return reissueRefused("That authenticator or recovery code was not accepted.", "secondFactor")
  }
  releaseSecondFactorAttempt(identity.subjectId)
  if (!/^\d{6}$/u.test(secondFactor)) {
    // A recovery code spent here is one the monitor alerts on wherever it is used.
    try {
      writeAuthSecurityEvent({
        accountId: identity.subjectId,
        actorAccountId: identity.subjectId,
        eventType: "totp_verified",
        ipHash: security.ipHash,
        metadata: { method: "backup_code", operation: "reissue_recovery_codes" },
        outcome: "success",
        subjectHash,
        userAgent: security.userAgent,
      })
    } catch {
      // The code is already spent; a failed audit write must not undo that.
    }
  }

  let codes: string[]
  try {
    const response = await requestAuth.api.generateBackupCodes({
      body: { password: currentPassword },
      headers: requestHeaders,
    })
    codes = response.backupCodes
  } catch {
    return {
      codes: null,
      error: "The recovery codes could not be reissued. Try again.",
      errorField: null,
    }
  }

  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    actorAccountId: identity.subjectId,
    eventType: "totp_recovery_codes_reissued",
    ipHash: security.ipHash,
    outcome: "success",
    userAgent: security.userAgent,
  })
  // Refreshes the unused-code count the panel states above the button.
  revalidatePath("/account/security")
  return { codes, error: null, errorField: null }
}
