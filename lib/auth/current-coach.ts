import "server-only"

import { redirect } from "next/navigation"

import {
  getCoachAccessProfile,
  requireHeadAdminAccess,
  type CoachAccessProfile,
} from "@/lib/auth/coach-access"
import type { SessionIdentity } from "@/lib/auth/identity"
import { sessionProvider } from "@/lib/data"

export type CurrentCoachContext = {
  access: CoachAccessProfile
  identity: SessionIdentity
}

export async function getCurrentCoachContext(): Promise<CurrentCoachContext | null> {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "coach") return null
  const access = getCoachAccessProfile(identity.subjectId)
  return access ? { access, identity } : null
}

export async function requireHeadAdminAction() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "coach") throw new Error("Head coach access is required.")
  requireHeadAdminAccess(identity.subjectId)
  return identity
}

export async function requireCoachPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.role !== "coach") redirect("/player")
  const access = getCoachAccessProfile(identity.subjectId)
  if (!access) redirect("/login")
  return { access, identity }
}

export async function requireHeadAdminPage() {
  const context = await requireCoachPage()
  if (context.access.accessLevel !== "head_admin") redirect("/coach")
  return context
}
