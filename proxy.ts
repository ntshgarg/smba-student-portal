import { NextRequest, NextResponse } from "next/server"

import { ADMIN_PREVIEW_COOKIE } from "@/lib/auth/admin-preview"

export function proxy(request: NextRequest) {
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method)
  if (isMutation && request.cookies.has(ADMIN_PREVIEW_COOKIE)) {
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
