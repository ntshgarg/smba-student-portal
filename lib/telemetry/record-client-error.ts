import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { and, eq, gte } from "drizzle-orm"

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
   * The duplicate window above is the only bound, and that is the point.
   *
   * A count ceiling was tried twice here and was wrong both times. Globally, and
   * then per reporter, it was a mute button any stranger could hold: fifty cheap
   * posts silenced every anonymous browser's crash reports for ten minutes --
   * the telemetry an operator reads during the incident the attacker is causing.
   * That is the same shared-bucket pathology the login throttle had, and it is
   * no more defensible here.
   *
   * With the caller's free text out of the fingerprint, the window bounds growth
   * by the number of distinct fault shapes, which is what its comment always
   * claimed. Volume is bounded by the route's own per-address rate limit.
   */

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
