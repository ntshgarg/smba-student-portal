import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { seedDatabase } from "@/lib/db/seed"
import {
  purgeExpiredTelemetry,
  purgeExpiredTelemetryOccasionally,
  resetTelemetryPurgeThrottle,
} from "@/lib/telemetry/retention"

const NOW = new Date("2026-11-05T10:00:00Z")
const day = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

let sqlite: Database.Database
let database: SmbaDatabase

function addClientError(id: string, occurredAt: Date) {
  database.insert(schema.clientErrorReports).values({
    id,
    boundary: "root",
    errorName: "Error",
    eventType: "client_error",
    fingerprint: id,
    occurredAt,
    routePath: "/login",
  }).run()
}

function addServerError(id: string, occurredAt: Date) {
  database.insert(schema.operationalEvents).values({
    id,
    eventType: "application_error",
    fingerprint: id,
    occurredAt,
    routePath: "/login",
  }).run()
}

function addSecurityEvent(id: string, occurredAt: Date) {
  database.insert(schema.authSecurityEvents).values({
    id,
    eventType: "login_failed",
    occurredAt,
    outcome: "failure",
  }).run()
}

beforeEach(() => {
  resetTelemetryPurgeThrottle()
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
})

afterEach(() => {
  sqlite.close()
})

describe("retention of operational telemetry", () => {
  it("deletes application errors past 90 days and security events past 180", () => {
    addClientError("client-old", day(91))
    addClientError("client-new", day(89))
    addServerError("server-old", day(91))
    addServerError("server-new", day(89))
    // 120 days is past the application-error limit but inside the security one.
    addSecurityEvent("auth-120", day(120))
    addSecurityEvent("auth-old", day(181))
    addSecurityEvent("auth-new", day(1))

    const removed = purgeExpiredTelemetry({ database, now: NOW })

    expect(removed).toEqual({ clientErrors: 1, securityEvents: 1, serverErrors: 1 })
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort()
    expect(ids(database.select().from(schema.clientErrorReports).all())).toEqual(["client-new"])
    expect(ids(database.select().from(schema.operationalEvents).all())).toEqual(["server-new"])
    expect(ids(database.select().from(schema.authSecurityEvents).all()))
      .toEqual(["auth-120", "auth-new"])
  })

  it("keeps a row exactly at the limit and deletes nothing from an empty table", () => {
    expect(purgeExpiredTelemetry({ database, now: NOW }))
      .toEqual({ clientErrors: 0, securityEvents: 0, serverErrors: 0 })
    addClientError("edge", day(90))
    expect(purgeExpiredTelemetry({ database, now: NOW }).clientErrors).toBe(0)
  })

  it("runs at most once an hour when triggered from a write path", () => {
    addClientError("old-1", day(100))
    purgeExpiredTelemetryOccasionally({ database, now: NOW })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(0)

    addClientError("old-2", day(100))
    purgeExpiredTelemetryOccasionally({ database, now: new Date(NOW.getTime() + 30 * 60_000) })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(1)

    purgeExpiredTelemetryOccasionally({ database, now: new Date(NOW.getTime() + 61 * 60_000) })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(0)
  })

  it("never lets a failed purge break the write that triggered it", () => {
    sqlite.close()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => purgeExpiredTelemetryOccasionally({ database, now: NOW })).not.toThrow()
    spy.mockRestore()
    sqlite = new Database(":memory:")
  })
})
