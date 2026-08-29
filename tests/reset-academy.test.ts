import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, describe, expect, it, vi } from "vitest"

// The seed helper reaches the auth services, which are server-only modules.
vi.mock("server-only", () => ({}))

import { seedReferenceData } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"

/*
 * `reset-academy.ts` is the one script here that destroys production data and
 * cannot put it back, so its refusals matter more than its happy path. Each
 * case below is a way somebody could lose an academy by accident: running it
 * against the wrong database, running it before reading what it would do, or
 * running it after a migration added a table it has never heard of.
 */

const execute = promisify(execFile)
const script = new URL("../scripts/database/reset-academy.ts", import.meta.url).pathname
const NOW = new Date("2026-08-28T10:00:00+05:30")
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1"
const workspaces: string[] = []

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

function academyDatabase({ owner = true }: { owner?: boolean } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-reset-"))
  workspaces.push(directory)
  const file = path.join(directory, "academy.db")
  const sqlite = new Database(file)
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  // Batches are the reference data a reset must leave behind, so the fixture
  // has to actually contain some for that assertion to mean anything.
  seedReferenceData(database)

  function account(id: string, role: "player" | "coach" | "platform_admin") {
    database.insert(schema.accounts).values({
      approvalStatus: "approved",
      approvedAt: NOW,
      createdAt: NOW,
      fullName: id,
      id,
      normalizedName: id,
      requestedRole: role === "platform_admin" ? "platform_admin" : role,
      role,
      updatedAt: NOW,
    }).run()
    database.insert(schema.authUsers).values({
      createdAt: NOW,
      email: `${id}@accounts.smba.invalid`,
      emailVerified: true,
      id,
      name: id,
      twoFactorEnabled: false,
      updatedAt: NOW,
      username: role === "platform_admin" ? "SMBA-ADMIN-0001" : id,
    }).run()
  }

  if (owner) account(OWNER_ID, "platform_admin")
  account("player-one", "player")
  account("coach-one", "coach")
  sqlite.close()
  return { directory, file }
}

async function run(file: string, args: string[] = []) {
  return execute("npx", ["tsx", script, ...args], {
    env: {
      ...process.env,
      DB_FILE_NAME: file,
      NODE_OPTIONS: "--conditions=react-server",
      NODE_PATH: "./node_modules/next/dist/compiled",
    },
  })
}

function accountCount(file: string) {
  const sqlite = new Database(file, { readonly: true })
  const row = sqlite.prepare("select count(*) as total from accounts").get() as { total: number }
  sqlite.close()
  return row.total
}

describe("resetting an academy in place", () => {
  it("changes nothing without --confirm, and says how to proceed", async () => {
    const { file } = academyDatabase()
    const { stdout } = await run(file)

    expect(stdout).toContain("Dry run. Nothing was changed.")
    expect(stdout).toContain("--confirm SMBA-ADMIN-0001")
    expect(accountCount(file)).toBe(3)
  }, 60_000)

  it("keeps only the platform owner once confirmed", async () => {
    const { file } = academyDatabase()
    const { stdout } = await run(file, ["--confirm", "SMBA-ADMIN-0001"])

    expect(stdout).toContain("Academy emptied")
    expect(accountCount(file)).toBe(1)

    const sqlite = new Database(file, { readonly: true })
    const kept = sqlite.prepare("select id, role from accounts").all() as Array<{ id: string; role: string }>
    // Batches are reference data every academy needs, so they survive.
    const batches = sqlite.prepare("select count(*) as total from batches").get() as { total: number }
    sqlite.close()

    expect(kept).toEqual([{ id: OWNER_ID, role: "platform_admin" }])
    expect(batches.total).toBeGreaterThan(0)
  }, 60_000)

  it("takes the owner's authenticator so the next holder enrols their own", async () => {
    const { file } = academyDatabase()
    const seeded = new Database(file)
    seeded.prepare(
      "insert into auth_two_factors (id, user_id, secret, backup_codes) values (?, ?, ?, ?)",
    ).run("tf-owner", OWNER_ID, "SECRET", "codes")
    seeded.prepare("update auth_users set two_factor_enabled = 1 where id = ?").run(OWNER_ID)
    // A PIN the owner already set, so "the PIN survives" is an assertion about
    // behaviour rather than about an empty table.
    seeded.prepare(
      "insert into auth_pin_credentials (account_id, pin_hash, created_at, updated_at) values (?, ?, ?, ?)",
    ).run(OWNER_ID, "hashed-pin", NOW.getTime(), NOW.getTime())
    seeded.close()

    await run(file, ["--confirm", "SMBA-ADMIN-0001"])

    const sqlite = new Database(file, { readonly: true })
    const factors = sqlite.prepare("select count(*) as total from auth_two_factors").get() as { total: number }
    const owner = sqlite.prepare("select two_factor_enabled as enabled from auth_users where id = ?")
      .get(OWNER_ID) as { enabled: number }
    // The flag has to fall with the row: better-auth reads it to decide whether
    // the account has an authenticator, and one claiming a secret it no longer
    // holds cannot sign in at all.
    const credentials = sqlite.prepare("select count(*) as total from auth_pin_credentials").get() as { total: number }
    sqlite.close()

    expect(factors.total).toBe(0)
    expect(owner.enabled).toBe(0)
    // The PIN survives: it is what the owner signs in with to enrol the
    // replacement authenticator.
    expect(credentials.total).toBe(1)
  }, 60_000)

  it("refuses when --confirm names a different academy", async () => {
    const { file } = academyDatabase()

    await expect(run(file, ["--confirm", "SMBA-ADMIN-0002"]))
      .rejects.toThrow(/Refusing to reset a database other than the one you named/u)
    expect(accountCount(file)).toBe(3)
  }, 60_000)

  it("refuses when there is no platform owner to keep", async () => {
    const { file } = academyDatabase({ owner: false })

    await expect(run(file, ["--confirm", "SMBA-ADMIN-0001"]))
      .rejects.toThrow(/Expected exactly one approved platform owner, found 0/u)
    expect(accountCount(file)).toBe(2)
  }, 60_000)

  it("refuses when a table it has never been told about exists", async () => {
    const { file } = academyDatabase()
    const sqlite = new Database(file)
    sqlite.exec("create table academy_notes (id text primary key)")
    sqlite.close()

    await expect(run(file, ["--confirm", "SMBA-ADMIN-0001"]))
      .rejects.toThrow(/not classified by this script: academy_notes/u)
    expect(accountCount(file)).toBe(3)
  }, 60_000)
})
