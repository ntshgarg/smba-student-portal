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
  // Spending a recovery code here goes on to switch the authenticator off, which
  // is exactly what an alert on recovery-code use exists to catch.
  if (!/^\d{6}$/u.test(secondFactor)) {
    recordSecondFactorSuccess(requestHeaders, identity.subjectId, "backup_code", "reconnect")
  }

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
    // Same convention, other half: an action grants nothing its form did not
    // ask for. The enrolment form has no trust-this-device control, and
    // `trustDevice` makes the two-factor plugin's /sign-in/username after-hook
    // return early for trustDeviceMaxAge (30 days, better-auth.ts:156),
    // skipping the second factor entirely. The only place this portal offers
    // that is the explicit opt-in checkbox on the sign-in challenge
    // (verifyTotpSignIn, below).
    await getAuth().api.verifyTOTP({ body: { code, trustDevice: false }, headers: requestHeaders })
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

// Failures an unauthenticated caller can cause are written, but not without
// limit: this action is public, and the two-factor plugin's own throttle never
// sees a call that carries no challenge. Per instance and per address, which is
// enough to keep one source from filling the table or tripping the monitor.
const FAILURE_AUDIT_WINDOW_MS = 60 * 60 * 1000
const FAILURE_AUDIT_PER_WINDOW = 10
const FAILURE_AUDIT_TRACKED_KEYS = 2_000
const failureAudit = new Map<string, { count: number, windowStartedAt: number }>()

function failureAuditAllowed(key: string, now = Date.now()) {
  if (failureAudit.size > FAILURE_AUDIT_TRACKED_KEYS) failureAudit.clear()
  const current = failureAudit.get(key)
  if (!current || now - current.windowStartedAt >= FAILURE_AUDIT_WINDOW_MS) {
    failureAudit.set(key, { count: 1, windowStartedAt: now })
    return true
  }
  current.count += 1
  return current.count <= FAILURE_AUDIT_PER_WINDOW
}

// A sign-in that is genuinely waiting on its second factor carries the
// plugin's signed challenge cookie (`<prefix>.two_factor`, with a __Secure-
// prefix over HTTPS). A request without one is not a failed second factor, it
// is noise, and is not recorded.
function carriesSecondFactorChallenge(requestHeaders: Pick<Headers, "get">) {
  return (requestHeaders.get("cookie") ?? "")
    .split(";")
    .some((pair) => /(?:^|[._-])two_factor$/u.test(pair.split("=")[0]?.trim() ?? ""))
}

function recordSecondFactorFailure(
  requestHeaders: Awaited<ReturnType<typeof headers>>,
  method: "backup_code" | "totp",
) {
  try {
    if (!carriesSecondFactorChallenge(requestHeaders)) return
    const security = requestSecurityContext(requestHeaders)
    if (!failureAuditAllowed(security.ipHash)) return
    writeAuthSecurityEvent({
      eventType: "totp_failed",
      ipHash: security.ipHash,
      metadata: { method, operation: "sign_in" },
      outcome: "failure",
      userAgent: security.userAgent,
    })
  } catch {
    // Never let a failed audit write change what the person sees.
  }
}

// A verified second factor has already been accepted and its code spent by the
// time this runs, so a failed write must not turn that into a refusal.
function recordSecondFactorSuccess(
  requestHeaders: Awaited<ReturnType<typeof headers>>,
  accountId: string,
  method: "backup_code" | "totp",
  operation?: string,
) {
  try {
    const security = requestSecurityContext(requestHeaders)
    writeAuthSecurityEvent({
      accountId,
      eventType: "totp_verified",
      ipHash: security.ipHash,
      metadata: operation ? { method, operation } : { method },
      outcome: "success",
      userAgent: security.userAgent,
    })
  } catch {
    // See above.
  }
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
    recordSecondFactorSuccess(requestHeaders, response.user.id, "totp")
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    // Next.js redirects are intentionally thrown; do not turn a successful
    // verification into an error message.
    if (error && typeof error === "object" && "digest" in error) throw error
    // A wrong second factor at sign-in used to leave no trace, so guessing the
    // authenticator on the head coach or owner account was invisible. The person
    // is not signed in yet, so there is no account to name; the address and
    // agent are what the record can carry.
    recordSecondFactorFailure(requestHeaders, "totp")
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
    // A recovery code skips the authenticator for the head coach and the owner,
    // and each one is single-use, so any use at all is worth an alert: it is
    // either the owner who lost their phone or someone who found the codes.
    recordSecondFactorSuccess(requestHeaders, response.user.id, "backup_code")
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error
    recordSecondFactorFailure(requestHeaders, "backup_code")
    return { error: "That recovery code was not accepted." }
  }
}
