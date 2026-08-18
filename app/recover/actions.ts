"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  completePasswordRecovery,
  RECOVERY_SESSION_COOKIE,
  requestPasswordRecovery,
  verifyPasswordRecoverySecondFactor,
} from "@/lib/auth/recovery-service"
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
  cookieStore.delete(RECOVERY_SESSION_COOKIE)
  redirect("/login?recovered=1")
}
