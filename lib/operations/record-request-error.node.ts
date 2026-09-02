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
const ROUTE_WINDOW_CEILING = 50
const GLOBAL_WINDOW_CEILING = 500

/*
 * A refused authorization is a decision, not a fault. Recording one costs a
 * durable row for something working exactly as designed -- and these are the
 * cheapest rows to force, because provoking a refusal needs no credential.
 */
// Unanchored on purpose: a real Next redirect arrives as a bare `digest` of
// "NEXT_REDIRECT;...", but a thrown Error reaches here as "Error:NEXT_REDIRECT;...".
const DECIDED_REFUSALS = /NEXT_REDIRECT|NEXT_NOT_FOUND|access is required|Authentication required/u

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
    if (DECIDED_REFUSALS.test(digest)) return
    const fingerprint = createHash("sha256").update(digest).digest("hex")

    const database = initializeDatabase()
    const routePath = context.routePath.slice(0, 240)
    const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MS)
    const recent = database.select({ id: operationalEvents.id })
      .from(operationalEvents)
      .where(and(
        gte(operationalEvents.occurredAt, windowStart),
        eq(operationalEvents.eventType, "application_error"),
      ))
      .all()
    if (recent.length >= GLOBAL_WINDOW_CEILING) return

    const sameShape = database.select({ id: operationalEvents.id })
      .from(operationalEvents)
      .where(and(
        gte(operationalEvents.occurredAt, windowStart),
        eq(operationalEvents.fingerprint, fingerprint),
        eq(operationalEvents.routePath, routePath),
      ))
      .get()
    if (sameShape) return

    const sameRoute = database.select({ id: operationalEvents.id })
      .from(operationalEvents)
      .where(and(
        gte(operationalEvents.occurredAt, windowStart),
        eq(operationalEvents.routePath, routePath),
      ))
      .all()
    if (sameRoute.length >= ROUTE_WINDOW_CEILING) return

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
