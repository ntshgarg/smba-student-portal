import { and, eq, isNull } from "drizzle-orm"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { ADMIN_PREVIEW_COOKIE, readAdminPreviewToken } from "@/lib/auth/admin-preview"
import { clearDatabaseSession, getRawAuthSession } from "@/lib/auth/session"
import { writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { publicSiteUrl } from "@/lib/config"
import { initializeDatabase } from "@/lib/db/client"
import { accounts } from "@/lib/db/schema"

// The one form a preview allows, so Log out during a preview comes here with signOut=1.
export async function POST(request: Request) {
  const signOut = await request.formData()
    .then((form) => form.get("signOut") === "1")
    .catch(() => false)
  const rawSession = await getRawAuthSession()
  const actorAccountId = rawSession?.user?.id
  const owner = actorAccountId
    ? initializeDatabase().select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.id, actorAccountId),
      eq(accounts.role, "platform_admin"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).get()
    : null
  if (owner && actorAccountId) {
    const claim = readAdminPreviewToken(
      (await cookies()).get(ADMIN_PREVIEW_COOKIE)?.value,
      actorAccountId,
      rawSession?.session?.token,
    )
    // Filed under the person viewed, beside the start record.
    writeAuthSecurityEvent({
      accountId: claim?.targetAccountId ?? actorAccountId,
      actorAccountId,
      eventType: "admin_preview_stopped",
      outcome: "success",
    })
  }
  if (signOut) await clearDatabaseSession()
  const response = NextResponse.redirect(
    new URL(signOut ? publicSiteUrl : owner ? "/admin" : "/login", request.url),
    303,
  )
  response.cookies.delete(ADMIN_PREVIEW_COOKIE)
  return response
}
