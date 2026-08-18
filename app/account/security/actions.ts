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
  verifyCurrentPassword,
} from "@/lib/auth/credential-service"
import { approveRegistration, rejectRegistration } from "@/lib/auth/account-service"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { requestSecurityContext, writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { authRuntimeSessions } from "@/lib/db/schema"

export type PasswordChangeState = {
  error: string | null
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

export async function changePasswordAction(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const identity = await requireIdentity()
  const currentPassword = String(formData.get("currentPassword") ?? "")
  const newPassword = String(formData.get("newPassword") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")
  if (!currentPassword) return { error: "Enter your current password.", success: null }
  const passwordError = validateNewPassword(newPassword)
  if (passwordError) return { error: passwordError, success: null }
  if (newPassword !== confirmPassword) {
    return { error: "The new passwords do not match.", success: null }
  }

  const requestHeaders = await headers()
  try {
    await getAuth().api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: requestHeaders,
    })
  } catch {
    return { error: "The current password could not be verified.", success: null }
  }

  const security = requestSecurityContext(requestHeaders)
  writeAuthSecurityEvent({
    accountId: identity.subjectId,
    eventType: "password_changed",
    ipHash: security.ipHash,
    outcome: "success",
    userAgent: security.userAgent,
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
  if (!await verifyCurrentPassword({ accountId: identity.subjectId, password: currentPassword })) {
    return { error: "The current password could not be verified.", success: null }
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
  if (!await verifyCurrentPassword({ accountId: identity.subjectId, password: currentPassword })) {
    return { error: "The current password could not be verified.", success: null }
  }
  removePinCredential(identity.subjectId)
  revalidatePath("/account/security")
  return { error: null, success: "PIN login removed. Use your password to sign in." }
}

export async function approveJuniorCoachRequestAction(registrationId: string) {
  const identity = await requireIdentity()
  const access = getCoachAccessProfile(identity.subjectId)
  if (access?.accessLevel !== "head_admin") return { ok: false as const, message: "Head coach access is required." }
  try {
    const approved = approveRegistration(registrationId, identity.subjectId, { requestedRole: "coach" })
    revalidatePath("/account/security")
    return { ok: true as const, data: approved }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "The request could not be approved." }
  }
}

export async function rejectJuniorCoachRequestAction(registrationId: string) {
  const identity = await requireIdentity()
  const access = getCoachAccessProfile(identity.subjectId)
  if (access?.accessLevel !== "head_admin") return { ok: false as const, message: "Head coach access is required." }
  try {
    rejectRegistration(registrationId, identity.subjectId)
    revalidatePath("/account/security")
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "The request could not be rejected." }
  }
}
