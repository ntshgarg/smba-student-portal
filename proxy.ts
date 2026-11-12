import { NextRequest, NextResponse } from "next/server"

import {
  ADMIN_PREVIEW_COOKIE,
  AUTH_SESSION_COOKIE_NAMES,
  readLiveAdminPreviewClaim,
  sessionTokenFromCookieValue,
} from "@/lib/auth/admin-preview"
import { CLIENT_ERROR_REPORT_ENDPOINT } from "@/lib/telemetry/error-report"

function previewIsLive(request: NextRequest) {
  const sessionCookie = AUTH_SESSION_COOKIE_NAMES
    .map((name) => request.cookies.get(name)?.value)
    .find(Boolean)
  try {
    return Boolean(readLiveAdminPreviewClaim(
      request.cookies.get(ADMIN_PREVIEW_COOKIE)?.value,
      sessionTokenFromCookieValue(sessionCookie),
    ))
  } catch {
    // The signing secret could not be read. Keep changes switched off rather
    // than guess: a preview must never be able to write.
    return true
  }
}

export function proxy(request: NextRequest) {
  if (!request.cookies.has(ADMIN_PREVIEW_COOKIE)) return NextResponse.next()

  // A preview cookie that no longer belongs to this browser's sign-in -- the
  // owner signed out, the hour ran out, someone else signed in -- is left over,
  // not a preview. Clear it and let the request through, or it would block
  // every form here (signing in included) with no Exit preview on screen.
  if (!previewIsLive(request)) {
    const response = NextResponse.next()
    response.cookies.delete(ADMIN_PREVIEW_COOKIE)
    return response
  }

  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method)
  const isPreviewExit = request.method === "POST"
    && request.nextUrl.pathname === "/admin/preview/exit"
  // Preview is read-only for academy records, not for operational telemetry.
  // Server request errors are already recorded during preview because
  // instrumentation.ts never passes through here, and a preview session is
  // exactly when an operator most wants to see what broke.
  const isErrorReport = request.method === "POST"
    && request.nextUrl.pathname === CLIENT_ERROR_REPORT_ENDPOINT
  if (isMutation && !isPreviewExit && !isErrorReport) {
    return NextResponse.json(
      { error: "Admin preview is read-only. Exit preview before making changes." },
      { status: 403 },
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
