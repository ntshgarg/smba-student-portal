"use server"

import { redirect } from "next/navigation"

import {
  isAcademyId,
  normalizeAcademyId,
  normalizeFullName,
} from "@/lib/auth/identity"
import {
  findApprovedAccountByAcademyId,
  prototypeAcademyIdAuthEnabled,
  registerPublicPlayerRequest,
} from "@/lib/auth/account-service"
import { OperationalActionError } from "@/lib/actions/operational-result"
import { clearDatabaseSession, createDatabaseSession } from "@/lib/auth/session"
import { publicSiteUrl } from "@/lib/config"

export type LoginFormState = {
  error: string | null
}

export type RegistrationFormState = {
  error: string | null
  errorField: "fullName" | null
  submitted: boolean
}

export async function loginWithAcademyId(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  if (!prototypeAcademyIdAuthEnabled()) {
    return { error: "Prototype Academy ID access is disabled." }
  }

  const academyId = normalizeAcademyId(String(formData.get("academyId") ?? ""))
  if (!isAcademyId(academyId)) {
    return { error: "Enter an Academy ID in the format SMBA#0001." }
  }

  const account = findApprovedAccountByAcademyId(academyId)
  if (!account?.role) {
    return { error: "We couldn’t find an approved account with that Academy ID." }
  }

  await createDatabaseSession(account.accountId)
  redirect(account.role === "coach" ? "/coach" : "/player")
}

export async function submitRegistration(
  _previousState: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  if (!prototypeAcademyIdAuthEnabled()) {
    return { error: "Prototype registration is disabled.", errorField: null, submitted: false }
  }

  const fullName = normalizeFullName(String(formData.get("fullName") ?? ""))
  const registrationRequestKey = String(formData.get("registrationRequestKey") ?? "")

  if (fullName.length < 2) {
    return { error: "Enter your full name.", errorField: "fullName", submitted: false }
  }
  if (fullName.length > 80) {
    return {
      error: "Keep your name to 80 characters or fewer.",
      errorField: "fullName",
      submitted: false,
    }
  }

  try {
    registerPublicPlayerRequest({ fullName, requestKey: registrationRequestKey })
    return { error: null, errorField: null, submitted: true }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return {
        error: error.message,
        errorField: error.field === "fullName" ? "fullName" : null,
        submitted: false,
      }
    }
    throw error
  }
}

export async function clearSession() {
  await clearDatabaseSession()
  redirect(publicSiteUrl)
}
