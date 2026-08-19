"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  AUTHENTICATOR_RECOVERY_COOKIE,
  requestPasswordRecovery,
  submitAuthenticatorResetRequest,
} from "@/lib/auth/recovery-service"
import { requestSecurityContext } from "@/lib/auth/security-context"

export type AuthenticatorRecoveryRequestState = {
  error: string | null
  sent: boolean
}

export type AuthenticatorRecoveryApprovalState = {
  error: string | null
}

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
  cookieStore.delete(AUTHENTICATOR_RECOVERY_COOKIE)
  redirect("/auth/two-factor/recovery?requested=1")
}
