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

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null
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
 * So the header is opt-in. Unset, every caller shares the "unknown" bucket,
 * which throttles correctly; it is coarse, and being coarse is the safe
 * direction. Set it to the one header the proxy in front of this deployment
 * overwrites (never appends).
 */
function forwardedIpHeader() {
  return process.env.SMBA_FORWARDED_IP_HEADER?.trim().toLowerCase()
    || (process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : null)
}

export function requestSecurityContext(requestHeaders: Pick<Headers, "get">) {
  const header = forwardedIpHeader()
  const ipAddress = (header ? firstHeaderValue(requestHeaders.get(header)) : null)
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
