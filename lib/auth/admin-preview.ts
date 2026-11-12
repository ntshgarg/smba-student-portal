import "server-only"

import { resolveAuthSecret } from "@/lib/auth/auth-secret"
import { AUTH_COOKIE_PREFIX } from "@/lib/auth/cookie-policy"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export const ADMIN_PREVIEW_COOKIE = "smba_admin_preview"
const PREVIEW_LIFETIME_MS = 60 * 60 * 1000
/*
 * The cookie outlives the preview it carries by an hour. Past the hour the
 * claim inside is expired and changes nothing -- the proxy clears it on the
 * next request -- but an Exit preview pressed on a tab left open past the hour
 * still arrives with it, so the stop record can name the person who was viewed.
 */
export const ADMIN_PREVIEW_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60

/*
 * Better Auth's sign-in cookie, under both of the names it may be written with
 * (lib/auth/better-auth.ts sets the prefix and switches the secure name on in
 * production). The proxy reads it without loading the auth runtime, so the
 * names live here.
 */
const SESSION_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token`
export const AUTH_SESSION_COOKIE_NAMES = [`__Secure-${SESSION_COOKIE}`, SESSION_COOKIE] as const

type PreviewClaim = {
  actorAccountId: string
  expiresAt: number
  /*
   * The owner's sign-in the preview was started from, hashed. A preview lives
   * only as long as that sign-in: once the owner signs out, or the session ends
   * and someone signs in on the same computer, the preview cookie no longer
   * matches and stops switching changes off. Without it, a leftover cookie kept
   * blocking every form on the browser -- signing in included -- for up to an
   * hour, with no Exit preview button anywhere to clear it.
   */
  sessionKey: string
  targetAccountId: string
}

function secret() {
  return resolveAuthSecret("smba-local-only-auth-secret-change-before-deployment-2026")
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(`admin-preview:${payload}`).digest("base64url")
}

function sessionKey(sessionToken: string) {
  return createHash("sha256").update(`admin-preview-session:${sessionToken}`).digest("base64url")
}

/** The session token inside the signed sign-in cookie value (`token.signature`). */
export function sessionTokenFromCookieValue(value: string | null | undefined) {
  if (!value) return null
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  const token = decoded.split(".")[0]
  return token || null
}

export function createAdminPreviewToken(input: {
  actorAccountId: string
  sessionToken: string
  targetAccountId: string
}, now = new Date()) {
  const payload = Buffer.from(JSON.stringify({
    actorAccountId: input.actorAccountId,
    expiresAt: now.getTime() + PREVIEW_LIFETIME_MS,
    sessionKey: sessionKey(input.sessionToken),
    targetAccountId: input.targetAccountId,
  } satisfies PreviewClaim)).toString("base64url")
  return `${payload}.${signature(payload)}`
}

function readSignedClaim(token: string | null | undefined) {
  if (!token) return null
  const [payload, suppliedSignature, extra] = token.split(".")
  if (!payload || !suppliedSignature || extra) return null
  const expected = Buffer.from(signature(payload))
  const supplied = Buffer.from(suppliedSignature)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreviewClaim
    if (!claim.actorAccountId
      || !claim.targetAccountId
      || typeof claim.sessionKey !== "string"
      || !Number.isFinite(claim.expiresAt)) return null
    return claim
  } catch {
    return null
  }
}

/**
 * A preview claim that is signed, unexpired and belongs to the sign-in
 * `sessionToken` -- whoever it names as owner. This is the proxy's first test,
 * from cookies alone; before it refuses a form it also asks the server whether
 * that sign-in and the person being viewed are still there
 * (lib/auth/admin-preview-standing.ts).
 */
export function readLiveAdminPreviewClaim(
  token: string | null | undefined,
  sessionToken: string | null | undefined,
  now = new Date(),
) {
  if (!sessionToken) return null
  const claim = readSignedClaim(token)
  if (!claim
    || claim.sessionKey !== sessionKey(sessionToken)
    || claim.expiresAt <= now.getTime()) return null
  return claim
}

export function readAdminPreviewToken(
  token: string | null | undefined,
  actorAccountId: string,
  sessionToken: string | null | undefined,
  now = new Date(),
) {
  const claim = readLiveAdminPreviewClaim(token, sessionToken, now)
  return claim?.actorAccountId === actorAccountId ? claim : null
}

/**
 * Who a preview cookie this owner signed was showing, however old it is. Only
 * for filing the stop record beside the start record: a preview exited after
 * its hour has run out still names the person it was opened on, and the
 * signature is what makes that name trustworthy. Never use it to decide what a
 * request may see or do.
 */
export function readAdminPreviewRecord(
  token: string | null | undefined,
  actorAccountId: string,
) {
  const claim = readSignedClaim(token)
  return claim?.actorAccountId === actorAccountId ? claim : null
}
