"use server"

import { cookies, headers } from "next/headers"

import {
  confirmRegistrationStatus,
  requestRegistrationStatus,
} from "@/lib/auth/account-service"
import { OperationalActionError } from "@/lib/actions/operational-result"
import {
  ACTIVATION_CLAIM_COOKIE,
  ACTIVATION_CLAIM_LIFETIME_MS,
  createActivationClaimToken,
} from "@/lib/auth/credential-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { requestSecurityContext } from "@/lib/auth/security-context"
import type { RegistrationStatusState } from "@/lib/auth/registration-form"

/** One answer for every unusable code -- see confirmRegistrationStatusCode. */
const INVALID_CODE_MESSAGE = "That code is invalid or expired."

function valuesFrom(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    fullName: String(formData.get("fullName") ?? "").trim(),
  }
}

/**
 * Send a code to whoever is asking where their request stands. The response is
 * the same whether or not a request exists under these details, so this page
 * cannot be used to discover which name-and-address pairs are registered.
 */
export async function requestRegistrationStatusCode(
  _previousState: RegistrationStatusState,
  formData: FormData,
): Promise<RegistrationStatusState> {
  const values = valuesFrom(formData)
  const requestHeaders = await headers()
  const base: RegistrationStatusState = {
    academyId: null,
    error: null,
    errorField: null,
    fullName: null,
    onboardingCompleted: false,
    standing: null,
    step: "details",
    values,
  }

  try {
    await requestRegistrationStatus({
      email: values.email,
      fullName: values.fullName,
      security: requestSecurityContext(requestHeaders),
    })
    return { ...base, step: "code" }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      const errorField = error.field === "email" || error.field === "fullName"
        ? error.field
        : null
      return { ...base, error: error.message, errorField }
    }
    throw error
  }
}

/**
 * Report the standing. Every unusable code returns the same message, for the
 * same reason the send step keeps its answer uniform.
 */
export async function confirmRegistrationStatusCode(
  _previousState: RegistrationStatusState,
  formData: FormData,
): Promise<RegistrationStatusState> {
  const values = valuesFrom(formData)
  const requestHeaders = await headers()
  const base: RegistrationStatusState = {
    academyId: null,
    error: null,
    errorField: null,
    fullName: null,
    onboardingCompleted: false,
    standing: null,
    step: "code",
    values,
  }

  const activationToken = createActivationClaimToken()
  const result = confirmRegistrationStatus({
    activationToken,
    code: String(formData.get("code") ?? ""),
    email: values.email,
    fullName: values.fullName,
    security: requestSecurityContext(requestHeaders),
  })
  if (!result) return { ...base, error: INVALID_CODE_MESSAGE, errorField: "code" }

  if (result.standing === "approved" && result.onboardingCompleted) {
    // The claim was written inside the code's own transaction, so the cookie is
    // handing over a receipt that already exists rather than creating authority.
    const cookieStore = await cookies()
    cookieStore.set(ACTIVATION_CLAIM_COOKIE, activationToken, {
      httpOnly: true,
      maxAge: ACTIVATION_CLAIM_LIFETIME_MS / 1000,
      path: "/",
      sameSite: "lax",
      secure: secureAuthCookiesRequired(),
    })
  }

  /*
   * `accountId` is deliberately dropped rather than spread: it exists so this
   * action can mint the claim, and it must not reach the client.
   */
  return {
    ...base,
    academyId: result.academyId,
    fullName: result.fullName,
    onboardingCompleted: result.onboardingCompleted,
    standing: result.standing,
    step: "done",
  }
}
