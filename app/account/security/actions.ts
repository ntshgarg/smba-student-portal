"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { getAuth } from "@/lib/auth/better-auth"
import {
  hasPinCredential,
  removePinCredential,
  setPinCredential,
  validatePin,
  validateNewPassword,
  verifyCurrentPasswordAttempt,
} from "@/lib/auth/credential-service"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { requestSecurityContext, writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { authRuntimeSessions } from "@/lib/db/schema"

/** Which input an error belongs to, so the form can flag and focus it. */
export type PasswordChangeField = "currentPassword" | "newPassword" | "confirmPassword"

export type PasswordChangeState = {
  error: string | null
  errorField?: PasswordChangeField | null
  success: string | null
}

export type PinManagementState = {
  error: string | null
  success: string | null
}

async function requireIdentity() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) throw new Error("Authentication is required.")
  return identity
}

async function confirmCurrentPassword(input: {
  academyId: string
  accountId: string
  operation: string
  password: string
}) {
  const requestHeaders = await headers()
  const security = requestSecurityContext(requestHeaders)
  const result = await verifyCurrentPasswordAttempt({
    ...input,
    ipHash: security.ipHash,
    userAgent: security.userAgent,
  })
  return { requestHeaders, result, security }
}

function currentPasswordError(result: "blocked" | "invalid" | "verified") {
  return result === "blocked"
    ? "Too many attempts. Wait a few minutes before trying again."
    : "The current password could not be verified."
}

export async function changePasswordAction(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const identity = await requireIdentity()
  const currentPassword = String(formData.get("currentPassword") ?? "")
  const newPassword = String(formData.get("newPassword") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")
  if (!currentPassword) {
    return { error: "Enter your current password.", errorField: "currentPassword", success: null }
  }
  const passwordError = validateNewPassword(newPassword)
  if (passwordError) return { error: passwordError, errorField: "newPassword", success: null }
  if (newPassword !== confirmPassword) {
    return {
      error: "The new passwords do not match.",
      errorField: "confirmPassword",
      success: null,
    }
  }

  const confirmation = await confirmCurrentPassword({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    operation: "change_password",
    password: currentPassword,
  })
  if (confirmation.result !== "verified") {
    return {
      error: currentPasswordError(confirmation.result),
      errorField: "currentPassword",
      success: null,
    }
  }
  try {
    await getAuth().api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: confirmation.requestHeaders,
    })
  } catch {
    return {
      error: "The current password could not be verified.",
      errorField: "currentPassword",
      success: null,
    }
  }

  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    eventType: "password_changed",
    ipHash: confirmation.security.ipHash,
    outcome: "success",
    userAgent: confirmation.security.userAgent,
  })
  revalidatePath("/account/security")
  return { error: null, success: "Password changed. Other signed-in devices were logged out." }
}

export async function revokeOtherSessionsAction() {
  const identity = await requireIdentity()
  const requestHeaders = await headers()
  await getAuth().api.revokeOtherSessions({ headers: requestHeaders })
  const security = requestSecurityContext(requestHeaders)
  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    actorAccountId: identity.subjectId,
    eventType: "sessions_revoked",
    ipHash: security.ipHash,
    metadata: { scope: "other_devices" },
    outcome: "success",
    userAgent: security.userAgent,
  })
  revalidatePath("/account/security")
}

export async function revokeSessionAction(sessionId: string) {
  const identity = await requireIdentity()
  if (typeof sessionId !== "string" || !sessionId.trim()) return
  const database = initializeDatabase()
  database.delete(authRuntimeSessions).where(and(
    eq(authRuntimeSessions.id, sessionId),
    eq(authRuntimeSessions.userId, identity.subjectId),
  )).run()
  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    actorAccountId: identity.subjectId,
    eventType: "sessions_revoked",
    metadata: { scope: "one_device" },
    outcome: "success",
  })
  revalidatePath("/account/security")
}

export async function savePinAction(
  _previousState: PinManagementState,
  formData: FormData,
): Promise<PinManagementState> {
  const identity = await requireIdentity()
  const currentPassword = String(formData.get("currentPassword") ?? "")
  const pin = String(formData.get("pin") ?? "")
  const confirmPin = String(formData.get("confirmPin") ?? "")
  if (!currentPassword) {
    return { error: "Enter your current password.", success: null }
  }
  if (!pin) return { error: "Enter a new 6-digit PIN.", success: null }
  if (!confirmPin) return { error: "Confirm the new PIN.", success: null }
  const confirmation = await confirmCurrentPassword({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    operation: "save_pin",
    password: currentPassword,
  })
  if (confirmation.result !== "verified") {
    return { error: currentPasswordError(confirmation.result), success: null }
  }
  const pinError = validatePin(pin)
  if (pinError) return { error: pinError, success: null }
  if (pin !== confirmPin) return { error: "The PINs do not match.", success: null }
  const existing = hasPinCredential(identity.subjectId)
  try {
    await setPinCredential({ accountId: identity.subjectId, pin })
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The PIN could not be saved.",
      success: null,
    }
  }
  revalidatePath("/account/security")
  return { error: null, success: existing ? "PIN changed." : "PIN login enabled." }
}

export async function removePinAction(
  _previousState: PinManagementState,
  formData: FormData,
): Promise<PinManagementState> {
  const identity = await requireIdentity()
  if (identity.role === "platform_admin") {
    return { error: "The platform-owner account requires a PIN.", success: null }
  }
  if (identity.role === "coach"
    && getCoachAccessProfile(identity.subjectId)?.accessLevel === "head_admin") {
    return { error: "The head-coach account requires a PIN.", success: null }
  }
  const currentPassword = String(formData.get("currentPassword") ?? "")
  if (!currentPassword) {
    return { error: "Enter your current password.", success: null }
  }
  const confirmation = await confirmCurrentPassword({
    academyId: identity.academyId,
    accountId: identity.subjectId,
    operation: "remove_pin",
    password: currentPassword,
  })
  if (confirmation.result !== "verified") {
    return { error: currentPasswordError(confirmation.result), success: null }
  }
  removePinCredential(identity.subjectId)
  revalidatePath("/account/security")
  return { error: null, success: "PIN login removed. Use your password to sign in." }
}
