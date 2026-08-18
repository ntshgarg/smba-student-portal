"use server"

import { and, eq, isNull } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/lib/auth/better-auth"
import { getRawAuthSession } from "@/lib/auth/session"
import { requestSecurityContext, writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { accounts } from "@/lib/db/schema"
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
  if (account?.role !== "coach" && account?.role !== "platform_admin") redirect("/player")
  return rawSession
}

export async function startTotpSetup(
  _previousState: TotpSetupState,
  formData: FormData,
): Promise<TotpSetupState> {
  const rawSession = await requireProtectedSetupSession()
  if (rawSession.user.twoFactorEnabled) redirect(destinationForUser(rawSession.user.id))
  const password = String(formData.get("password") ?? "")
  if (!password) return { error: "Enter your password to continue.", setup: null }

  try {
    const response = await auth.api.enableTwoFactor({
      body: { issuer: "Sathiya Moorthy Badminton Academy", password },
      headers: await headers(),
    })
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
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  if (!/^\d{6}$/u.test(code)) return { error: "Enter the six-digit code from your authenticator app." }
  const requestHeaders = await headers()

  try {
    await auth.api.verifyTOTP({ body: { code, trustDevice: true }, headers: requestHeaders })
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

export async function verifyTotpSignIn(
  _previousState: TotpVerificationState,
  formData: FormData,
): Promise<TotpVerificationState> {
  const code = String(formData.get("code") ?? "").replace(/\s+/gu, "")
  if (!/^\d{6}$/u.test(code)) return { error: "Enter the six-digit code from your authenticator app." }
  const requestHeaders = await headers()
  try {
    const response = await auth.api.verifyTOTP({
      body: { code, trustDevice: formData.get("trustDevice") === "on" },
      headers: requestHeaders,
    })
    const security = requestSecurityContext(requestHeaders)
    writeAuthSecurityEvent({
      accountId: response.user.id,
      eventType: "totp_verified",
      ipHash: security.ipHash,
      outcome: "success",
      userAgent: security.userAgent,
    })
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    // Next.js redirects are intentionally thrown; do not turn a successful
    // verification into an error message.
    if (error && typeof error === "object" && "digest" in error) throw error
    return { error: "That code was not accepted. Wait for a new code and try again." }
  }
}

export async function verifyBackupCodeSignIn(
  _previousState: TotpVerificationState,
  formData: FormData,
): Promise<TotpVerificationState> {
  const code = String(formData.get("backupCode") ?? "").trim()
  if (!code) return { error: "Enter one of your unused recovery codes." }
  const requestHeaders = await headers()
  try {
    const response = await auth.api.verifyBackupCode({
      body: { code, trustDevice: false },
      headers: requestHeaders,
    })
    redirect(destinationForUser(response.user.id))
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error
    return { error: "That recovery code was not accepted." }
  }
}
