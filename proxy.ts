import { NextRequest, NextResponse } from "next/server"

import { ADMIN_PREVIEW_COOKIE } from "@/lib/auth/admin-preview"
import { CLIENT_ERROR_REPORT_ENDPOINT } from "@/lib/telemetry/error-report"

export function proxy(request: NextRequest) {
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method)
  const isPreviewExit = request.method === "POST"
    && request.nextUrl.pathname === "/admin/preview/exit"
  // Preview is read-only for academy records, not for operational telemetry.
  // Server request errors are already recorded during preview because
  // instrumentation.ts never passes through here, and a preview session is
  // exactly when an operator most wants to see what broke.
  const isErrorReport = request.method === "POST"
    && request.nextUrl.pathname === CLIENT_ERROR_REPORT_ENDPOINT
  if (isMutation && !isPreviewExit && !isErrorReport && request.cookies.has(ADMIN_PREVIEW_COOKIE)) {
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
