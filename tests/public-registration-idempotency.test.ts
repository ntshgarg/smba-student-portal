import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { registerPublicPlayerRequest } from "@/lib/auth/account-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const FIRST_REQUEST_KEY = "11111111-1111-4111-8111-111111111111"
const SECOND_REQUEST_KEY = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-08-09T10:00:00+05:30")

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

describe("public registration idempotency", () => {
  it("reuses an exact request without creating a second account", () => {
    const first = registerPublicPlayerRequest({
      fullName: "  Mira   Rao  ",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => "registration-account-one",
      database,
      now: NOW,
    })
    const replay = registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => {
        throw new Error("An idempotent replay must not allocate another account ID.")
      },
      database,
      now: new Date(NOW.valueOf() + 60_000),
    })

    expect(first).toEqual({ accountId: "registration-account-one", reused: false })
    expect(replay).toEqual({ accountId: "registration-account-one", reused: true })
    expect(database.select().from(schema.accounts).all()).toEqual([
      expect.objectContaining({
        approvalStatus: "pending",
        fullName: "Mira Rao",
        id: "registration-account-one",
        registrationRequestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        registrationRequestKey: FIRST_REQUEST_KEY,
        requestedRole: "player",
      }),
    ])
  })

  it("rejects reuse of a request key with different canonical input", () => {
    registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => "registration-account-one",
      database,
      now: NOW,
    })

    expect(() => registerPublicPlayerRequest({
      fullName: "Riya Rao",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => "registration-account-two",
      database,
      now: NOW,
    })).toThrow(expect.objectContaining({
      code: "CONFLICT",
      field: "registrationRequestKey",
    }))
    expect(database.select().from(schema.accounts).all()).toHaveLength(1)
  })

  it("keeps replay identity stable after a coach changes the account name", () => {
    registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => "registration-account-one",
      database,
      now: NOW,
    })
    database.update(schema.accounts).set({
      fullName: "Mira Rao-Singh",
      normalizedName: "mira rao-singh",
      updatedAt: new Date(NOW.valueOf() + 60_000),
    }).where(eq(schema.accounts.id, "registration-account-one")).run()

    expect(registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => {
        throw new Error("A renamed account replay must not allocate another account ID.")
      },
      database,
      now: new Date(NOW.valueOf() + 120_000),
    })).toEqual({ accountId: "registration-account-one", reused: true })
    expect(database.select().from(schema.accounts).all()).toHaveLength(1)
  })

  it("continues to allow different people with the same name", () => {
    registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: FIRST_REQUEST_KEY,
    }, {
      createId: () => "registration-account-one",
      database,
      now: NOW,
    })
    registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: SECOND_REQUEST_KEY,
    }, {
      createId: () => "registration-account-two",
      database,
      now: NOW,
    })

    expect(database.select().from(schema.accounts)
      .where(eq(schema.accounts.normalizedName, "mira rao"))
      .all()).toHaveLength(2)
  })

  it("rejects malformed request keys before writing", () => {
    expect(() => registerPublicPlayerRequest({
      fullName: "Mira Rao",
      requestKey: "not-a-request-key",
    }, { database, now: NOW })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "registrationRequestKey",
    }))
    expect(database.select().from(schema.accounts).all()).toHaveLength(0)
    expect(sqlite.pragma("foreign_key_check")).toEqual([])
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
  })
})
