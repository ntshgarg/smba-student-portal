import { sql } from "drizzle-orm"

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
  try {
    initializeDatabase().run(sql`select 1`)

    return Response.json({ status: "ok" }, {
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
