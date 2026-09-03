import "server-only"

import { createHmac, randomUUID } from "node:crypto"

import { authSecurityEvents } from "@/lib/db/schema"
import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"

export type AuthSecurityEventType = typeof authSecurityEvents.$inferInsert.eventType
export type AuthSecurityEventOutcome = typeof authSecurityEvents.$inferInsert.outcome

function auditKey() {
  return process.env.BETTER_AUTH_SECRET?.trim()
    || "smba-local-only-audit-key-change-before-deployment-2026"
}

function digest(value: string) {
  return createHmac("sha256", auditKey()).update(value).digest("hex")
}

/*
 * The LAST hop, not the first.
 *
 * A proxy that appends writes `x-forwarded-for: <what the client claimed>, <the
 * address the proxy actually saw>`, so the leftmost value is the client's own
 * claim and the rightmost is the only one a proxy vouched for. Reading the
 * leftmost handed every caller its own throttle bucket. A proxy that overwrites
 * emits a single value, where the two are the same.
 */
function trustedHeaderValue(value: string | null) {
  const hops = value?.split(",").map((hop) => hop.trim()).filter(Boolean) ?? []
  return hops.at(-1) || null
}

/*
 * Which header, if any, this deployment's proxy actually sets.
 *
 * Reading a chain of forwarded headers unconditionally means the *client*
 * chooses its own rate-limit bucket: against a bare `next start`, 300 requests
 * rotating `x-forwarded-for` produced 300 accepted writes where a fixed address
 * was cut off after 20. Vercel is safe by accident -- it sets
 * `x-vercel-forwarded-for` itself and that is read first -- but "safe by
 * accident on one host" is not a control.
 *
 * So the header is opt-in. Unset, every caller lands in one shared bucket -- and
 * "coarse is the safe direction" was wrong about that, badly. A bucket everyone
 * shares must never be allowed to refuse anybody: twenty failed logins against
 * twenty different accounts denied the whole portal, every coach and every
 * player, for fifteen minutes and renewably. `UNKNOWN_IP_HASH` below is how the
 * throttle tells the two cases apart.
 *
 * Set it to the one header the proxy in front of this deployment writes. On a
 * chain deeper than one hop -- a CDN in front of nginx -- the last value is the
 * CDN's egress address, which is shared by every visitor, so that configuration
 * is the shared case too and must be treated as untrusted.
 */
function forwardedIpHeader() {
  return process.env.SMBA_FORWARDED_IP_HEADER?.trim().toLowerCase()
    || (process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : null)
}

/**
 * The hash every caller gets when no address could be established.
 *
 * Exported so the login throttle can recognise it: a ceiling that refuses an
 * account must never be applied to a bucket that may hold the whole internet.
 */
export const UNKNOWN_IP_HASH = digest("ip:unknown")

export function requestSecurityContext(requestHeaders: Pick<Headers, "get">) {
  const header = forwardedIpHeader()
  const ipAddress = (header ? trustedHeaderValue(requestHeaders.get(header)) : null)
    ?? "unknown"
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 240) || null

  return {
    ipHash: digest(`ip:${ipAddress}`),
    userAgent,
  }
}

export function authSubjectHash(value: string) {
  return digest(`subject:${value}`)
}

export function writeAuthSecurityEvent(input: {
  accountId?: string | null
  actorAccountId?: string | null
  eventType: AuthSecurityEventType
  ipHash?: string | null
  metadata?: Record<string, string | number | boolean | null>
  outcome: AuthSecurityEventOutcome
  subjectHash?: string | null
  userAgent?: string | null
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  database.insert(authSecurityEvents).values({
    id: randomUUID(),
    accountId: input.accountId ?? null,
    actorAccountId: input.actorAccountId ?? null,
    eventType: input.eventType,
    ipHash: input.ipHash ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    occurredAt: now,
    outcome: input.outcome,
    subjectHash: input.subjectHash ?? null,
    userAgent: input.userAgent ?? null,
  }).run()
}
