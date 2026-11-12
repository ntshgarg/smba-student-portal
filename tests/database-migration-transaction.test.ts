import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterAll, describe, expect, it, vi } from "vitest"

import * as schema from "@/lib/db/schema"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-migration-transaction-"))
const migrationsFolder = path.resolve(process.cwd(), "drizzle")

function openDatabase(name: string) {
  const sqlite = new BetterSqlite3(path.join(temporaryDirectory, name))
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  return { database: drizzle(sqlite, { schema }), sqlite }
}

function ledger(sqlite: BetterSqlite3.Database) {
  return sqlite.prepare(`
    SELECT hash, created_at AS createdAt
    FROM "__drizzle_migrations"
    ORDER BY created_at
  `).all()
}

describe("database update", () => {
  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("decides which changes are still to apply inside the transaction that applies them", async () => {
    const { prepareDatabase } = await import("@/lib/db/setup")
    const { database, sqlite } = openDatabase("deploy.db")

    // Record whether the database was inside a transaction each time the
    // ledger of applied changes was read. A concurrent deploy that commits
    // between an outside read and BEGIN would otherwise be applied twice.
    const ledgerReads: boolean[] = []
    const prepare = sqlite.prepare.bind(sqlite)
    sqlite.prepare = ((source: string) => {
      if (/^\s*SELECT\b[\s\S]*"__drizzle_migrations"/i.test(source)) {
        ledgerReads.push(sqlite.inTransaction)
      }
      return prepare(source)
    }) as typeof sqlite.prepare

    prepareDatabase({ database })

    expect(ledgerReads.length).toBeGreaterThan(0)
    expect(ledgerReads.every(Boolean)).toBe(true)
    sqlite.close()
  }, 60_000)

  it("writes the same record of applied changes as drizzle and skips what is already applied", async () => {
    const { applyMigrations } = await import("@/lib/db/setup")
    const ours = openDatabase("ours.db")
    const theirs = openDatabase("theirs.db")

    applyMigrations(ours.database, migrationsFolder)
    migrate(theirs.database, { migrationsFolder })
    expect(ledger(ours.sqlite)).toEqual(ledger(theirs.sqlite))

    // Running again, or over a database drizzle prepared, changes nothing.
    applyMigrations(ours.database, migrationsFolder)
    applyMigrations(theirs.database, migrationsFolder)
    expect(ledger(ours.sqlite)).toEqual(ledger(theirs.sqlite))
    expect(ours.sqlite.inTransaction).toBe(false)

    ours.sqlite.close()
    theirs.sqlite.close()
  }, 60_000)

  it("leaves the database unchanged when a change fails part way", async () => {
    const { applyMigrations } = await import("@/lib/db/setup")
    const { database, sqlite } = openDatabase("broken.db")
    const brokenFolder = path.join(temporaryDirectory, "broken-migrations")
    fs.mkdirSync(path.join(brokenFolder, "meta"), { recursive: true })
    fs.writeFileSync(path.join(brokenFolder, "0000_ok.sql"), "CREATE TABLE kept_out (id integer);")
    fs.writeFileSync(path.join(brokenFolder, "0001_bad.sql"), "CREATE TABLE kept_out (id integer);")
    fs.writeFileSync(path.join(brokenFolder, "meta", "_journal.json"), JSON.stringify({
      dialect: "sqlite",
      entries: [
        { breakpoints: true, idx: 0, tag: "0000_ok", version: "6", when: 1 },
        { breakpoints: true, idx: 1, tag: "0001_bad", version: "6", when: 2 },
      ],
      version: "7",
    }))

    expect(() => applyMigrations(database, brokenFolder)).toThrow()
    expect(sqlite.inTransaction).toBe(false)
    expect(sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE name IN ('kept_out', '__drizzle_migrations')
    `).all()).toEqual([])
    sqlite.close()
  }, 60_000)
})
