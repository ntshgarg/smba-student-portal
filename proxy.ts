import { and, eq, gt, isNull } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

import {
  ADMIN_PREVIEW_COOKIE,
  AUTH_SESSION_COOKIE_NAMES,
  readLiveAdminPreviewClaim,
  sessionTokenFromCookieValue,
} from "@/lib/auth/admin-preview"
import { accounts, authCredentialStates, authRuntimeSessions } from "@/lib/db/schema"
import { CLIENT_ERROR_REPORT_ENDPOINT } from "@/lib/telemetry/error-report"

function livePreview(request: NextRequest) {
  const sessionToken = sessionTokenFromCookieValue(AUTH_SESSION_COOKIE_NAMES
    .map((name) => request.cookies.get(name)?.value)
    .find(Boolean))
  const claim = readLiveAdminPreviewClaim(request.cookies.get(ADMIN_PREVIEW_COOKIE)?.value, sessionToken)
  return claim && sessionToken ? { claim, sessionToken } : null
}

// The cookies can outlive what they were for: the owner's sign-in row deleted
// (Log out other devices) or the viewed person archived. Then nothing is being
// previewed, so nothing should be refused. Asked only when a form is about to
// be refused; if the lookup itself fails the preview stays read-only.
async function previewIsShowing({ claim, sessionToken }: NonNullable<ReturnType<typeof livePreview>>) {
  try {
    const { initializeDatabase } = await import("@/lib/db/client")
    const database = initializeDatabase()
    const signedIn = database.select({ id: authRuntimeSessions.id }).from(authRuntimeSessions)
      .where(and(eq(authRuntimeSessions.token, sessionToken), gt(authRuntimeSessions.expiresAt, new Date())))
      .get()
    const viewed = database.select({ id: accounts.id }).from(accounts)
      .innerJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
      .where(and(
        eq(accounts.id, claim.targetAccountId),
        eq(accounts.approvalStatus, "approved"),
        isNull(accounts.archivedAt),
        eq(authCredentialStates.status, "active"),
      ))
      .get()
    return Boolean(signedIn && viewed)
  } catch {
    return true
  }
}

function withoutPreviewCookie() {
  const response = NextResponse.next()
  response.cookies.delete(ADMIN_PREVIEW_COOKIE)
  return response
}

export async function proxy(request: NextRequest) {
  if (!request.cookies.has(ADMIN_PREVIEW_COOKIE)) return NextResponse.next()

  // A preview cookie that no longer matches this browser's sign-in (signed out,
  // expired, someone else signed in) is a leftover: clear it, don't block forms.
  const live = livePreview(request)
  if (!live) return withoutPreviewCookie()

  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method)
  const isPreviewExit = request.method === "POST"
    && request.nextUrl.pathname === "/admin/preview/exit"
  // Preview is read-only for academy records, not for operational telemetry.
  // Server request errors are already recorded during preview because
  // instrumentation.ts never passes through here, and a preview session is
  // exactly when an operator most wants to see what broke.
  const isErrorReport = request.method === "POST"
    && request.nextUrl.pathname === CLIENT_ERROR_REPORT_ENDPOINT
  if (!isMutation || isPreviewExit || isErrorReport) return NextResponse.next()
  if (!await previewIsShowing(live)) return withoutPreviewCookie()

  return NextResponse.json(
    { error: "Admin preview is read-only. Exit preview before making changes." },
    { status: 403 },
  )
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
