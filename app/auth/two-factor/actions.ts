"use server"

import { and, eq, isNull } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth/better-auth"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import {
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  verifyCurrentPassword,
} from "@/lib/auth/credential-service"
import { getRawAuthSession } from "@/lib/auth/session"
import { sessionProvider } from "@/lib/data"
import {
  authSubjectHash,
  requestSecurityContext,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { accounts } from "@/lib/db/schema"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export type TotpSetupState = {
  error: string | null
  setup: {
    backupCodes: string[]
    totpURI: string
  } | null
}

export type TotpVerificationState = {
  error: string | null
}

export type TotpReconnectState = {
  error: string | null
  errorField: "password" | "secondFactor" | null
}

function destinationForUser(userId: string, twoFactorEnabled = true) {
  const account = initializeDatabase().select({ role: accounts.role })
    .from(accounts)
    .where(and(
      eq(accounts.id, userId),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
  if (!account?.role) return "/login"
  return postAuthenticationDestination({
    accountId: userId,
    role: account.role,
    twoFactorEnabled,
  })
}

async function requireProtectedSetupSession() {
  const rawSession = await getRawAuthSession()
  if (!rawSession) redirect("/login")
  const account = initializeDatabase().select({ role: accounts.role })
    .from(accounts)
    .where(and(
      eq(accounts.id, rawSession.user.id),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
  if (account?.role === "coach"
    && getCoachAccessProfile(rawSession.user.id)?.accessLevel !== "head_admin") {
    redirect("/coach")
  }
  if (account?.role !== "coach" && account?.role !== "platform_admin") redirect("/player")
  return rawSession
}

async function requireAuthenticatorReconnectSession() {
  const [rawSession, identity] = await Promise.all([
    getRawAuthSession(),
    sessionProvider.getCurrentIdentity(),
  ])
  if (!rawSession || !identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  const protectedAccount = identity.role === "platform_admin"
    || (identity.role === "coach"
      && getCoachAccessProfile(identity.subjectId)?.accessLevel === "head_admin")
  if (!protectedAccount) redirect(identity.role === "coach" ? "/coach" : "/player")
  return { identity, rawSession }
}

export async function beginAuthenticatorReconnect(
  _previousState: TotpReconnectState,
  formData: FormData,
): Promise<TotpReconnectState> {
  const { identity, rawSession } = await requireAuthenticatorReconnectSession()
  if (!rawSession.user.twoFactorEnabled) redirect("/auth/two-factor/setup")

  const password = String(formData.get("password") ?? "")
  const secondFactor = String(formData.get("secondFactor") ?? "").trim()
  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const subjectHash = authSubjectHash(identity.academyId)
  const attempt = { ipHash: security.ipHash, subjectHash }
  if (loginIsBlocked(attempt)) {
    writeAuthSecurityEvent({
      accountId: identity.subjectId,
      eventType: "login_rate_limited",
      ipHash: security.ipHash,
      metadata: { operation: "totp_reconnect" },
      outcome: "blocked",
      subjectHash,
      userAgent: security.userAgent,
    })
    return {
      error: "Too many attempts. Wait a few minutes before trying again.",
      errorField: null,
    }
  }
  if (!password) {
    return { error: "Enter your current password.", errorField: "password" }
  }
  if (!await verifyCurrentPassword({ accountId: identity.subjectId, password })) {
    recordLoginFailure(attempt)
    return { error: "The current password could not be verified.", errorField: "password" }
  }
  if (!secondFactor) {
    return { error: "Enter a current authenticator code or an unused recovery code.", errorField: "secondFactor" }
  }

  const requestAuth = getAuth()
  try {
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
    recordLoginFailure(attempt)
    writeAuthSecurityEvent({
      accountId: identity.subjectId,
      eventType: "totp_failed",
      ipHash: security.ipHash,
      metadata: { operation: "reconnect" },
      outcome: "failure",
      userAgent: security.userAgent,
    })
    return {
      error: "That authenticator or recovery code was not accepted.",
      errorField: "secondFactor",
    }
  }

  recordLoginSuccess(subjectHash)

  try {
    await requestAuth.api.revokeOtherSessions({ headers: requestHeaders })
    await requestAuth.api.disableTwoFactor({
      body: { password },
      headers: requestHeaders,
    })
  } catch {
    return {
      error: "The authenticator could not be reconnected. Try again.",
      errorField: null,
    }
  }

  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    actorAccountId: identity.subjectId,
    eventType: "totp_reconnect_started",
    ipHash: security.ipHash,
    outcome: "success",
    userAgent: security.userAgent,
  })
  redirect("/auth/two-factor/setup?reconnect=1")
}

export async function startTotpSetup(
  _previousState: TotpSetupState,
  formData: FormData,
): Promise<TotpSetupState> {
  const rawSession = await requireProtectedSetupSession()
  if (rawSession.user.twoFactorEnabled) redirect(destinationForUser(rawSession.user.id))
  const password = String(formData.get("password") ?? "")
  if (!password) return { error: "Enter your password to continue.", setup: null }

  try {
    const response = await getAuth().api.enableTwoFactor({
      body: { issuer: "Sathiya Moorthy Badminton Academy", password },
      headers: await headers(),
    })
    // Only an explicit method: "otp" request yields the non-TOTP enrolment, so
    // reaching it here means the auth plugin is misconfigured, not a bad password.
    if (response.method !== "totp") {
      return { error: "The authenticator could not be set up. Contact support.", setup: null }
    }
    return {
      error: null,
      setup: {
        backupCodes: response.backupCodes,
        totpURI: response.totpURI,
      },
    }
  } catch {
    return { error: "That password could not be verified.", setup: null }
  }
}

export async function confirmTotpSetup(
  _previousState: TotpVerificationState,
  formData: FormData,
): Promise<TotpVerificationState> {
  const rawSession = await requireProtectedSetupSession()
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  if (!/^\d{6}$/u.test(code)) return { error: "Enter the six-digit code from your authenticator app." }
  const requestHeaders = await headers()

  try {
    await getAuth().api.verifyTOTP({ body: { code, trustDevice: true }, headers: requestHeaders })
  } catch {
    const security = requestSecurityContext(requestHeaders)
    writeAuthSecurityEvent({
      accountId: rawSession.user.id,
      eventType: "totp_failed",
      ipHash: security.ipHash,
      outcome: "failure",
      userAgent: security.userAgent,
    })
    return { error: "That code was not accepted. Wait for a new code and try again." }
  }

  const security = requestSecurityContext(requestHeaders)
  writeAuthSecurityEvent({
    accountId: rawSession.user.id,
    eventType: "totp_enabled",
    ipHash: security.ipHash,
    outcome: "success",
    userAgent: security.userAgent,
  })
  redirect(destinationForUser(rawSession.user.id))
}

export async function verifyTotpSignIn(
  _previousState: TotpVerificationState,
  formData: FormData,
): Promise<TotpVerificationState> {
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  if (!/^\d{6}$/u.test(code)) return { error: "Enter the six-digit code from your authenticator app." }
  const requestHeaders = await headers()
  try {
    const response = await getAuth().api.verifyTOTP({
      body: { code, trustDevice: formData.get("trustDevice") === "on" },
      headers: requestHeaders,
    })
    const security = requestSecurityContext(requestHeaders)
    writeAuthSecurityEvent({
      accountId: response.user.id,
      eventType: "totp_verified",
      ipHash: security.ipHash,
      outcome: "success",
      userAgent: security.userAgent,
    })
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    // Next.js redirects are intentionally thrown; do not turn a successful
    // verification into an error message.
    if (error && typeof error === "object" && "digest" in error) throw error
    return { error: "That code was not accepted. Wait for a new code and try again." }
  }
}

export async function verifyBackupCodeSignIn(
  _previousState: TotpVerificationState,
  formData: FormData,
): Promise<TotpVerificationState> {
  const code = String(formData.get("backupCode") ?? "").trim()
  if (!code) return { error: "Enter one of your unused recovery codes." }
  const requestHeaders = await headers()
  try {
    const response = await getAuth().api.verifyBackupCode({
      body: { code, trustDevice: false },
      headers: requestHeaders,
    })
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error
    return { error: "That recovery code was not accepted." }
  }
}
