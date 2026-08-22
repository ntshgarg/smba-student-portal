import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  ensureBootstrapCredential,
  provisionDevelopmentCredential,
  verifyCurrentPassword,
} from "@/lib/auth/credential-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"

const BOOTSTRAP_PASSWORD = "A production-ready coach password!"

let sqlite: Database.Database
let database: SmbaDatabase

beforeEach(() => {
  process.env.VERCEL = "1"
  process.env.BETTER_AUTH_SECRET = "production-bootstrap-test-secret-over-32-characters"
  process.env.SMBA_BOOTSTRAP_HEAD_COACH_PASSWORD = BOOTSTRAP_PASSWORD
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
  delete process.env.VERCEL
  delete process.env.BETTER_AUTH_SECRET
  delete process.env.SMBA_BOOTSTRAP_HEAD_COACH_PASSWORD
})

describe("production head-coach bootstrap", () => {
  it("rejects deterministic fixture credentials on every Vercel deployment", () => {
    expect(() => provisionDevelopmentCredential({
      academyId: "SMBA-PL-0001",
      accountId: "fixture-player",
      fullName: "Fixture Player",
    }, { database })).toThrow("must never be provisioned during a Vercel deployment")
    expect(database.select().from(schema.authProviderAccounts).all()).toHaveLength(0)
  })

  it("provisions a fresh production head coach only through the configured bootstrap password", async () => {
    seedDatabase(database)
    expect(database.select().from(schema.authUsers)
      .where(eq(schema.authUsers.id, INITIAL_COACH_ACCOUNT_ID)).get()).toBeUndefined()

    expect(ensureBootstrapCredential({ database })).toBe("SMBA#0001")
    expect(database.select().from(schema.authCredentialStates)
      .where(eq(schema.authCredentialStates.accountId, INITIAL_COACH_ACCOUNT_ID)).get()?.status)
      .toBe("active")
    await expect(verifyCurrentPassword({
      accountId: INITIAL_COACH_ACCOUNT_ID,
      password: BOOTSTRAP_PASSWORD,
    }, { database })).resolves.toBe(true)
    expect(database.select().from(schema.authAccessCodes).all()).toHaveLength(0)
  })
})
