"use server"

import { and, eq, isNull } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth/better-auth"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import {
  releaseLoginAttempt,
  releaseSecondFactorAttempt,
  reserveLoginAttempt,
  reserveSecondFactorAttempt,
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
import { accounts, authMethods, authTwoFactors } from "@/lib/db/schema"
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

const TOO_MANY_SECOND_FACTOR_ATTEMPTS = "Too many attempts. Wait a few minutes before trying again."

/*
 * Whether this account already has a working authenticator. The setup screens
 * exist to add one, so they must refuse an account that has one: checking a code
 * there tests a guess against the real secret, and Better Auth applies its
 * lockout only at sign-in, so it was an unlimited guessing oracle for anyone
 * holding a head-coach or owner session. Read from the database, not the
 * session's copy of the user, so a stale session cannot say otherwise.
 */
function hasVerifiedAuthenticator(accountId: string) {
  return Boolean(initializeDatabase().select({ id: authTwoFactors.id })
    .from(authTwoFactors)
    .where(and(eq(authTwoFactors.userId, accountId), eq(authTwoFactors.verified, true)))
    .get())
}

const SIGN_IN_CHALLENGE_EXPIRED = "Your sign-in has expired. Sign in again."

/*
 * Every value the request carries under one cookie name, read leniently: names
 * and values trimmed, surrounding quotes dropped, percent-decoded. Lenient on
 * purpose -- Next's cookie parser and the one Better Auth verifies with disagree
 * about duplicates, padding and quotes, so reading the challenge with either
 * parser alone let a crafted Cookie header show this code one value (or none)
 * while Better Auth checked another. Collecting every candidate and accepting
 * only exactly one leaves nothing for the two to disagree about.
 */
function cookieValues(cookieHeader: string | null, name: string) {
  const values: string[] = []
  for (const pair of (cookieHeader ?? "").split(";")) {
    const separator = pair.indexOf("=")
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue
    let value = pair.slice(separator + 1).trim()
    if (value.startsWith("\"")) value = value.slice(1, -1)
    try {
      values.push(decodeURIComponent(value))
    } catch {
      values.push(value)
    }
  }
  return values
}

/*
 * The account a half-finished sign-in is waiting on, from the challenge cookie
 * the first factor set. The cookie holds the challenge id and a signature; the
 * id is random and only issued to whoever passed the password or PIN, so it
 * cannot be made up to point at someone else's account, and Better Auth checks
 * the signature itself when it verifies the code. Null -- and the request is
 * refused -- when there is no live challenge, when the cookie appears more than
 * once, or when the lookup fails: a code is never checked here without first
 * spending the challenged account's budget.
 */
async function challengedAccountId(requestHeaders: Pick<Headers, "get">) {
  try {
    const authContext = await getAuth().$context
    const name = authContext.createAuthCookie("two_factor").name
    const values = cookieValues(requestHeaders.get("cookie"), name)
    if (values.length !== 1) return null
    const signatureStart = values[0]!.lastIndexOf(".")
    if (signatureStart < 1) return null
    const challenge = await authContext.internalAdapter
      .findVerificationValue(values[0]!.slice(0, signatureStart))
    if (!challenge || challenge.expiresAt <= new Date()) return null
    return challenge.value
  } catch {
    return null
  }
}

/*
 * The sign-in code check is for a half-finished sign-in only. With a session in
 * the request, Better Auth checks the code against the SESSION's account on its
 * in-session path, which has no lockout -- so these two actions became an
 * unlimited guessing oracle for anyone holding a head-coach or owner session,
 * the same hole closed in confirmTotpSetup. A signed-in caller has nothing to
 * finish here and is sent on.
 */
async function refuseSignedInCaller() {
  const session = await getRawAuthSession()
  if (session) redirect(destinationForUser(session.user.id))
}

