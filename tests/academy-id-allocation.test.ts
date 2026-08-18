import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { allocateRandomAcademyId } from "@/lib/auth/account-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const NOW = new Date("2026-08-18T10:00:00+05:30")

let sqlite: Database.Database
let database: SmbaDatabase

function createAccount(id: string) {
  database.insert(schema.accounts).values({
    approvalStatus: "pending",
    createdAt: NOW,
    fullName: id,
    id,
    normalizedName: id,
    requestedRole: "player",
    updatedAt: NOW,
  }).run()
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

describe("random Academy ID allocation", () => {
  it("allocates independent role-prefixed junior-coach and player usernames", () => {
    createAccount("junior")
    createAccount("player")
    expect(allocateRandomAcademyId({
      accountId: "junior",
      chooseIndex: () => 0,
      database,
      now: NOW,
      role: "coach",
      rolePrefixed: true,
    })).toEqual({ academyId: "SMBA-JC-0001", serial: 10_001 })
    expect(allocateRandomAcademyId({
      accountId: "player",
      chooseIndex: () => 0,
      database,
      now: NOW,
      role: "player",
      rolePrefixed: true,
    })).toEqual({ academyId: "SMBA-PL-0001", serial: 20_001 })
  })

  it("permanently reserves SMBA#0001 and allocates only within 0002–9999", () => {
    createAccount("head")
    createAccount("first-player")
    createAccount("last-player")
    database.insert(schema.academyIdAllocations).values({
      accountId: "head",
      createdAt: NOW,
      serial: 1,
    }).run()

    expect(allocateRandomAcademyId({
      accountId: "first-player",
      chooseIndex: () => 0,
      database,
      now: NOW,
    })).toEqual({ academyId: "SMBA#0002", serial: 2 })
    expect(allocateRandomAcademyId({
      accountId: "last-player",
      chooseIndex: (availableCount) => availableCount - 1,
      database,
      now: NOW,
    })).toEqual({ academyId: "SMBA#9999", serial: 9999 })
  })

  it("skips occupied IDs before choosing a collision-free value", () => {
    createAccount("head")
    createAccount("occupied-two")
    createAccount("next-player")
    database.insert(schema.academyIdAllocations).values([
      { accountId: "head", createdAt: NOW, serial: 1 },
      { accountId: "occupied-two", createdAt: NOW, serial: 2 },
    ]).run()

    const chooseIndex = vi.fn(() => 0)
    expect(allocateRandomAcademyId({
      accountId: "next-player",
      chooseIndex,
      database,
      now: NOW,
    })).toEqual({ academyId: "SMBA#0003", serial: 3 })
    expect(chooseIndex).toHaveBeenCalledWith(9_997)
  })

  it("fails cleanly without writing when the assignable ID range is exhausted", () => {
    createAccount("waiting-player")
    sqlite.exec(`
      with recursive numbers(value) as (
        select 2
        union all
        select value + 1 from numbers where value < 9999
      )
      insert into accounts (
        id, full_name, normalized_name, requested_role, approval_status, created_at, updated_at
      )
      select 'occupied-' || value, 'Occupied ' || value, 'occupied ' || value,
        'player', 'approved', ${NOW.getTime()}, ${NOW.getTime()}
      from numbers;

      with recursive numbers(value) as (
        select 2
        union all
        select value + 1 from numbers where value < 9999
      )
      insert into academy_id_allocations (serial, account_id, created_at)
      select value, 'occupied-' || value, ${NOW.getTime()} from numbers;
    `)

    expect(() => allocateRandomAcademyId({
      accountId: "waiting-player",
      database,
      now: NOW,
    })).toThrow("No Academy IDs are currently available.")
    expect(database.select().from(schema.academyIdAllocations).all()).toHaveLength(9_998)
  })
})
