import { NextRequest, NextResponse } from "next/server"

import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import {
  PLATFORM_ADMIN_SETUP_COOKIE,
  platformAdminSetupAvailable,
  validPlatformAdminSetupToken,
} from "@/lib/auth/initial-setup"

export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const target = new URL("/setup/admin", request.url)
  if (!validPlatformAdminSetupToken(token) || !platformAdminSetupAvailable()) {
    target.searchParams.set("status", "unavailable")
    return NextResponse.redirect(target)
  }
  const response = NextResponse.redirect(target)
  response.cookies.set(PLATFORM_ADMIN_SETUP_COOKIE, token!, {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/setup/admin",
    sameSite: "strict",
    secure: secureAuthCookiesRequired(),
  })
  return response
}
