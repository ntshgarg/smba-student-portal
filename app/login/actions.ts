"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { hashPassword } from "better-auth/crypto"

import {
  isAcademyId,
  normalizeAcademyId,
  normalizeFullName,
} from "@/lib/auth/identity"
import {
  findApprovedAccountByAcademyId,
  registerPublicAccountRequest,
} from "@/lib/auth/account-service"
import { OperationalActionError } from "@/lib/actions/operational-result"
import { getAuth } from "@/lib/auth/better-auth"
import {
  ACTIVATION_CLAIM_COOKIE,
  completeAccountActivation,
  createActivationClaimToken,
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  validateNewPassword,
} from "@/lib/auth/credential-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"
import {
  authSubjectHash,
  requestSecurityContext,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"
import { clearDatabaseSession } from "@/lib/auth/session"
import { publicSiteUrl } from "@/lib/config"

const GENERIC_LOGIN_ERROR = "SMBA username or password is incorrect. If this is your first visit, activate your account."
const GENERIC_PIN_ERROR = "SMBA username or PIN is incorrect. Use your password if PIN login is unavailable."
const RATE_LIMITED_LOGIN_ERROR = "We couldn\u2019t sign you in. Wait a few minutes before trying again."

// Better Auth surfaces an endpoint refusal as an APIError carrying the status it
// was thrown with. The PIN endpoint throws TOO_MANY_REQUESTS once the shared
// account/IP budget is spent and UNAUTHORIZED otherwise, and only the first
// should tell the person to wait -- saying "wait a few minutes" to someone who
// simply mistyped their PIN sends them away from a screen they could have used.
function isRateLimitedAuthError(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  const status = (error as { status?: unknown }).status
  return status === "TOO_MANY_REQUESTS" || status === 429
}

export type LoginFormState = {
  error: string | null
}

export type ActivationFormState = {
  error: string | null
  errorField: "password" | "confirmPassword" | null
}

export type RegistrationFormState = {
  error: string | null
  errorField: "fullName" | "requestedRole" | null
  requestedRole: "coach" | "player"
  submitted: boolean
}

export async function loginWithAcademyId(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const academyId = normalizeAcademyId(String(formData.get("academyId") ?? ""))
  const password = String(formData.get("password") ?? "")
  if (!isAcademyId(academyId)) {
    return { error: "Enter your SMBA username." }
  }
  if (!password) return { error: GENERIC_LOGIN_ERROR }

  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const subjectHash = authSubjectHash(academyId)
  const auditBase = {
    ipHash: security.ipHash,
    subjectHash,
    userAgent: security.userAgent,
  }

  if (loginIsBlocked({ ipHash: security.ipHash, subjectHash })) {
    writeAuthSecurityEvent({
      ...auditBase,
      eventType: "login_rate_limited",
      outcome: "blocked",
    })
    return { error: "We couldn’t sign you in. Wait a few minutes before trying again." }
  }

  const account = findApprovedAccountByAcademyId(academyId)
  if (!account?.role || account.credentialStatus !== "active") {
    // Match the expensive path used for a real credential to reduce account
    // discovery through response timing.
    await hashPassword(password)
    recordLoginFailure({ ipHash: security.ipHash, subjectHash })
    writeAuthSecurityEvent({
      ...auditBase,
      accountId: account?.accountId,
      eventType: "login_failed",
      outcome: "failure",
    })
    return { error: GENERIC_LOGIN_ERROR }
  }

  const requestAuth = getAuth()
  let response: Awaited<ReturnType<typeof requestAuth.api.signInUsername>>
  try {
    response = await requestAuth.api.signInUsername({
      body: { password, username: academyId },
      headers: requestHeaders,
    })
  } catch {
    recordLoginFailure({ ipHash: security.ipHash, subjectHash })
    writeAuthSecurityEvent({
      ...auditBase,
      accountId: account.accountId,
      eventType: "login_failed",
      outcome: "failure",
    })
    return { error: GENERIC_LOGIN_ERROR }
  }

  recordLoginSuccess(subjectHash)
  writeAuthSecurityEvent({
    ...auditBase,
    accountId: account.accountId,
    eventType: "login_succeeded",
    metadata: { factor: "password" },
    outcome: "success",
  })

  if ("twoFactorRedirect" in response && response.twoFactorRedirect) {
    redirect("/auth/two-factor")
  }

  const twoFactorEnabled = "twoFactorEnabled" in response.user
    && response.user.twoFactorEnabled === true
  redirect(postAuthenticationDestination({
    accessLevel: account.accessLevel,
    accountId: account.accountId,
    role: account.role,
    twoFactorEnabled,
  }))
}

export async function loginWithPin(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const academyId = normalizeAcademyId(String(formData.get("academyId") ?? ""))
  const pin = String(formData.get("pin") ?? "")
  if (!isAcademyId(academyId) || !/^\d{6}$/u.test(pin)) {
    return { error: GENERIC_PIN_ERROR }
  }

  // The account/IP lockout and the audit rows for this factor live in the
  // endpoint itself (lib/auth/pin-plugin.ts), not here. It is reachable both
  // through `auth.api.signInPin` below and directly at POST
  // /api/auth/sign-in/pin, so a guard in this action would have covered one
  // caller and left the other open. Duplicating it here as well would double
  // every failure against the five-attempt budget and write each audit row
  // twice, so this action now only translates the endpoint's refusal into copy.
  const requestHeaders = await headers()
  const requestAuth = getAuth()
  let response: Awaited<ReturnType<typeof requestAuth.api.signInPin>>
  try {
    response = await requestAuth.api.signInPin({
      body: { pin, username: academyId },
      headers: requestHeaders,
    })
  } catch (error) {
    return { error: isRateLimitedAuthError(error) ? RATE_LIMITED_LOGIN_ERROR : GENERIC_PIN_ERROR }
  }

  if ("twoFactorRedirect" in response && response.twoFactorRedirect) {
    redirect("/auth/two-factor")
  }

  // Read after the endpoint has authenticated, purely to route the person to the
  // right landing surface. The endpoint has already decided that the credential
  // is good, so an absent row here is a data fault rather than a failed sign-in
  // and must not be reported as one.
  const account = findApprovedAccountByAcademyId(academyId)
  if (!account?.role) return { error: GENERIC_PIN_ERROR }
  const twoFactorEnabled = "twoFactorEnabled" in response.user
    && response.user.twoFactorEnabled === true
  redirect(postAuthenticationDestination({
    accessLevel: account.accessLevel,
    accountId: account.accountId,
    role: account.role,
    twoFactorEnabled,
  }))
}

export async function activateAccount(
  _previousState: ActivationFormState,
  formData: FormData,
): Promise<ActivationFormState> {
  const password = String(formData.get("password") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")
  const passwordError = validateNewPassword(password)
  if (passwordError) return { error: passwordError, errorField: "password" }
  if (password !== confirmPassword) {
    return { error: "The passwords do not match.", errorField: "confirmPassword" }
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(ACTIVATION_CLAIM_COOKIE)?.value ?? ""
  const activated = await completeAccountActivation({ token, password })
  if (!activated) {
    return {
      error: "This registration link is unavailable or has expired. Return to registration to request access again.",
      errorField: null,
    }
  }

  const requestHeaders = await headers()
  const response = await getAuth().api.signInUsername({
    body: { password, username: activated.academyId },
    headers: requestHeaders,
  })
  cookieStore.delete(ACTIVATION_CLAIM_COOKIE)
  if ("twoFactorRedirect" in response && response.twoFactorRedirect) redirect("/auth/two-factor")
  redirect("/auth/pin/setup")
}

export async function submitRegistration(
  _previousState: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const fullName = normalizeFullName(String(formData.get("fullName") ?? ""))
  const registrationRequestKey = String(formData.get("registrationRequestKey") ?? "")
  const requestedRole = formData.get("requestedRole") === "coach" ? "coach" : "player"

  if (fullName.length < 2) {
    return { error: "Enter your full name.", errorField: "fullName", requestedRole, submitted: false }
  }
  if (fullName.length > 80) {
    return {
      error: "Keep your name to 80 characters or fewer.",
      errorField: "fullName",
      requestedRole,
      submitted: false,
    }
  }

  try {
    const activationToken = createActivationClaimToken()
    registerPublicAccountRequest({
      activationToken,
      fullName,
      requestKey: registrationRequestKey,
      requestedRole,
    })
    const cookieStore = await cookies()
    cookieStore.set(ACTIVATION_CLAIM_COOKIE, activationToken, {
      httpOnly: true,
      maxAge: 90 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: secureAuthCookiesRequired(),
    })
    return { error: null, errorField: null, requestedRole, submitted: true }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return {
        error: error.message,
        errorField: error.field === "fullName" || error.field === "requestedRole"
          ? error.field
          : null,
        requestedRole,
        submitted: false,
      }
    }
    throw error
  }
}

export async function clearSession() {
  await clearDatabaseSession()
  redirect(publicSiteUrl)
}
