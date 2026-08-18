"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth/better-auth"
import {
  completeInitialHeadCoachSetup,
  HEAD_COACH_SETUP_COOKIE,
  headCoachSetupAvailable,
  validHeadCoachSetupToken,
  validateInitialHeadCoachSetup,
} from "@/lib/auth/initial-setup"
import {
  HEAD_SETUP_EMAIL_COOKIE,
  recoverySubjectKeyForHeadSetup,
} from "@/lib/auth/recovery-service"

export type HeadCoachSetupState = {
  error: string | null
}

export async function completeHeadCoachSetupAction(
  _previousState: HeadCoachSetupState,
  formData: FormData,
): Promise<HeadCoachSetupState> {
  const cookieStore = await cookies()
  const setupToken = cookieStore.get(HEAD_COACH_SETUP_COOKIE)?.value
  if (!validHeadCoachSetupToken(setupToken) || !headCoachSetupAvailable()) {
    return { error: "This one-time setup session is unavailable or has already been used." }
  }
  const input = {
    fullName: String(formData.get("fullName") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    pin: String(formData.get("pin") ?? ""),
    confirmPin: String(formData.get("confirmPin") ?? ""),
    recoveryEmailReceiptToken: cookieStore.get(HEAD_SETUP_EMAIL_COOKIE)?.value ?? "",
    recoveryEmailSubjectKey: recoverySubjectKeyForHeadSetup(setupToken!),
  }
  const validationError = validateInitialHeadCoachSetup(input)
  if (validationError) return { error: validationError }

  try {
    const account = await completeInitialHeadCoachSetup(input)
    await getAuth().api.signInUsername({
      body: { password: input.password, username: account.academyId },
      headers: await headers(),
    })
    cookieStore.delete(HEAD_COACH_SETUP_COOKIE)
    cookieStore.delete(HEAD_SETUP_EMAIL_COOKIE)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The head-coach account could not be created.",
    }
  }
  redirect("/auth/two-factor/setup")
}
