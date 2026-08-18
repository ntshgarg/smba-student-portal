import { NextResponse } from "next/server"

import {
  claimPasswordRecovery,
  PASSWORD_RECOVERY_LIFETIME_MS,
  RECOVERY_SESSION_COOKIE,
} from "@/lib/auth/recovery-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { absoluteSiteUrl } from "@/lib/config"

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!claimPasswordRecovery(token)) {
    return NextResponse.redirect(absoluteSiteUrl("/recover?error=invalid"))
  }
  const response = NextResponse.redirect(absoluteSiteUrl("/recover/reset"))
  response.cookies.set(RECOVERY_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: PASSWORD_RECOVERY_LIFETIME_MS / 1_000,
    path: "/recover",
    sameSite: "lax",
    secure: secureAuthCookiesRequired(),
  })
  return response
}
