import { and, eq, isNull } from "drizzle-orm"
import { NextResponse } from "next/server"

import { ADMIN_PREVIEW_COOKIE } from "@/lib/auth/admin-preview"
import { getRawAuthSession } from "@/lib/auth/session"
import { writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import { accounts } from "@/lib/db/schema"

export async function GET(request: Request) {
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
  const response = NextResponse.redirect(new URL(owner ? "/admin" : "/login", request.url))
  response.cookies.delete(ADMIN_PREVIEW_COOKIE)
  if (owner) {
    writeAuthSecurityEvent({
      accountId: actorAccountId,
      actorAccountId,
      eventType: "admin_preview_stopped",
      outcome: "success",
    })
  }
  return response
}
