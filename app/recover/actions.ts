"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  claimPasswordRecovery,
  completePasswordRecovery,
  getPasswordRecoveryStatus,
  PASSWORD_RECOVERY_LIFETIME_MS,
  RECOVERY_SESSION_COOKIE,
  requestPasswordRecovery,
  verifyPasswordRecoverySecondFactor,
} from "@/lib/auth/recovery-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { validateNewPassword } from "@/lib/auth/credential-service"
import { requestSecurityContext } from "@/lib/auth/security-context"

export type RecoveryRequestState = {
  error: string | null
  sent: boolean
}

export type RecoverySecondFactorState = {
  error: string | null
}

export type RecoveryPasswordState = {
  error: string | null
  errorField: "password" | "confirmPassword" | null
}

/** Where the recovery pass cookie lives; a delete must name the same path. */
const RECOVERY_COOKIE_PATH = "/recover"

async function requestContext() {
  return requestSecurityContext(await headers())
}

export async function requestPasswordRecoveryAction(
  _previousState: RecoveryRequestState,
  formData: FormData,
): Promise<RecoveryRequestState> {
  await requestPasswordRecovery({
    academyId: String(formData.get("academyId") ?? ""),
    email: String(formData.get("email") ?? ""),
    security: await requestContext(),
  })
  return { error: null, sent: true }
}

/**
 * The Continue button on the page the emailed link opens. Opening the link only
 * shows that page; this is the step that uses the link up, and it ties the
 * reset to this browser with a fresh pass in place of the emailed token.
 */
export async function openPasswordRecoveryLinkAction(formData: FormData) {
  const token = String(formData.get("token") ?? "")
  const pass = claimPasswordRecovery(token)
  const cookieStore = await cookies()
  if (!pass) {
    // A second tap whose first already tied the reset to this browser.
    const held = cookieStore.get(RECOVERY_SESSION_COOKIE)?.value
    if (held && getPasswordRecoveryStatus(held).state !== "missing") redirect("/recover/reset")
    redirect("/recover?error=invalid")
  }
  cookieStore.set(RECOVERY_SESSION_COOKIE, pass, {
    httpOnly: true,
    maxAge: PASSWORD_RECOVERY_LIFETIME_MS / 1_000,
    path: RECOVERY_COOKIE_PATH,
    sameSite: "lax",
    secure: secureAuthCookiesRequired(),
  })
  redirect("/recover/reset")
}

export async function verifyRecoverySecondFactorAction(
  _previousState: RecoverySecondFactorState,
  formData: FormData,
): Promise<RecoverySecondFactorState> {
  const token = (await cookies()).get(RECOVERY_SESSION_COOKIE)?.value ?? ""
  const credential = String(formData.get("credential") ?? "").trim()
  if (!credential) return { error: "Enter an authenticator or saved recovery code." }
  const verified = await verifyPasswordRecoverySecondFactor({
    credential,
    security: await requestContext(),
    token,
  })
  if (!verified) return { error: "That code was not accepted." }
  redirect("/recover/reset")
}

export async function completePasswordRecoveryAction(
  _previousState: RecoveryPasswordState,
  formData: FormData,
): Promise<RecoveryPasswordState> {
  const password = String(formData.get("password") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")
  const passwordError = validateNewPassword(password)
  if (passwordError) return { error: passwordError, errorField: "password" }
  if (password !== confirmPassword) {
    return { error: "The passwords do not match.", errorField: "confirmPassword" }
  }
  const cookieStore = await cookies()
  const token = cookieStore.get(RECOVERY_SESSION_COOKIE)?.value ?? ""
  const completed = await completePasswordRecovery({
    password,
    security: await requestContext(),
    token,
  })
  if (!completed) {
    return { error: "This recovery session is invalid or expired.", errorField: null }
  }
  cookieStore.delete({ name: RECOVERY_SESSION_COOKIE, path: RECOVERY_COOKIE_PATH })
  redirect("/login?recovered=1")
}
