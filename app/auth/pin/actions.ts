"use server"

import { redirect } from "next/navigation"

import { sessionProvider } from "@/lib/data"
import { hasPinCredential, setPinCredential, validatePin } from "@/lib/auth/credential-service"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"

export type PinSetupState = {
  error: string | null
  errorField: "pin" | "confirmPin" | null
}

function destination(role: "coach" | "platform_admin" | "player") {
  if (role === "platform_admin") return "/admin"
  return role === "coach" ? "/coach" : "/player"
}

export async function setupPinAction(
  _previousState: PinSetupState,
  formData: FormData,
): Promise<PinSetupState> {
  // A server action is a public endpoint: it re-states every precondition
  // /auth/pin/setup checks before it renders this form, because the action id is
  // a build-time constant in the public client chunk and is reachable without
  // ever loading that page.
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  if (hasPinCredential(identity.subjectId)) {
    // Replacing an existing PIN is a step-up operation: savePinAction in
    // app/account/security/actions.ts gates it on the current password. This
    // action only ever performs first-time (or post-recovery) setup.
    redirect(destination(identity.role))
  }
  const pin = String(formData.get("pin") ?? "")
  const confirmPin = String(formData.get("confirmPin") ?? "")
  const pinError = validatePin(pin)
  if (pinError) return { error: pinError, errorField: "pin" }
  if (pin !== confirmPin) {
    return { error: "The PINs do not match.", errorField: "confirmPin" }
  }
  try {
    await setPinCredential({ accountId: identity.subjectId, pin })
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "PIN setup could not be completed.",
      errorField: null,
    }
  }
  redirect(destination(identity.role))
}

export async function skipPinSetupAction() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  const access = identity.role === "coach" ? getCoachAccessProfile(identity.subjectId) : null
  if (identity.role === "platform_admin" || access?.accessLevel === "head_admin") {
    redirect("/auth/pin/setup")
  }
  redirect(destination(identity.role))
}
