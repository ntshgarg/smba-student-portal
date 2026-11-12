"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth/better-auth"
import { signInWithJustWrittenPassword } from "@/lib/auth/username-login-guard"
import {
  completeInitialHeadCoachSetup,
  HEAD_COACH_SETUP_COOKIE,
  HEAD_COACH_SETUP_NAME_COOKIE,
  type HeadCoachSetupField,
  headCoachSetupAvailable,
  validHeadCoachSetupToken,
  validateInitialHeadCoachSetup,
} from "@/lib/auth/initial-setup"
import {
  getVerifiedSetupRecoveryEmail,
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

  /*
   * The verified email has its own time limit (counted from verification). If
   * it has run out, say so and put the email step back on screen: answering
   * "verify the recovery email" while the page still showed it as verified
   * left the coach nothing to press but reload.
   */
  if (!getVerifiedSetupRecoveryEmail({
    receiptToken: input.recoveryEmailReceiptToken,
    subjectKey: input.recoveryEmailSubjectKey,
  })) {
    // The cookie is left alone: changing a cookie here re-renders the page,
    // which swaps this form for the email step and drops this message. On the
    // next load the page sees the email has run out and shows that step.
    return {
      error: "The email check ran out. Reload this page to verify the coach\u2019s email again.",
      errorField: null,
    }
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

  // The academy exists from here on and `headCoachSetupAvailable()` is false.
  // The sign-in is exempt from the login lockout because the password it
  // presents is the one just written (lib/auth/username-login-guard.ts), and a
  // refusal for any other reason is reported as a missing session rather than
  // as a failed setup, which is what it is.
  const requestHeaders = await headers()
  try {
    await signInWithJustWrittenPassword(() => getAuth().api.signInUsername({
      body: { password: input.password, username: account.academyId },
      headers: requestHeaders,
    }))
  } catch {
    // The one-time cookies are left in place on this path. They are spent --
    // the setup claim was consumed with the account -- so they open nothing,
    // but deleting them re-rendered this page as "setup unavailable" and hid
    // the one message the coach needed: the account is ready, go and sign in.
    return {
      error: "The head-coach account is ready, but we couldn\u2019t sign you in."
        + " Open the sign-in page and use your new password.",
      errorField: null,
    }
  }
  // These were set at Path=/setup/head-coach; a delete without the path would
  // target a different cookie and leave these (the name included) in place.
  for (const name of [HEAD_COACH_SETUP_COOKIE, HEAD_SETUP_EMAIL_COOKIE, HEAD_COACH_SETUP_NAME_COOKIE]) {
    cookieStore.delete({ name, path: "/setup/head-coach" })
  }
  redirect("/auth/two-factor/setup")
}
