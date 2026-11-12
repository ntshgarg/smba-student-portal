import { NextRequest, NextResponse } from "next/server"

import {
  ADMIN_PREVIEW_COOKIE,
  AUTH_SESSION_COOKIE_NAMES,
  readLiveAdminPreviewClaim,
  sessionTokenFromCookieValue,
} from "@/lib/auth/admin-preview"
import { adminPreviewStillStands } from "@/lib/auth/admin-preview-standing"
import { CLIENT_ERROR_REPORT_ENDPOINT } from "@/lib/telemetry/error-report"

type PreviewCookie =
  | { kind: "leftover" }
  | { kind: "unreadable" }
  | {
    kind: "live"
    claim: NonNullable<ReturnType<typeof readLiveAdminPreviewClaim>>
    sessionToken: string
  }

function readPreviewCookie(request: NextRequest): PreviewCookie {
  const sessionToken = sessionTokenFromCookieValue(AUTH_SESSION_COOKIE_NAMES
    .map((name) => request.cookies.get(name)?.value)
    .find(Boolean))
  try {
    const claim = readLiveAdminPreviewClaim(request.cookies.get(ADMIN_PREVIEW_COOKIE)?.value, sessionToken)
    return claim && sessionToken ? { claim, kind: "live", sessionToken } : { kind: "leftover" }
  } catch {
    // The signing secret could not be read. Keep changes switched off rather
    // than guess: a preview must never be able to write.
    return { kind: "unreadable" }
  }
}

/*
 * Asked only when a form is about to be refused, so a preview's page views
 * never wait on the database. The cookies say the preview is this browser's;
 * this asks whether the owner's sign-in and the person being viewed are still
 * there on the server.
 */
function previewStillStands(preview: Extract<PreviewCookie, { kind: "live" }>) {
  try {
    return adminPreviewStillStands({
      actorAccountId: preview.claim.actorAccountId,
      sessionToken: preview.sessionToken,
      targetAccountId: preview.claim.targetAccountId,
    })
  } catch {
    // Same rule as an unreadable secret: when in doubt, the preview stays read-only.
    return true
  }
}

function passAndClearLeftoverPreview() {
  const response = NextResponse.next()
  response.cookies.delete(ADMIN_PREVIEW_COOKIE)
  return response
}

export function proxy(request: NextRequest) {
  if (!request.cookies.has(ADMIN_PREVIEW_COOKIE)) return NextResponse.next()

  // A preview cookie that no longer belongs to this browser's sign-in -- the
  // owner signed out, the hour ran out, someone else signed in -- is left over,
  // not a preview. Clear it and let the request through, or it would block
  // every form here (signing in included) with no Exit preview on screen.
  const preview = readPreviewCookie(request)
  if (preview.kind === "leftover") return passAndClearLeftoverPreview()

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

  // The owner's sign-in was ended on the server (from another device, by a
  // password change or recovery) while this browser kept its cookie, or the
  // person being viewed was archived or lost their sign-in. Either way nothing
  // is being previewed any more, and the pages already treat this browser as
  // signed out or as the owner: refusing the form would be the only thing
  // still acting as if the preview were on.
  if (preview.kind === "live" && !previewStillStands(preview)) return passAndClearLeftoverPreview()

  return NextResponse.json(
    { error: "Admin preview is read-only. Exit preview before making changes." },
    { status: 403 },
  )
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
