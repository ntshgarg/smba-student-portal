import { createHash } from "node:crypto"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import {
  type ClientErrorReport,
  clientErrorSignature,
} from "@/lib/telemetry/error-report"
import { recordClientErrorReport } from "@/lib/telemetry/record-client-error"

const NOW = new Date("2026-08-23T10:00:00+05:30")

const report: ClientErrorReport = {
  boundary: "coach_financials",
  digest: "1737209896",
  errorName: "TypeError",
  eventType: "client_error",
  routePath: "/coach/financials/:id",
  summary: "TypeError: ledger is undefined",
}

let sqlite: Database.Database
let database: SmbaDatabase

function storedReports() {
  return database.select().from(schema.clientErrorReports).all()
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
})

afterEach(() => {
  sqlite.close()
})

describe("recordClientErrorReport", () => {
  it("stores the hash of the signature and none of the text behind it", () => {
    expect(recordClientErrorReport({
      accountId: INITIAL_COACH_ACCOUNT_ID,
      report,
    }, { database, now: NOW })).toBe("recorded")

    const [stored] = storedReports()
    expect(stored).toEqual({
      accountId: INITIAL_COACH_ACCOUNT_ID,
      boundary: "coach_financials",
      digest: "1737209896",
      errorName: "TypeError",
      eventType: "client_error",
      fingerprint: createHash("sha256").update(clientErrorSignature(report)).digest("hex"),
      id: expect.any(String),
      occurredAt: NOW,
      routePath: "/coach/financials/:id",
    })

    // Nothing anywhere in the row reproduces the message the fault carried.
    expect(JSON.stringify(stored)).not.toContain("ledger is undefined")
  })

  it("suppresses a repeat of the same fault, so volume cannot grow the table", () => {
    recordClientErrorReport({ accountId: null, report }, { database, now: NOW })

    for (let repeat = 0; repeat < 50; repeat += 1) {
      expect(recordClientErrorReport({ accountId: null, report }, {
        database,
        now: new Date(NOW.getTime() + repeat * 1_000),
      })).toBe("suppressed")
    }

    expect(storedReports()).toHaveLength(1)
  })

  it("records the same fault again once the suppression window has passed", () => {
    recordClientErrorReport({ accountId: null, report }, { database, now: NOW })

    expect(recordClientErrorReport({ accountId: null, report }, {
      database,
      now: new Date(NOW.getTime() + 10 * 60_000 + 1),
    })).toBe("recorded")
    expect(storedReports()).toHaveLength(2)
  })

  it("keeps distinct faults apart even on the same route and boundary", () => {
    recordClientErrorReport({ accountId: null, report }, { database, now: NOW })
    recordClientErrorReport({
      accountId: null,
      report: { ...report, summary: "TypeError: charges is undefined" },
    }, { database, now: NOW })
    recordClientErrorReport({
      accountId: null,
      report: { ...report, boundary: "root" },
    }, { database, now: NOW })

    const fingerprints = new Set(storedReports().map((stored) => stored.fingerprint))
    expect(fingerprints.size).toBe(3)
  })

  it("collapses an unrecognised error name on the way in, not just at the browser", () => {
    recordClientErrorReport({
      accountId: null,
      report: { ...report, errorName: "AaravGuptaError" },
    }, { database, now: NOW })

    expect(storedReports()[0].errorName).toBe("Error")
  })

  it("stores an anonymous report with no account reference", () => {
    recordClientErrorReport({ accountId: null, report }, { database, now: NOW })

    expect(storedReports()[0].accountId).toBeNull()
  })

  it("supports the retention sweep as an indexed range delete over occurred_at", () => {
    recordClientErrorReport({ accountId: null, report }, {
      database,
      now: new Date(NOW.getTime() - 91 * 24 * 60 * 60_000),
    })
    recordClientErrorReport({ accountId: null, report }, { database, now: NOW })

    const plan = sqlite.prepare(
      "EXPLAIN QUERY PLAN DELETE FROM client_error_reports WHERE occurred_at < ?",
    ).all(NOW.getTime()) as Array<{ detail: string }>

    expect(plan.some((step) => step.detail.includes("client_error_reports_occurred_idx")))
      .toBe(true)
    expect(sqlite.prepare("DELETE FROM client_error_reports WHERE occurred_at < ?")
      .run(NOW.getTime() - 90 * 24 * 60 * 60_000).changes).toBe(1)
  })
})

describe("what an unauthenticated caller cannot make this table do", () => {
  it("bounds what one caller can mint by varying only the message", () => {
    /*
     * The fingerprint used to carry `summary` verbatim, so a unique message per
     * request gave a unique fingerprint per request and the duplicate window
     * never fired -- ten identical posts added one row, ten differing only in
     * summary added ten. It contributes a 256-way bucket now, which keeps two
     * genuinely different faults apart while capping what a caller can force.
     */
    const outcomes = Array.from({ length: 2_000 }, (_, index) => recordClientErrorReport({
      accountId: null,
      report: { ...report, summary: `TypeError: unique fault ${index}` },
    }, { database, now: NOW }))

    expect(outcomes.filter((outcome) => outcome === "recorded").length).toBeLessThanOrEqual(256)
  })

  it("never silences one reporter because of another's noise", () => {
    /*
     * A count ceiling was tried here twice -- globally, then per reporter -- and
     * was wrong both times: fifty cheap posts silenced every anonymous browser's
     * crash reports for ten minutes, which is the telemetry an operator reads
     * during the incident the attacker is causing. That is the shared-bucket
     * pathology the login throttle had, and it is no more defensible here.
     */
    for (let index = 0; index < 500; index += 1) {
      recordClientErrorReport({
        accountId: null,
        report: { ...report, routePath: `/flood-${index}`, summary: `flood ${index}` },
      }, { database, now: NOW })
    }

    expect(recordClientErrorReport({
      accountId: INITIAL_COACH_ACCOUNT_ID,
      report: { ...report, routePath: "/player/reports", summary: "a real fault elsewhere" },
    }, { database, now: NOW })).toBe("recorded")
    expect(recordClientErrorReport({
      accountId: null,
      report: { ...report, routePath: "/login", summary: "an anonymous fault too" },
    }, { database, now: NOW })).toBe("recorded")
  })

  it("accepts a genuine fault again once the window has passed", () => {
    for (let index = 0; index < 120; index += 1) {
      recordClientErrorReport({
        accountId: null,
        report: { ...report, summary: `TypeError: unique fault ${index}` },
      }, { database, now: NOW })
    }
    const later = new Date(NOW.getTime() + 11 * 60_000)

    expect(recordClientErrorReport({
      accountId: null,
      report: { ...report, summary: "TypeError: a real one, later" },
    }, { database, now: later })).toBe("recorded")
  })
})
