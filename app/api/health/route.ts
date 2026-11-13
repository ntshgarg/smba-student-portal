import { sql } from "drizzle-orm"

import { pinnedAccessibilityDateKey } from "@/lib/clock"
import { initializeDatabase } from "@/lib/db/client"
import { describeFailureCause } from "@/lib/telemetry/failure-cause"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const

export async function GET() {
  // Present only while SMBA_ACCESSIBILITY_CLOCK pins this server, which no
  // deployment sets, so the payload production serves is byte-identical. The
  // accessibility gate reads it back before auditing: the variable is read in
  // this process, not in the Playwright runner, and the runner attaches to a
  // server it did not start. Absent here means "the server is on its own wall
  // clock", which is the state the gate must refuse rather than measure.
  //
  // Read outside the try because a misconfigured pin is not a database outage
  // and must not be reported as one: lib/clock.ts throws, this route lets the
  // throw out, and the workflow's readiness loop fails with the real reason in
  // the server log it already sanitizes and uploads.
  const fixtureClock = pinnedAccessibilityDateKey()
  try {
    // Reachable is not the same as ready. A blank file, a database whose tables
    // were never created, or one whose set-up step was skipped all answer
    // `select 1`, and every signed-in page on them fails. Every prepared
    // academy -- empty or loaded -- has its batches, so reading one proves the
    // tables exist and the set-up ran.
    const prepared = initializeDatabase().get<{ ready: number }>(
      sql`select 1 as ready from batches limit 1`,
    )
    if (!prepared) {
      console.error("Health check found a database that has not been set up.")
      return Response.json({ status: "unavailable" }, {
        headers: responseHeaders,
        status: 503,
      })
    }

    return Response.json({ status: "ok", ...fixtureClock ? { fixtureClock } : {} }, {
      headers: responseHeaders,
      status: 200,
    })
  } catch (error) {
    console.error("Health check database probe failed.", {
      cause: describeFailureCause(error),
    })
    return Response.json({ status: "unavailable" }, {
      headers: responseHeaders,
      status: 503,
    })
  }
}
