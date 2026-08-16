import "server-only"

import { redirect } from "next/navigation"
import { cache } from "react"

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

export async function getCurrentCoachContext(): Promise<CurrentCoachContext | null> {
  const identity = await getRequestIdentity()
  if (!identity || identity.role !== "coach") return null
  const access = getRequestCoachAccess(identity.subjectId)
  return access ? { access, identity } : null
}

export async function requireHeadAdminAction() {
  const identity = await sessionProvider.getCurrentIdentity()
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

export async function requireHeadAdminPage() {
  const context = await requireCoachPage()
  if (context.access.accessLevel !== "head_admin") redirect("/coach")
  return context
}
