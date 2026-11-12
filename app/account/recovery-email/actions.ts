"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  ACTIVATION_CLAIM_COOKIE,
  getActivationClaimStatus,
  verifyCurrentPasswordAttempt,
} from "@/lib/auth/credential-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import {
  confirmRecoveryEmailVerification,
  EMAIL_VERIFICATION_LIFETIME_MS,
  emailCodeChecksPaused,
  freshAccountCodeChecksPaused,
  getRecoveryEmail,
  HEAD_SETUP_EMAIL_COOKIE,
  normalizeEmailAddress,
  notifyRecoveryEmailReplaced,
  recoveryEmailSendRefusal,
  recoverySubjectKeyForAccount,
  recoverySubjectKeyForHeadSetup,
  requestRecoveryEmailVerification,
  verifyFreshAccountSecondFactor,
} from "@/lib/auth/recovery-service"
import {
  HEAD_COACH_SETUP_COOKIE,
  headCoachSetupAvailable,
  validHeadCoachSetupToken,
} from "@/lib/auth/initial-setup"
import { normalizeFullName } from "@/lib/auth/identity"
import { requestSecurityContext } from "@/lib/auth/security-context"
import { sessionProvider } from "@/lib/data"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"

export type RecoveryEmailEnrollmentState = {
  email: string
  error: string | null
  fullName?: string
  sent: boolean
}

async function securityContext() {
  return requestSecurityContext(await headers())
}

const INVALID_CODE = "That code is invalid or expired."
const CODE_CHECKS_PAUSED =
  "Too many codes were tried from this connection. Wait a few minutes, then enter the same code again."
const TOO_MANY_ATTEMPTS = "Too many attempts. Wait a few minutes before trying again."

/*
 * The answer for a refused emailed code. A pause is reported as a pause: every
 * key behind it was spent from this connection, so saying so tells nobody
 * anything new, and a family typing the right code during a busy sign-up
 * session needs to be told to wait rather than that the code is wrong.
 */
function refusedCodeMessage(subjectKey: string, security: Awaited<ReturnType<typeof securityContext>>) {
  return emailCodeChecksPaused({ kind: "recovery-email", security, subjectKey })
    ? CODE_CHECKS_PAUSED
    : INVALID_CODE
}

export async function requestActivationRecoveryEmail(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const token = (await cookies()).get(ACTIVATION_CLAIM_COOKIE)?.value
  const status = getActivationClaimStatus(token)
  if (status.state !== "approved") redirect("/activate")
  const email = String(formData.get("email") ?? "")
  try {
    const sent = await requestRecoveryEmailVerification({
      accountId: status.accountId,
      email,
      security: await securityContext(),
      subjectKey: recoverySubjectKeyForAccount(status.accountId),
    })
    return { email: sent.email, error: null, sent: true }
  } catch (error) {
    return {
      email,
      error: error instanceof Error ? error.message : "The verification email could not be sent.",
      sent: false,
    }
  }
}

export async function confirmActivationRecoveryEmail(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const token = (await cookies()).get(ACTIVATION_CLAIM_COOKIE)?.value
  const status = getActivationClaimStatus(token)
  if (status.state !== "approved") redirect("/activate")
  const email = String(formData.get("email") ?? "")
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  const security = await securityContext()
  const subjectKey = recoverySubjectKeyForAccount(status.accountId)
  const confirmed = confirmRecoveryEmailVerification({
    accountId: status.accountId,
    code,
    email,
    security,
    subjectKey,
  })
  if (!confirmed) {
    return { email, error: refusedCodeMessage(subjectKey, security), sent: true }
  }
  redirect("/activate")
}

async function currentIdentity() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  return identity
}

