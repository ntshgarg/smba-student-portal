import { NextResponse } from "next/server"

import {
  AUTHENTICATOR_RECOVERY_COOKIE,
  claimPasswordRecovery,
  PASSWORD_RECOVERY_LIFETIME_MS,
} from "@/lib/auth/recovery-service"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"
import { absoluteSiteUrl } from "@/lib/config"

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!claimPasswordRecovery(token)) {
    return NextResponse.redirect(absoluteSiteUrl("/auth/two-factor/recovery?error=invalid"))
  }
  const response = NextResponse.redirect(absoluteSiteUrl("/auth/two-factor/recovery?verified=1"))
  response.cookies.set(AUTHENTICATOR_RECOVERY_COOKIE, token, {
    httpOnly: true,
    maxAge: PASSWORD_RECOVERY_LIFETIME_MS / 1_000,
    path: "/auth/two-factor/recovery",
    sameSite: "lax",
    secure: secureAuthCookiesRequired(),
  })
  return response
}
