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

export function requestSecurityContext(requestHeaders: Pick<Headers, "get">) {
  const ipAddress = firstHeaderValue(requestHeaders.get("x-vercel-forwarded-for"))
    ?? firstHeaderValue(requestHeaders.get("cf-connecting-ip"))
    ?? firstHeaderValue(requestHeaders.get("x-forwarded-for"))
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
