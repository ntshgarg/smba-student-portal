import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

let sqlite: Database.Database
let database: SmbaDatabase

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client")
  return { ...actual, initializeDatabase: () => database }
})

const { recordRequestError } = await import("@/lib/operations/record-request-error.node")

/**
 * `onRequestError` runs for every server-side throw, and an anonymous caller can
 * cause one at will: a server action id is a build-time constant sitting in the
 * JavaScript the signed-out /login page already loads, and posting malformed
 * arguments to it throws. Measured against a live build with no cookie at all:
 * roughly 150 rows a second, one per request, on a table with no unique index.
 *
 * The client-side twin was given a duplicate window and a ceiling; this path was
 * not, though the comment there claims the two are treated alike.
 */
const context = (routePath: string) => ({
  revalidateReason: undefined,
  routePath,
  routerKind: "App Router" as const,
  routeType: "route" as const,
})

function events() {
  return database.select().from(schema.operationalEvents).all()
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
})

describe("what an anonymous caller cannot make the error recorder do", () => {
  it("records one row for a repeated fault rather than one per request", async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await recordRequestError(new Error("TypeError: boom"), {} as never, context("/login"))
    }

    expect(events()).toHaveLength(1)
  })

  it("bounds a caller who varies the fault so every request is a new shape", async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await recordRequestError(new Error(`boom ${attempt}`), {} as never, context("/login"))
    }

    // Per route, so one saturated surface does not silence the rest.
    expect(events().length).toBeLessThanOrEqual(50)
  })

  it("bounds a caller who also varies the route, which they choose", async () => {
    /*
     * routePath is simply the route the action was posted to, so anything
     * counted per route can be spread across routes to defeat it. The global
     * ceiling is the one that actually holds.
     */
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      await recordRequestError(
        new Error(`boom ${attempt}`),
        {} as never,
        context(`/invented-route-${attempt}`),
      )
    }

    expect(events().length).toBeLessThanOrEqual(500)
  })

  it("does not spend a row on a refusal that worked exactly as designed", async () => {
    // Provoking one of these needs no credential, which makes them the cheapest
    // rows to force -- and none of them is a fault worth alerting anybody about.
    for (const refusal of [
      "NEXT_REDIRECT;replace;/login;307;",
      "Head coach access is required.",
      "Authentication required.",
    ]) {
      await recordRequestError(new Error(refusal), {} as never, context("/coach"))
    }

    expect(events()).toHaveLength(0)
  })

  it("still records a genuine fault once the noise has been turned away", async () => {
    await recordRequestError(new Error("NEXT_REDIRECT;replace;/login;307;"), {} as never, context("/coach"))
    await recordRequestError(new Error("TypeError: ledger is undefined"), {} as never, context("/coach"))

    expect(events()).toHaveLength(1)
    expect(events()[0]!.routePath).toBe("/coach")
  })
})