function recordSecondFactorRateLimited(
  requestHeaders: Awaited<ReturnType<typeof headers>>,
  accountId: string,
  operation: string,
) {
  try {
    const security = requestSecurityContext(requestHeaders)
    writeAuthSecurityEvent({
      accountId,
      eventType: "login_rate_limited",
      ipHash: security.ipHash,
      metadata: { factor: "second_factor", operation },
      outcome: "blocked",
      userAgent: security.userAgent,
    })
  } catch {
    // Never let a failed audit write change what the person sees.
  }
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
  if (!password) {
    return { error: "Enter your current password.", errorField: "password" }
  }
  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const subjectHash = authSubjectHash(identity.academyId)
  const attempt = { ipHash: security.ipHash, subjectHash }
  // Each guess is reserved before its slow check rather than counted after it,
  // so parallel requests cannot all read "not blocked" first.
  if (!reserveLoginAttempt(attempt)) {
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
  if (!await verifyCurrentPassword({ accountId: identity.subjectId, password })) {
    return { error: "The current password could not be verified.", errorField: "password" }
  }
  releaseLoginAttempt(attempt)
  if (!secondFactor) {
    return { error: "Enter a current authenticator code or an unused recovery code.", errorField: "secondFactor" }
  }
  if (!reserveSecondFactorAttempt(identity.subjectId, "session")) {
    recordSecondFactorRateLimited(requestHeaders, identity.subjectId, "totp_reconnect")
    return { error: TOO_MANY_SECOND_FACTOR_ATTEMPTS, errorField: null }
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

  releaseSecondFactorAttempt(identity.subjectId)
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
  if (rawSession.user.twoFactorEnabled || hasVerifiedAuthenticator(rawSession.user.id)) {
    redirect(destinationForUser(rawSession.user.id))
  }
  const password = String(formData.get("password") ?? "")
  if (!password) return { error: "Enter your password to continue.", setup: null }

  // enableTwoFactor checks the password with a full scrypt. That check was
  // unmetered here, so a session on an account with no authenticator yet could
  // guess the password without limit and, on a hit, enrol its own authenticator.
  // It now spends the same sign-in budget, reserved before the check.
  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const academyId = initializeDatabase().select({ identifier: authMethods.identifier })
    .from(authMethods)
    .where(and(
      eq(authMethods.accountId, rawSession.user.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .get()?.identifier
  const subjectHash = authSubjectHash(academyId ?? `account:${rawSession.user.id}`)
  const attempt = { ipHash: security.ipHash, subjectHash }
  if (!reserveLoginAttempt(attempt)) {
    writeAuthSecurityEvent({
      accountId: rawSession.user.id,
      eventType: "login_rate_limited",
      ipHash: security.ipHash,
      metadata: { factor: "current_password", operation: "totp_setup" },
      outcome: "blocked",
      subjectHash,
      userAgent: security.userAgent,
    })
    return { error: TOO_MANY_SECOND_FACTOR_ATTEMPTS, setup: null }
  }

  try {
    const response = await getAuth().api.enableTwoFactor({
      body: { issuer: "Sathiya Moorthy Badminton Academy", password },
      headers: requestHeaders,
    })
    releaseLoginAttempt(attempt)
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
  // Setup is for an account with no working authenticator, the same rule
  // startTotpSetup applies. See hasVerifiedAuthenticator.
  if (rawSession.user.twoFactorEnabled || hasVerifiedAuthenticator(rawSession.user.id)) {
    redirect(destinationForUser(rawSession.user.id))
  }
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  if (!/^\d{6}$/u.test(code)) return { error: "Enter the six-digit code from your authenticator app." }
  const requestHeaders = await headers()
  if (!reserveSecondFactorAttempt(rawSession.user.id, "session")) {
    recordSecondFactorRateLimited(requestHeaders, rawSession.user.id, "totp_setup")
    return { error: TOO_MANY_SECOND_FACTOR_ATTEMPTS }
  }

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

  releaseSecondFactorAttempt(rawSession.user.id)
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

// A wrong code against a live sign-in challenge, named to the account being
// challenged. Only a real challenge is recorded: the challenge id comes from a
// first-factor sign-in, so a made-up cookie no longer writes rows or trips the
// monitor's second-factor alert, and each account's rows are bounded by its
// second-factor budget.
function recordSecondFactorFailure(
  requestHeaders: Awaited<ReturnType<typeof headers>>,
  accountId: string,
  method: "backup_code" | "totp",
) {
  try {
    const security = requestSecurityContext(requestHeaders)
    writeAuthSecurityEvent({
      accountId,
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
  await refuseSignedInCaller()
  const requestHeaders = await headers()
  // Better Auth locks a challenge after eight misses, but it reads the count
  // before checking the code and writes it after, and each first-factor sign-in
  // opens a fresh challenge -- so parallel challenges, one guess each, all got
  // past it. The account's own budget is spent here first, as a single step.
  const accountId = await challengedAccountId(requestHeaders)
  if (!accountId) return { error: SIGN_IN_CHALLENGE_EXPIRED }
  if (!reserveSecondFactorAttempt(accountId, "challenge")) {
    recordSecondFactorRateLimited(requestHeaders, accountId, "sign_in")
    return { error: TOO_MANY_SECOND_FACTOR_ATTEMPTS }
  }
  try {
    const response = await getAuth().api.verifyTOTP({
      body: { code, trustDevice: formData.get("trustDevice") === "on" },
      headers: requestHeaders,
    })
    releaseSecondFactorAttempt(response.user.id)
    recordSecondFactorSuccess(requestHeaders, response.user.id, "totp")
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    // Next.js redirects are intentionally thrown; do not turn a successful
    // verification into an error message.
    if (error && typeof error === "object" && "digest" in error) throw error
    recordSecondFactorFailure(requestHeaders, accountId, "totp")
    return { error: "That code was not accepted. Wait for a new code and try again." }
  }
}

export async function verifyBackupCodeSignIn(
  _previousState: TotpVerificationState,
  formData: FormData,
): Promise<TotpVerificationState> {
  const code = String(formData.get("backupCode") ?? "").trim()
  if (!code) return { error: "Enter one of your unused recovery codes." }
  await refuseSignedInCaller()
  const requestHeaders = await headers()
  const accountId = await challengedAccountId(requestHeaders)
  if (!accountId) return { error: SIGN_IN_CHALLENGE_EXPIRED }
  if (!reserveSecondFactorAttempt(accountId, "challenge")) {
    recordSecondFactorRateLimited(requestHeaders, accountId, "sign_in")
    return { error: TOO_MANY_SECOND_FACTOR_ATTEMPTS }
  }
  try {
    const response = await getAuth().api.verifyBackupCode({
      body: { code, trustDevice: false },
      headers: requestHeaders,
    })
    releaseSecondFactorAttempt(response.user.id)
    // A recovery code skips the authenticator for the head coach and the owner,
    // and each one is single-use, so any use at all is worth an alert: it is
    // either the owner who lost their phone or someone who found the codes.
    recordSecondFactorSuccess(requestHeaders, response.user.id, "backup_code")
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error
    recordSecondFactorFailure(requestHeaders, accountId, "backup_code")
    return { error: "That recovery code was not accepted." }
  }
}
