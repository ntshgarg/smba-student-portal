"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  AUTHENTICATOR_RECOVERY_COOKIE,
  claimPasswordRecovery,
  PASSWORD_RECOVERY_LIFETIME_MS,
  requestPasswordRecovery,
  submitAuthenticatorResetRequest,
} from "@/lib/auth/recovery-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { requestSecurityContext } from "@/lib/auth/security-context"

export type AuthenticatorRecoveryRequestState = {
  error: string | null
  sent: boolean
}

export type AuthenticatorRecoveryApprovalState = {
  error: string | null
}

/** Where the recovery pass cookie lives; a delete must name the same path. */
const AUTHENTICATOR_RECOVERY_COOKIE_PATH = "/auth/two-factor/recovery"

async function securityContext() {
  return requestSecurityContext(await headers())
}

export async function requestAuthenticatorRecoveryAction(
  _previousState: AuthenticatorRecoveryRequestState,
  formData: FormData,
): Promise<AuthenticatorRecoveryRequestState> {
  await requestPasswordRecovery({
    academyId: String(formData.get("academyId") ?? ""),
    email: String(formData.get("email") ?? ""),
    intent: "authenticator",
    security: await securityContext(),
  })
  return { error: null, sent: true }
}

/**
 * The Continue button on the page the emailed link opens -- see
 * openPasswordRecoveryLinkAction in app/recover/actions.ts. This link opens
 * only the authenticator page; a password link opens nothing here.
 */
export async function openAuthenticatorRecoveryLinkAction(formData: FormData) {
  const token = String(formData.get("token") ?? "")
  const pass = claimPasswordRecovery(token, { intent: "authenticator" })
  if (!pass) redirect("/auth/two-factor/recovery?error=invalid")
  const cookieStore = await cookies()
  cookieStore.set(AUTHENTICATOR_RECOVERY_COOKIE, pass, {
    httpOnly: true,
    maxAge: PASSWORD_RECOVERY_LIFETIME_MS / 1_000,
    path: AUTHENTICATOR_RECOVERY_COOKIE_PATH,
    sameSite: "lax",
    secure: secureAuthCookiesRequired(),
  })
  redirect("/auth/two-factor/recovery?verified=1")
}

export async function submitAuthenticatorRecoveryApprovalAction(
  _previousState: AuthenticatorRecoveryApprovalState,
  _formData: FormData,
): Promise<AuthenticatorRecoveryApprovalState> {
  void _previousState
  void _formData
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTHENTICATOR_RECOVERY_COOKIE)?.value ?? ""
  const request = submitAuthenticatorResetRequest({
    security: await securityContext(),
    token,
  })
  if (!request) return { error: "This verified recovery session is invalid or expired." }
  cookieStore.delete({ name: AUTHENTICATOR_RECOVERY_COOKIE, path: AUTHENTICATOR_RECOVERY_COOKIE_PATH })
  redirect("/auth/two-factor/recovery?requested=1")
}
