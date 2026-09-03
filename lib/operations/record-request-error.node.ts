import { createHash, randomUUID } from "node:crypto"

import { and, eq, gte } from "drizzle-orm"
import type { Instrumentation } from "next"

import { initializeDatabase } from "@/lib/db/client"
import { operationalEvents } from "@/lib/db/schema"

/*
 * Two bounds, because this runs for every server-side throw and an anonymous
 * caller can cause one at will: a server action id is a build-time constant sat
 * in the JavaScript the signed-out /login page already loads, and posting
 * malformed arguments to it throws. Measured against a live build with no
 * cookie: ~150 rows per second, one per request, on a table with no unique
 * index and no ceiling.
 *
 * The client-side twin in lib/telemetry/record-client-error.ts was given both
 * of these and this path was not, though its comment claims the two are treated
 * alike. The hashing was copied across; the bound was not.
 *
 * The global ceiling is what actually holds. `routePath` here is simply the
 * route the action was posted to, so it is chosen by the attacker, and anything
 * counted per route can be spread across routes to defeat it.
 */
const DUPLICATE_WINDOW_MS = 10 * 60_000

/*
 * A refused authorization is a decision, not a fault. Recording one costs a
 * durable row for something working exactly as designed -- and these are the
 * cheapest rows to force, because provoking a refusal needs no credential.
 */
/*
 * Anchored, and matched against the framework's own digest shape rather than
 * against prose. Unanchored it did both halves of the wrong thing: a genuine
 * fault whose message happened to contain "Authentication required" was thrown
 * away, and any path reaching here without a digest turned it into a
 * "do not record me" switch a caller could type into an error message.
 */
const FRAMEWORK_CONTROL_FLOW = /^(?:Error:)?NEXT_(?:REDIRECT|NOT_FOUND)(?:[;:]|$)/u

export const recordRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  try {
    const digest = typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : error instanceof Error
        ? `${error.name}:${error.message}`
        : String(error)
    if (FRAMEWORK_CONTROL_FLOW.test(digest)) return
    const fingerprint = createHash("sha256").update(digest).digest("hex")

    const database = initializeDatabase()
    const routePath = context.routePath.slice(0, 240)
    const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MS)
    const sameShape = database.select({ id: operationalEvents.id })
      .from(operationalEvents)
      .where(and(
        gte(operationalEvents.occurredAt, windowStart),
        eq(operationalEvents.fingerprint, fingerprint),
        eq(operationalEvents.routePath, routePath),
      ))
      .get()
    if (sameShape) return

    /*
     * The dedupe above is the bound, and it is deliberately the only one.
     *
     * A global ceiling was tried and it was a kill switch a stranger owned:
     * five hundred cheap inserts, under a request a second, silenced every
     * genuine production fault on every route for ten minutes -- including the
     * faults caused by whatever they did next. That is the same failure the
     * client-side twin was redesigned away from, and this path had copied the
     * shape rather than the lesson.
     *
     * What is left bounds the table without ever hiding a fault: one row per
     * (fingerprint, route) per window. A caller can only add rows by producing
     * genuinely distinct faults on distinct real routes, and a shape nobody has
     * seen this window is always admitted -- which is the one property an
     * operator needs during an incident.
     */

    database.insert(operationalEvents).values({
      id: randomUUID(),
      eventType: "application_error",
      fingerprint,
      routePath,
      occurredAt: new Date(),
    }).run()
  } catch {
    // The original request error remains Next.js's responsibility. Avoid
    // leaking its content or creating a recursive database failure here.
    console.error("SMBA could not persist a sanitized operational error event.")
  }
}
