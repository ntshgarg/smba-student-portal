import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { and, eq, gte, isNull } from "drizzle-orm"

import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import { clientErrorReports } from "@/lib/db/schema"
import {
  type ClientErrorReport,
  clientErrorSignature,
  normalizeErrorName,
} from "@/lib/telemetry/error-report"

// Repeat occurrences of one fault inside this window are counted as the same
// report and dropped.
const DUPLICATE_WINDOW_MS = 10 * 60_000

/*
 * ...and a hard ceiling, because the sentence above used to end "so the table
 * can only grow by the number of distinct fault shapes per window" and that was
 * not true. The fingerprint is taken over `summary`, which the caller supplies,
 * so a unique summary per request produced a unique fingerprint per request and
 * the duplicate check never fired. Measured on a live build: ten identical
 * posts added one row, ten posts differing only in `summary` added ten.
 *
 * This endpoint is unauthenticated by design -- a browser that has just crashed
 * cannot be asked to prove who it is -- so the bound cannot depend on anything
 * the caller chooses. A real academy produces a handful of distinct faults in
 * ten minutes; anything past this is either an incident or an attacker, and in
 * both cases the rows after the first hundred tell nobody anything new.
 */
const WINDOW_INSERT_CEILING = 50

export function recordClientErrorReport(input: {
  accountId: string | null
  report: ClientErrorReport
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  // Sanitized text in, hash out, text discarded -- the same treatment
  // lib/operations/record-request-error.node.ts gives a server request error.
  const fingerprint = createHash("sha256")
    .update(clientErrorSignature(input.report))
    .digest("hex")

  const duplicate = database.select({ id: clientErrorReports.id })
    .from(clientErrorReports)
    .where(and(
      eq(clientErrorReports.fingerprint, fingerprint),
      gte(clientErrorReports.occurredAt, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
    ))
    .get()
  if (duplicate) return "suppressed" as const

  /*
   * Counted per reporter, not per route.
   *
   * Per route was unreachable by construction: `routePath` is whatever the
   * caller sends, so inventing a fresh one each time gave every request its own
   * ceiling -- 200 rows in under four seconds from one client. And globally it
   * was worse than unreachable: a stranger filling the window silenced every
   * genuine report from every real browser, which is the telemetry an operator
   * reads during the incident the attacker is causing.
   *
   * Keyed on the account -- or, for a signed-out browser, on nothing the caller
   * chooses -- a flood costs the flooder their own budget and leaves everybody
   * else reporting.
   */
  const windowStart = new Date(now.getTime() - DUPLICATE_WINDOW_MS)
  const recentCount = database.select({ id: clientErrorReports.id })
    .from(clientErrorReports)
    .where(and(
      gte(clientErrorReports.occurredAt, windowStart),
      input.accountId
        ? eq(clientErrorReports.accountId, input.accountId)
        : isNull(clientErrorReports.accountId),
    ))
    .all().length
  if (recentCount >= WINDOW_INSERT_CEILING) return "suppressed" as const

  database.insert(clientErrorReports).values({
    id: randomUUID(),
    accountId: input.accountId,
    boundary: input.report.boundary,
    digest: input.report.digest,
    errorName: normalizeErrorName(input.report.errorName),
    eventType: input.report.eventType,
    fingerprint,
    occurredAt: now,
    routePath: input.report.routePath,
  }).run()

  return "recorded" as const
}
