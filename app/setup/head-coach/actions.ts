"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth/better-auth"
import { signInWithJustWrittenPassword } from "@/lib/auth/username-login-guard"
import {
  completeInitialHeadCoachSetup,
  HEAD_COACH_SETUP_COOKIE,
  type HeadCoachSetupField,
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
  errorField: HeadCoachSetupField | null
}

export async function completeHeadCoachSetupAction(
  _previousState: HeadCoachSetupState,
  formData: FormData,
): Promise<HeadCoachSetupState> {
  const cookieStore = await cookies()
  const setupToken = cookieStore.get(HEAD_COACH_SETUP_COOKIE)?.value
  if (!validHeadCoachSetupToken(setupToken) || !headCoachSetupAvailable()) {
    return {
      error: "This one-time setup session is unavailable or has already been used.",
      errorField: null,
    }
  }
  const input = {
    fullName: String(formData.get("fullName") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    pin: String(formData.get("pin") ?? ""),
    confirmPin: String(formData.get("confirmPin") ?? ""),
    recoveryEmailReceiptToken: cookieStore.get(HEAD_SETUP_EMAIL_COOKIE)?.value ?? "",
    recoveryEmailSubjectKey: recoverySubjectKeyForHeadSetup(setupToken!),
    setupToken: setupToken!,
  }
  const validationError = validateInitialHeadCoachSetup(input)
  if (validationError) {
    return { error: validationError.message, errorField: validationError.field }
  }

  let account: Awaited<ReturnType<typeof completeInitialHeadCoachSetup>>
  try {
    account = await completeInitialHeadCoachSetup(input)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The head-coach account could not be created.",
      errorField: null,
    }
  }

  // The academy exists from here on and `headCoachSetupAvailable()` is false, so
  // both one-time cookies are spent whatever the sign-in does; keeping them only
  // leaves a dead token in the browser and a second attempt that can only answer
  // "already used". The sign-in itself is exempt from the login lockout because
  // the password it presents is the one just written (lib/auth/username-login-guard.ts),
  // and a refusal for any other reason is reported as a missing session rather
  // than as a failed setup, which is what it is.
  cookieStore.delete(HEAD_COACH_SETUP_COOKIE)
  cookieStore.delete(HEAD_SETUP_EMAIL_COOKIE)
  const requestHeaders = await headers()
  try {
    await signInWithJustWrittenPassword(() => getAuth().api.signInUsername({
      body: { password: input.password, username: account.academyId },
      headers: requestHeaders,
    }))
  } catch {
    return {
      error: "The head-coach account is ready, but we couldn\u2019t sign you in."
        + " Open the sign-in page and use your new password.",
      errorField: null,
    }
  }
  redirect("/auth/two-factor/setup")
}
