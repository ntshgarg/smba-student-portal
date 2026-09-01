"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { hashPassword } from "better-auth/crypto"

import {
  isAcademyId,
  normalizeAcademyId,
  normalizeFullName,
  ACADEMY_ID_LABEL,
} from "@/lib/auth/identity"
import {
  findApprovedAccountByAcademyId,
  confirmRegistration,
  registerPublicAccountRequest,
  requestRegistration,
  type RegistrationStanding,
} from "@/lib/auth/account-service"
import { OperationalActionError } from "@/lib/actions/operational-result"
import { getAuth } from "@/lib/auth/better-auth"
import {
  ACTIVATION_CLAIM_COOKIE,
  ACTIVATION_CLAIM_LIFETIME_MS,
  completeAccountActivation,
  createActivationClaimToken,
  loginIsBlocked,
  recordLoginFailure,
  validateNewPassword,
} from "@/lib/auth/credential-service"
import { signInWithJustWrittenPassword } from "@/lib/auth/username-login-guard"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"
import {
  authSubjectHash,
  requestSecurityContext,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"
import { clearDatabaseSession } from "@/lib/auth/session"
import {
  EMPTY_REGISTRATION_VALUES,
  type RegistrationField,
  type RegistrationFormState,
  type RegistrationValues,
} from "@/lib/auth/registration-form"
import { publicSiteUrl } from "@/lib/config"

const GENERIC_LOGIN_ERROR = `${ACADEMY_ID_LABEL} or password is incorrect. If this is your first visit, activate your account.`
const GENERIC_PIN_ERROR = `${ACADEMY_ID_LABEL} or PIN is incorrect. Use your password if PIN login is unavailable.`
const RATE_LIMITED_LOGIN_ERROR = "We couldn\u2019t sign you in. Wait a few minutes before trying again."
const ACTIVATED_WITHOUT_SESSION_ERROR = "Your account is ready, but we couldn\u2019t sign you in. Open the sign-in page and use your new password."

// Better Auth surfaces an endpoint refusal as an APIError carrying the status it
// was thrown with. Both sign-in endpoints throw TOO_MANY_REQUESTS once the
// shared account/IP budget is spent and UNAUTHORIZED otherwise, and only the
// first should tell the person to wait -- saying "wait a few minutes" to someone
// who simply mistyped sends them away from a screen they could have used.
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

export type { RegistrationFormState } from "@/lib/auth/registration-form"

/** One message for every way a code can be unusable -- see confirmRegistrationCode. */
const INVALID_CODE_MESSAGE = "That code is invalid or expired."

function registrationValuesFrom(formData: FormData): RegistrationValues {
  return {
    dateOfBirth: String(formData.get("dateOfBirth") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    fullName: normalizeFullName(String(formData.get("fullName") ?? "")),
    phone: String(formData.get("phone") ?? "").trim(),
    requestedRole: formData.get("requestedRole") === "coach" ? "coach" : "player",
  }
}

function registrationFieldFrom(field: string | undefined): RegistrationField | null {
  switch (field) {
    case "dateOfBirth":
    case "email":
    case "fullName":
    case "phone":
    case "requestedRole":
      return field
    default:
      return null
  }
}

export async function loginWithAcademyId(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const academyId = normalizeAcademyId(String(formData.get("academyId") ?? ""))
  const password = String(formData.get("password") ?? "")
  if (!isAcademyId(academyId)) {
    return { error: `Enter your ${ACADEMY_ID_LABEL}.` }
  }
  if (!password) return { error: GENERIC_LOGIN_ERROR }

  // The account/IP lockout and the audit rows for a guess that reaches the
  // endpoint live in its hooks (lib/auth/username-login-guard.ts), not here: it
  // is reachable both through `auth.api.signInUsername` below and directly at
  // POST /api/auth/sign-in/username, so a guard that only sat in this action
  // covered one caller and left the other open.
  //
  // The block is still read here, and read first, because this action answers
  // two ways. An Academy ID that exists and is active reaches the endpoint and
  // is refused there; one that does not exist never gets that far. Without this
  // check the two answers diverge the moment the budget is spent -- wait copy
  // for a real ID, "incorrect" for an unknown one -- which is one request per
  // candidate, no password needed, and the branch below never blocks, so the
  // probing never stops. Returning here keeps both answers identical and keeps
  // this action off the endpoint entirely, so nothing is counted or audited
  // twice.
  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const subjectHash = authSubjectHash(academyId)
  if (loginIsBlocked({ ipHash: security.ipHash, subjectHash })) {
    writeAuthSecurityEvent({
      eventType: "login_rate_limited",
      ipHash: security.ipHash,
      metadata: { factor: "password" },
      outcome: "blocked",
      subjectHash,
      userAgent: security.userAgent,
    })
    return { error: RATE_LIMITED_LOGIN_ERROR }
  }

  const account = findApprovedAccountByAcademyId(academyId)
  if (!account?.role || account.credentialStatus !== "active") {
    // This branch answers without ever reaching the endpoint, so the attempt is
    // still counted here or it is counted nowhere: dropping it would leave the
    // form an unmetered oracle for probing which Academy IDs exist, cheaper than
    // the endpoint the hooks now meter. Hashing first matches the expensive path
    // used for a real credential, to reduce that same discovery through response
    // timing -- and it is the reason the block above has to come first, because
    // one scrypt measured 74-83 ms idle on this machine and more under load, so
    // a dozen requests a second from one address would otherwise pin a core on
    // an unauthenticated path that no proxy rule meters.
    await hashPassword(password)
    recordLoginFailure({ ipHash: security.ipHash, subjectHash })
    writeAuthSecurityEvent({
      accountId: account?.accountId,
      eventType: "login_failed",
      ipHash: security.ipHash,
      metadata: { factor: "password" },
      outcome: "failure",
      subjectHash,
      userAgent: security.userAgent,
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
  } catch (error) {
    return { error: isRateLimitedAuthError(error) ? RATE_LIMITED_LOGIN_ERROR : GENERIC_LOGIN_ERROR }
  }

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

  // `completeAccountActivation` has written the password and consumed the claim,
  // so the account is live whatever happens next. The sign-in is exempt from the
  // login lockout because the password it presents is the one just written --
  // without that, twenty unrelated failures from the same address would refuse a
  // brand-new player their first session. Anything else that refuses it still
  // must not surface as an unhandled action: the claim is spent, so a throw here
  // would strand somebody whose account is already usable.
  const requestHeaders = await headers()
  const requestAuth = getAuth()
  let response: Awaited<ReturnType<typeof requestAuth.api.signInUsername>>
  try {
    response = await signInWithJustWrittenPassword(() => requestAuth.api.signInUsername({
      body: { password, username: activated.academyId },
      headers: requestHeaders,
    }))
  } catch {
    cookieStore.delete(ACTIVATION_CLAIM_COOKIE)
    return { error: ACTIVATED_WITHOUT_SESSION_ERROR, errorField: null }
  }
  cookieStore.delete(ACTIVATION_CLAIM_COOKIE)
  if ("twoFactorRedirect" in response && response.twoFactorRedirect) redirect("/auth/two-factor")
  redirect("/auth/pin/setup")
}

/**
 * Step one: send a code. No account is written here -- the challenge carries a
 * null accountId until the code comes back, which is what stops an unverified
 * visitor spending rows on a public endpoint.
 *
 * The returned state is deliberately the same shape whether or not this identity
 * is already registered. `requestRegistration` holds every answer open for the
 * same floor before returning, so the form cannot be used to discover which
 * name-and-address pairs exist. Whoever can read the address is told the
 * difference in the email.
 */
export async function requestRegistrationCode(
  _previousState: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const values = registrationValuesFrom(formData)
  const requestHeaders = await headers()
  const base: RegistrationFormState = {
    academyId: null,
    error: null,
    errorField: null,
    standing: null,
    step: "details",
    values,
  }

  try {
    await requestRegistration({
      dateOfBirth: values.dateOfBirth,
      email: values.email,
      fullName: values.fullName,
      phone: values.phone,
      requestedRole: values.requestedRole,
      security: requestSecurityContext(requestHeaders),
    })
    return { ...base, step: "code" }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return { ...base, error: error.message, errorField: registrationFieldFrom(error.field) }
    }
    /*
     * Everything recoverable is retyped as OperationalActionError by
     * requestRegistration, so anything still a plain Error here is unexpected and
     * must reach the error boundary rather than be flattened into a form message
     * that invites a pointless retry.
     */
    throw error
  }
}

/**
 * Step two. Every way a code can be unusable -- wrong, expired, already spent,
 * attempts exhausted, throttled, never issued -- returns the identical message,
 * because distinguishing them would say whether a challenge exists for this
 * identity, which is the same disclosure the send step refuses to make.
 */
export async function confirmRegistrationCode(
  _previousState: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const values = registrationValuesFrom(formData)
  const requestHeaders = await headers()
  const base: RegistrationFormState = {
    academyId: null,
    error: null,
    errorField: null,
    standing: null,
    step: "code",
    values,
  }

  const activationToken = createActivationClaimToken()
  const result = confirmRegistration({
    activationToken,
    code: String(formData.get("code") ?? ""),
    dateOfBirth: values.dateOfBirth,
    email: values.email,
    fullName: values.fullName,
    phone: values.phone,
    requestedRole: values.requestedRole,
    security: requestSecurityContext(requestHeaders),
  })
  if (!result) return { ...base, error: INVALID_CODE_MESSAGE, errorField: "code" }

  if (result.standing === "new") {
    /*
     * The activation claim still rides a cookie so the existing /activate page
     * keeps working unchanged. It is no longer the only way back -- name, email
     * and a fresh code reach the same status from any device -- so losing it is
     * survivable in a way it was not before.
     */
    const cookieStore = await cookies()
    cookieStore.set(ACTIVATION_CLAIM_COOKIE, activationToken, {
      httpOnly: true,
      // Matched to ACTIVATION_CLAIM_LIFETIME_MS. The previous 90 days outlived
      // the claim row by two months, so a cookie could survive in the browser
      // and still resolve `expired`.
      maxAge: ACTIVATION_CLAIM_LIFETIME_MS / 1000,
      path: "/",
      sameSite: "lax",
      secure: secureAuthCookiesRequired(),
    })
  }
  return { ...base, academyId: result.academyId ?? null, standing: result.standing, step: "done" }
}

export async function clearSession() {
  await clearDatabaseSession()
  redirect(publicSiteUrl)
}
