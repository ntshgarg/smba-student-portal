import { and, eq, isNull } from "drizzle-orm"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { ADMIN_PREVIEW_COOKIE, readAdminPreviewRecord } from "@/lib/auth/admin-preview"
import { clearDatabaseSession, getRawAuthSession } from "@/lib/auth/session"
import { writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { publicSiteUrl } from "@/lib/config"
import { initializeDatabase } from "@/lib/db/client"
import { accounts } from "@/lib/db/schema"

/*
 * The one door out of a preview, and so also where Log out goes while one is
 * open: every other form is switched off by the proxy, including the ordinary
 * Log out, which used to end on an error page with the owner still signed in.
 * `signOut` ends the preview and then the owner's sign-in.
 */
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
  // Read for the record only, so an Exit pressed after the hour ran out still
  // names the person who was being viewed.
  const claim = owner && actorAccountId
    ? readAdminPreviewRecord((await cookies()).get(ADMIN_PREVIEW_COOKIE)?.value, actorAccountId)
    : null
  if (owner && actorAccountId) {
    // Filed under the person who was being viewed, beside the start record.
    writeAuthSecurityEvent({
      accountId: claim?.targetAccountId ?? actorAccountId,
      actorAccountId,
      eventType: "admin_preview_stopped",
      metadata: signOut ? { signedOut: true } : undefined,
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
