"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/lib/auth/better-auth"
import {
  completeInitialPlatformAdminSetup,
  PLATFORM_ADMIN_SETUP_COOKIE,
  platformAdminSetupAvailable,
  validPlatformAdminSetupToken,
  validateInitialPlatformAdminSetup,
} from "@/lib/auth/initial-setup"

export type PlatformAdminSetupState = {
  error: string | null
}

export async function completePlatformAdminSetupAction(
  _previousState: PlatformAdminSetupState,
  formData: FormData,
): Promise<PlatformAdminSetupState> {
  const cookieStore = await cookies()
  const setupToken = cookieStore.get(PLATFORM_ADMIN_SETUP_COOKIE)?.value
  if (!validPlatformAdminSetupToken(setupToken) || !platformAdminSetupAvailable()) {
    return { error: "This one-time setup session is unavailable or has already been used." }
  }
  const input = {
    fullName: String(formData.get("fullName") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    pin: String(formData.get("pin") ?? ""),
    confirmPin: String(formData.get("confirmPin") ?? ""),
  }
  const validationError = validateInitialPlatformAdminSetup(input)
  if (validationError) return { error: validationError }

  try {
    const account = await completeInitialPlatformAdminSetup(input)
    await auth.api.signInUsername({
      body: { password: input.password, username: account.academyId },
      headers: await headers(),
    })
    cookieStore.delete(PLATFORM_ADMIN_SETUP_COOKIE)
  } catch (error) {
    return {
      error: error instanceof Error
        ? error.message
        : "The platform-owner account could not be created.",
    }
  }
  redirect("/auth/two-factor/setup")
}
