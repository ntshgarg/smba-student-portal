import { NextRequest, NextResponse } from "next/server"

import {
  HEAD_COACH_SETUP_COOKIE,
  claimHeadCoachSetupToken,
} from "@/lib/auth/initial-setup"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"

export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const target = new URL("/setup/head-coach", request.url)
  if (!claimHeadCoachSetupToken(token)) {
    target.searchParams.set("status", "unavailable")
    return NextResponse.redirect(target)
  }
  const response = NextResponse.redirect(target)
  response.cookies.set(HEAD_COACH_SETUP_COOKIE, token!, {
    httpOnly: true,
    maxAge: 60 * 60,
    path: "/setup/head-coach",
    sameSite: "strict",
    secure: secureAuthCookiesRequired(),
  })
  return response
}
