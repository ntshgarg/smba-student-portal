import path from "node:path"

import Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"

/*
 * The demo set-up (`npm run db:bootstrap`, `db:prepare:local`, and every test
 * that calls prepareDatabase({ seed: true })) only ever runs against a
 * developer's own copy. It still has to leave that copy in a state the portal
 * understands: one head coach, the password the developer chose, and never
 * half a coach.
 */

const NOW = new Date("2026-11-13T10:00:00+05:30")
const REAL_HEAD_COACH = "00000000-0000-4000-8000-0000000000c1"

let sqlite: Database.Database
let database: SmbaDatabase

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
})

function headCoaches() {
  return database.select({ accountId: schema.coachProfiles.accountId })
    .from(schema.coachProfiles)
    .where(eq(schema.coachProfiles.accessLevel, "head_admin"))
    .all()
    .map((row) => row.accountId)
}

function demoPasswordHash() {
  return database.select({ password: schema.authProviderAccounts.password })
    .from(schema.authProviderAccounts)
    .where(and(
      eq(schema.authProviderAccounts.accountId, INITIAL_COACH_ACCOUNT_ID),
      eq(schema.authProviderAccounts.providerId, "credential"),
    ))
    .get()?.password
}

describe("demo academy set-up", () => {
  it("does not add the demo head coach beside a head coach the academy already has", () => {
    database.insert(schema.accounts).values({
      approvalStatus: "approved",
      approvedAt: NOW,
      createdAt: NOW,
      fullName: "Real Head Coach",
      id: REAL_HEAD_COACH,
      normalizedName: "real head coach",
      requestedRole: "coach",
      role: "coach",
      updatedAt: NOW,
    }).run()
    database.insert(schema.coachProfiles).values({
      accessLevel: "head_admin",
      accountId: REAL_HEAD_COACH,
      createdAt: NOW,
      joinedOn: "2026-11-13",
      updatedAt: NOW,
    }).run()

    seedDatabase(database)

    expect(headCoaches()).toEqual([REAL_HEAD_COACH])
    expect(database.select().from(schema.accounts)
      .where(eq(schema.accounts.id, INITIAL_COACH_ACCOUNT_ID)).get()).toBeUndefined()
    // The batches every academy needs are still added.
    expect(database.select().from(schema.batches).all().length).toBeGreaterThan(0)
  })

  it("keeps a demo password the developer changed when the set-up runs again", () => {
    seedDatabase(database)
    const original = demoPasswordHash()
    expect(original).toBeTruthy()

    database.update(schema.authProviderAccounts)
      .set({ password: "changed-by-the-developer" })
      .where(eq(schema.authProviderAccounts.accountId, INITIAL_COACH_ACCOUNT_ID))
      .run()

    seedDatabase(database)

    expect(demoPasswordHash()).toBe("changed-by-the-developer")
    expect(headCoaches()).toEqual([INITIAL_COACH_ACCOUNT_ID])
  })

  it("leaves nothing behind when it fails part-way", () => {
    // The head coach profile is the last row written; failing there used to
    // leave the account, its Academy ID and its password without a profile.
    sqlite.exec(`
      CREATE TRIGGER refuse_coach_profiles BEFORE INSERT ON coach_profiles
      BEGIN SELECT RAISE(ABORT, 'refused for the test'); END;
    `)

    expect(() => seedDatabase(database)).toThrow(/refused for the test/u)

    expect(database.select().from(schema.accounts).all()).toEqual([])
    expect(database.select().from(schema.authMethods).all()).toEqual([])
    expect(database.select().from(schema.authProviderAccounts).all()).toEqual([])
    expect(database.select().from(schema.batches).all()).toEqual([])
  })
})