export async function requestCurrentRecoveryEmail(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const identity = await currentIdentity()
  // A server action is a public endpoint: it re-states every precondition
  // /account/recovery-email/setup checks (setup/page.tsx:25) instead of relying
  // on it. Enrolment is first-time only — repointing a verified address is a
  // step-up operation and must go through requestRecoveryEmailChange, which asks
  // for the current password and, for privileged roles, a fresh second factor.
  if (getRecoveryEmail(identity.subjectId)) redirect("/account/security")
  const email = String(formData.get("email") ?? "")
  const currentPassword = String(formData.get("currentPassword") ?? "")
  if (!email.trim()) {
    return { email, error: "Enter a valid recovery email address.", sent: false }
  }
  if (!currentPassword) {
    return { email, error: "Enter your current password.", sent: false }
  }
  const security = await securityContext()
  const subjectKey = recoverySubjectKeyForAccount(identity.subjectId)
  // Read before the password is checked, so a refusal to send costs nothing.
  const refusal = recoveryEmailSendRefusal({ security, subjectKey })
  if (refusal) return { email, error: refusal, sent: false }
  /*
   * The first recovery address decides who can reset this account's password
   * from then on, so it asks for the password as a change does. Without it,
   * anyone who picked up a player's still-signed-in phone before a recovery
   * email was added could add their own, reset the password from it and keep
   * the account.
   */
  const passwordResult = await verifyCurrentPasswordAttempt({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    ipHash: security.ipHash,
    operation: "add_recovery_email",
    password: currentPassword,
    userAgent: security.userAgent,
  })
  if (passwordResult !== "verified") {
    return {
      email,
      error: passwordResult === "blocked"
        ? TOO_MANY_ATTEMPTS
        : "The current password could not be verified.",
      sent: false,
    }
  }
  try {
    const sent = await requestRecoveryEmailVerification({
      accountId: identity.subjectId,
      email,
      security,
      subjectKey,
    })
    return { email: sent.email, error: null, sent: true }
  } catch (error) {
    return {
      email,
      error: error instanceof Error ? error.message : "The verification email could not be sent.",
      sent: false,
    }
  }
}

export async function confirmCurrentRecoveryEmail(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const identity = await currentIdentity()
  // Same precondition as the request half. This does not break the legitimate
  // request-then-confirm pair: requestRecoveryEmailVerification only writes an
  // authEmailChallenges row, and authRecoveryEmails is written (always with
  // verifiedAt set) by the confirm below — so getRecoveryEmail is still null
  // when a genuine first-time enrolment reaches this line.
  if (getRecoveryEmail(identity.subjectId)) redirect("/account/security")
  const email = String(formData.get("email") ?? "")
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  const security = await securityContext()
  const subjectKey = recoverySubjectKeyForAccount(identity.subjectId)
  const confirmed = confirmRecoveryEmailVerification({
    accountId: identity.subjectId,
    code,
    email,
    security,
    subjectKey,
  })
  if (!confirmed) return { email, error: refusedCodeMessage(subjectKey, security), sent: true }
  redirect(identity.role === "platform_admin"
    ? "/admin"
    : identity.role === "coach" ? "/coach" : "/player")
}

export async function requestRecoveryEmailChange(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const identity = await currentIdentity()
  const email = String(formData.get("email") ?? "")
  const currentPassword = String(formData.get("currentPassword") ?? "")
  if (!email.trim()) {
    return { email, error: "Enter a valid recovery email address.", sent: false }
  }
  if (!currentPassword) {
    return { email, error: "Enter your current password.", sent: false }
  }
  const context = await securityContext()
  const subjectKey = recoverySubjectKeyForAccount(identity.subjectId)
  // Read before anything is checked: a head coach used to spend a recovery
  // code on the step below only to be told "wait one minute" here afterwards.
  const refusal = recoveryEmailSendRefusal({ security: context, subjectKey })
  if (refusal) return { email, error: refusal, sent: false }
  const passwordResult = await verifyCurrentPasswordAttempt({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    ipHash: context.ipHash,
    operation: "change_recovery_email",
    password: currentPassword,
    userAgent: context.userAgent,
  })
  if (passwordResult !== "verified") {
    return {
      email,
      error: passwordResult === "blocked"
        ? "Too many attempts. Wait a few minutes before trying again."
        : "The current password could not be verified.",
      sent: false,
    }
  }
  const access = identity.role === "coach" ? getCoachAccessProfile(identity.subjectId) : null
  const requiresSecondFactor = identity.role === "platform_admin"
    || access?.accessLevel === "head_admin"
  if (requiresSecondFactor) {
    const credential = String(formData.get("secondFactor") ?? "").trim()
    if (!credential) {
      return { email, error: "Enter an authenticator or backup code.", sent: false }
    }
    if (!await verifyFreshAccountSecondFactor({
      accountId: identity.subjectId,
      credential,
      operation: "change_recovery_email",
      security: context,
    })) {
      return {
        email,
        error: freshAccountCodeChecksPaused({ accountId: identity.subjectId, security: context })
          ? TOO_MANY_ATTEMPTS
          : "The authenticator or backup code was not accepted.",
        sent: false,
      }
    }
  }
  try {
    const sent = await requestRecoveryEmailVerification({
      accountId: identity.subjectId,
      email,
      security: context,
      subjectKey,
    })
    return { email: sent.email, error: null, sent: true }
  } catch (error) {
    return {
      email,
      error: error instanceof Error ? error.message : "The verification email could not be sent.",
      sent: false,
    }
  }
}

