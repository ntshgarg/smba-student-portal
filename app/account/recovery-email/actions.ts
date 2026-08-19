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
  getRecoveryEmail,
  HEAD_SETUP_EMAIL_COOKIE,
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
  const confirmed = confirmRecoveryEmailVerification({
    accountId: status.accountId,
    code,
    email,
    security: await securityContext(),
    subjectKey: recoverySubjectKeyForAccount(status.accountId),
  })
  if (!confirmed) {
    return { email, error: "That code is invalid or expired.", sent: true }
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
  const email = String(formData.get("email") ?? "")
  try {
    const sent = await requestRecoveryEmailVerification({
      accountId: identity.subjectId,
      email,
      security: await securityContext(),
      subjectKey: recoverySubjectKeyForAccount(identity.subjectId),
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
  const email = String(formData.get("email") ?? "")
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  const confirmed = confirmRecoveryEmailVerification({
    accountId: identity.subjectId,
    code,
    email,
    security: await securityContext(),
    subjectKey: recoverySubjectKeyForAccount(identity.subjectId),
  })
  if (!confirmed) return { email, error: "That code is invalid or expired.", sent: true }
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
      security: context,
    })) {
      return { email, error: "The authenticator or backup code was not accepted.", sent: false }
    }
  }
  try {
    const sent = await requestRecoveryEmailVerification({
      accountId: identity.subjectId,
      email,
      security: await securityContext(),
      subjectKey: recoverySubjectKeyForAccount(identity.subjectId),
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
  const confirmed = confirmRecoveryEmailVerification({
    accountId: identity.subjectId,
    code,
    email,
    security: await securityContext(),
    subjectKey: recoverySubjectKeyForAccount(identity.subjectId),
  })
  if (!confirmed) return { email, error: "That code is invalid or expired.", sent: true }
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
  const confirmed = confirmRecoveryEmailVerification({
    code,
    email,
    security: await securityContext(),
    subjectKey: context.subjectKey,
  })
  if (!confirmed?.receiptToken) {
    return { email, error: "That code is invalid or expired.", fullName, sent: true }
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
