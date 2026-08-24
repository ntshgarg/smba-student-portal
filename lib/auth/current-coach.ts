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
export async function requireHeadAdminAction() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity && !(await sessionProvider.hasActiveSession())) throw new SessionExpiredError()
  if (!identity || identity.role !== "coach") throw new Error("Head coach access is required.")
  requireHeadAdminAccess(identity.subjectId)
  return identity
}

export async function requireCoachPage() {
  const identity = await getRequestIdentity()
  if (!identity) redirect("/login")
  if (identity.role !== "coach") redirect("/player")
  const access = getRequestCoachAccess(identity.subjectId)
  if (!access) redirect("/login")
  return { access, identity }
}

// A refusal that only changes the address bar is indistinguishable from a
// mis-click: the junior coach asked for a page, landed on their dashboard, and
// nothing said why. The destination is told to explain the refusal instead.
export const HEAD_COACH_ONLY_NOTICE = "head-coach-only"

export async function requireHeadAdminPage() {
  const context = await requireCoachPage()
  if (context.access.accessLevel !== "head_admin") {
    redirect(`/coach?notice=${HEAD_COACH_ONLY_NOTICE}`)
  }
  return context
}