export async function confirmRecoveryEmailChange(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const identity = await currentIdentity()
  if (!getRecoveryEmail(identity.subjectId)) redirect("/account/recovery-email/setup")
  const email = String(formData.get("email") ?? "")
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  const security = await securityContext()
  const subjectKey = recoverySubjectKeyForAccount(identity.subjectId)
  const confirmed = confirmRecoveryEmailVerification({
    accountId: identity.subjectId,
    code,
    email,
    security,
    subjectKey,
  })
  if (!confirmed) {
    /*
     * A press whose answer never arrived may still have gone through, and the
     * code is spent once it has. When the address on file is already the one
     * this code was for, and it was confirmed moments ago, the change landed:
     * say so, rather than calling the code invalid and inviting a fresh start.
     */
    const current = getRecoveryEmail(identity.subjectId)
    const submitted = normalizeEmailAddress(email)
    if (current && submitted && current.email === submitted
      && Date.now() - current.verifiedAt.getTime() < EMAIL_VERIFICATION_LIFETIME_MS) {
      redirect("/account/security?emailChanged=1")
    }
    return { email, error: refusedCodeMessage(subjectKey, security), sent: true }
  }
  // The address that was replaced hears about it; whoever reads it is either
  // the family, who already know, or the person the change was meant to shut out.
  await notifyRecoveryEmailReplaced({
    accountId: identity.subjectId,
    newEmail: confirmed.email,
    previousEmail: confirmed.previousEmail,
  })
  redirect("/account/security?emailChanged=1")
}

function headSetupContext(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const setupToken = cookieStore.get(HEAD_COACH_SETUP_COOKIE)?.value
  if (!validHeadCoachSetupToken(setupToken) || !headCoachSetupAvailable()) return null
  return { setupToken: setupToken!, subjectKey: recoverySubjectKeyForHeadSetup(setupToken!) }
}

export async function requestHeadSetupRecoveryEmail(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const context = headSetupContext(await cookies())
  if (!context) redirect("/setup/head-coach")
  const fullName = normalizeFullName(String(formData.get("fullName") ?? ""))
  const email = String(formData.get("email") ?? "")
  if (fullName.length < 2 || fullName.length > 80) {
    return { email, error: "Enter the head coach’s full name.", fullName, sent: false }
  }
  try {
    const sent = await requestRecoveryEmailVerification({
      email,
      fullName,
      security: await securityContext(),
      subjectKey: context.subjectKey,
    })
    return { email: sent.email, error: null, fullName, sent: true }
  } catch (error) {
    return {
      email,
      error: error instanceof Error ? error.message : "The verification email could not be sent.",
      fullName,
      sent: false,
    }
  }
}

export async function confirmHeadSetupRecoveryEmail(
  _previousState: RecoveryEmailEnrollmentState,
  formData: FormData,
): Promise<RecoveryEmailEnrollmentState> {
  const cookieStore = await cookies()
  const context = headSetupContext(cookieStore)
  if (!context) redirect("/setup/head-coach")
  const fullName = normalizeFullName(String(formData.get("fullName") ?? ""))
  const email = String(formData.get("email") ?? "")
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  const security = await securityContext()
  const confirmed = confirmRecoveryEmailVerification({
    code,
    email,
    security,
    subjectKey: context.subjectKey,
  })
  if (!confirmed?.receiptToken) {
    return { email, error: refusedCodeMessage(context.subjectKey, security), fullName, sent: true }
  }
  cookieStore.set(HEAD_SETUP_EMAIL_COOKIE, confirmed.receiptToken, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/setup/head-coach",
    sameSite: "lax",
    secure: secureAuthCookiesRequired(),
  })
  redirect(`/setup/head-coach?name=${encodeURIComponent(fullName)}`)
}
