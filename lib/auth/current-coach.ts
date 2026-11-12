import "server-only"

import { redirect } from "next/navigation"
import { cache } from "react"

import { SessionExpiredError } from "@/lib/actions/operational-result"
import {
  getCoachAccessProfile,
  requireHeadAdminAccess,
  type CoachAccessProfile,
} from "@/lib/auth/coach-access"
import type { SessionIdentity } from "@/lib/auth/identity"
import { sessionProvider } from "@/lib/data"
import { ensureDueTrainingChangesApplied } from "@/lib/training/changes"

const getRequestIdentity = cache(() => sessionProvider.getCurrentIdentity())
const getRequestCoachAccess = cache((coachId: string) => getCoachAccessProfile(coachId))

export type CurrentCoachContext = {
  access: CoachAccessProfile
  identity: SessionIdentity
}

// Both refusals still throw, so nothing downstream can run without a coach.
// What changes is which one the caller is holding: the sentence below is a
// verdict on the coach and repeating the request cannot change it, while an
// expired session is not about the coach at all and signing in again clears it.
// Only a missing identity can be an expiry -- a present one that is not a coach
// is a genuine refusal -- and the session is only read to tell those apart.
//
// One live session is refused the identity yet cleared the same way: a head
// coach whose authenticator was switched off by a reconnect started in another
// tab. Signing in again routes them to the authenticator step they owe, so it
// is treated as the expiry it behaves like. Telling that coach they lacked
// head-coach access sent them looking for a permission they already had.
//
// That check is loaded only when it is needed. `lib/auth/session` brings in
// Better Auth and the database client, and every page and action that imports
// this module would otherwise pay for both just to reach the common case.
async function liveSessionOwesAuthenticatorSetup() {
  const { sessionOwesAuthenticatorSetup } = await import("@/lib/auth/session")
  return sessionOwesAuthenticatorSetup()
}

export async function requireHeadAdminAction() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity && (
    !(await sessionProvider.hasActiveSession()) || await liveSessionOwesAuthenticatorSetup()
  )) {
    throw new SessionExpiredError()
  }
  if (!identity || identity.role !== "coach") throw new Error("Head coach access is required.")
  requireHeadAdminAccess(identity.subjectId)
  if (!identity.previewMode) ensureDueTrainingChangesApplied()
  return identity
}

export async function requireCoachPage() {
  const identity = await getRequestIdentity()
  if (!identity) redirect("/login")
  if (identity.role !== "coach") redirect("/player")
  const access = getRequestCoachAccess(identity.subjectId)
  if (!access) redirect("/login")
  // Training changes scheduled for the 1st take effect on the first request on
  // or after that day (lib/training/changes.ts). An admin preview only looks.
  if (!identity.previewMode) ensureDueTrainingChangesApplied()
  return { access, identity }
}

// A refusal that only changes the address bar is indistinguishable from a
// mis-click: the assistant coach asked for a page, landed on their dashboard, and
// nothing said why. The destination is told to explain the refusal instead.
export const HEAD_COACH_ONLY_NOTICE = "head-coach-only"

export async function requireHeadAdminPage() {
  const context = await requireCoachPage()
  if (context.access.accessLevel !== "head_admin") {
    redirect(`/coach?notice=${HEAD_COACH_ONLY_NOTICE}`)
  }
  return context
}
