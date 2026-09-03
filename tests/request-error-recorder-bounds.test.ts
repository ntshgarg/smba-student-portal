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

  it("never drops a fault nobody has seen this window, however much noise precedes it", async () => {
    /*
     * A global ceiling was tried here and it was a kill switch a stranger owned:
     * five hundred cheap inserts silenced every genuine fault on every route for
     * ten minutes -- including the faults caused by whatever they did next.
     * Bounding cost must never cost visibility, so the dedupe is the only bound.
     */
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      await recordRequestError(new Error(`noise ${attempt}`), {} as never, context("/login"))
    }

    await recordRequestError(
      new Error("TypeError: ledger is undefined"),
      {} as never,
      context("/coach/financials"),
    )

    const recorded = events()
    expect(recorded.some((row) => row.routePath === "/coach/financials")).toBe(true)
  })

  it("does not spend a row on the framework's own control flow", async () => {
    // A redirect is not a fault, and provoking one needs no credential -- which
    // makes them the cheapest rows in the table to force.
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_NOT_FOUND"]) {
      await recordRequestError(new Error(digest), {} as never, context("/coach"))
    }

    expect(events()).toHaveLength(0)
  })

  it("records a genuine fault whose message merely mentions a refusal", async () => {
    /*
     * The first version of the filter matched those words anywhere in the
     * message, so a real fault that happened to mention them was thrown away --
     * and a caller who could influence an error message had a "do not record me"
     * switch. It matches the framework's digest shape now, anchored.
     */
    await recordRequestError(
      new Error("TypeError: cannot read 'Authentication required' banner"),
      {} as never,
      context("/coach"),
    )

    expect(events()).toHaveLength(1)
  })
})
