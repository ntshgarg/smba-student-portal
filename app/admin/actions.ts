"use server"

import { and, eq, isNull } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { ADMIN_PREVIEW_COOKIE, createAdminPreviewToken } from "@/lib/auth/admin-preview"
import { getRawAuthSession } from "@/lib/auth/session"
import {
  HEAD_COACH_SETUP_COOKIE,
  headCoachSetupAvailable,
  headCoachSetupTokenForTrustedServerAction,
} from "@/lib/auth/initial-setup"
import { writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { accounts, authCredentialStates, authUsers } from "@/lib/db/schema"

async function requirePlatformOwner() {
  const rawSession = await getRawAuthSession()
  if (!rawSession?.user?.id || !rawSession.user.twoFactorEnabled) redirect("/login")
  const owner = initializeDatabase().select({ role: accounts.role })
    .from(accounts)
    .innerJoin(authUsers, eq(authUsers.id, accounts.id))
    .where(and(
      eq(accounts.id, rawSession.user.id),
      eq(accounts.role, "platform_admin"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
  if (!owner) redirect("/login")
  return rawSession.user.id
}

export async function startAdminPreviewAction(formData: FormData) {
  const actorAccountId = await requirePlatformOwner()
  const targetAccountId = String(formData.get("targetAccountId") ?? "")
  const target = initializeDatabase().select({ role: accounts.role })
    .from(accounts)
    .innerJoin(authCredentialStates, and(
      eq(authCredentialStates.accountId, accounts.id),
      eq(authCredentialStates.status, "active"),
    ))
    .where(and(
      eq(accounts.id, targetAccountId),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
  if (target?.role !== "coach" && target?.role !== "player") redirect("/admin")

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_PREVIEW_COOKIE, createAdminPreviewToken({
    actorAccountId,
    targetAccountId,
  }), {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/",
    sameSite: "strict",
    secure: process.env.VERCEL === "1",
  })
  writeAuthSecurityEvent({
    accountId: targetAccountId,
    actorAccountId,
    eventType: "admin_preview_started",
    outcome: "success",
  })
  redirect(target.role === "coach" ? "/coach" : "/player")
}

export async function openHeadCoachSetupAction() {
  await requirePlatformOwner()
  if (!headCoachSetupAvailable()) redirect("/admin")
  const cookieStore = await cookies()
  cookieStore.set(HEAD_COACH_SETUP_COOKIE, headCoachSetupTokenForTrustedServerAction(), {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/setup/head-coach",
    sameSite: "strict",
    secure: process.env.VERCEL === "1",
  })
  redirect("/setup/head-coach")
}
