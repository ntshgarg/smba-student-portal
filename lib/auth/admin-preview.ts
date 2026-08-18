import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

export const ADMIN_PREVIEW_COOKIE = "smba_admin_preview"
const PREVIEW_LIFETIME_MS = 60 * 60 * 1000

type PreviewClaim = {
  actorAccountId: string
  expiresAt: number
  targetAccountId: string
}

function secret() {
  return process.env.BETTER_AUTH_SECRET?.trim()
    || "smba-local-only-auth-secret-change-before-deployment-2026"
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(`admin-preview:${payload}`).digest("base64url")
}

export function createAdminPreviewToken(input: {
  actorAccountId: string
  targetAccountId: string
}, now = new Date()) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    expiresAt: now.getTime() + PREVIEW_LIFETIME_MS,
  } satisfies PreviewClaim)).toString("base64url")
  return `${payload}.${signature(payload)}`
}

export function readAdminPreviewToken(
  token: string | null | undefined,
  actorAccountId: string,
  now = new Date(),
) {
  if (!token) return null
  const [payload, suppliedSignature, extra] = token.split(".")
  if (!payload || !suppliedSignature || extra) return null
  const expected = Buffer.from(signature(payload))
  const supplied = Buffer.from(suppliedSignature)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreviewClaim
    if (claim.actorAccountId !== actorAccountId
      || !claim.targetAccountId
      || !Number.isFinite(claim.expiresAt)
      || claim.expiresAt <= now.getTime()) return null
    return claim
  } catch {
    return null
  }
}
