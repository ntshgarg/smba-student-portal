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

/*
 * The two remote-reset variables are pinned to "absent" rather than inherited,
 * because the script now refuses outright when TURSO_DATABASE_URL is set
 * without SMBA_CONFIRM_REMOTE_RESET. A developer shell that happens to hold
 * Turso credentials -- exactly the shell the guard exists for -- would
 * otherwise collapse every case below into that one refusal. Cases that want
 * the remote shape ask for it through `overrides`.
 */
async function run(
  file: string,
  args: string[] = [],
  overrides: Record<string, string | undefined> = {},
) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DB_FILE_NAME: file,
    NODE_OPTIONS: "--conditions=react-server",
    NODE_PATH: "./node_modules/next/dist/compiled",
    SMBA_CONFIRM_REMOTE_RESET: undefined,
    SMBA_USE_TURSO: undefined,
    TURSO_AUTH_TOKEN: undefined,
    TURSO_DATABASE_URL: undefined,
    ...overrides,
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key]
  }

  return execute("npx", ["tsx", script, ...args], { env: env as NodeJS.ProcessEnv })
}

/*
 * `--confirm` alone no longer empties anything: the owner's Academy ID is a
 * compile-time constant, so the database has to be named as well. Every
 * destructive invocation below goes through this, which means the argument
 * list a passing test proves is the argument list an operator has to type.
 */
function emptyArgs(file: string, academyId = "SMBA-ADMIN-0001") {
  return ["--confirm", academyId, "--confirm-target", file]
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
    // The whole command, not half of it: an operator who copies this line has
    // to be handed the argument list that actually works.
    expect(stdout).toContain(`--confirm SMBA-ADMIN-0001 --confirm-target ${file}`)
    expect(accountCount(file)).toBe(3)
  }, 60_000)

  it("keeps only the platform owner once confirmed", async () => {
    const { file } = academyDatabase()
    const { stdout } = await run(file, emptyArgs(file))

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

    await run(file, emptyArgs(file))

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

    await expect(run(file, emptyArgs(file, "SMBA-ADMIN-0002")))
      .rejects.toThrow(/Refusing to reset a database other than the one you named/u)
    expect(accountCount(file)).toBe(3)
  }, 60_000)

  /*
   * The gap --confirm on its own cannot close. `SMBA-ADMIN-0001` is
   * PLATFORM_ADMIN_ACADEMY_ID, and the script throws when the owner's username
   * is anything else -- so the same six words empty a scratch fixture and the
   * live academy, and the operator who types them has demonstrated only that
   * they can read a constant. The database has to be named too.
   */
  it("refuses when --confirm-target is absent, however correct --confirm is", async () => {
    const { file } = academyDatabase()

    await expect(run(file, ["--confirm", "SMBA-ADMIN-0001"]))
      .rejects.toThrow(`This database is ${file}`)
    expect(accountCount(file)).toBe(3)
  }, 60_000)

  it("refuses when --confirm-target names a database this is not", async () => {
    const { file } = academyDatabase()
    const other = academyDatabase()

    await expect(run(file, ["--confirm", "SMBA-ADMIN-0001", "--confirm-target", other.file]))
      .rejects.toThrow(`This database is ${file}`)
    expect(accountCount(file)).toBe(3)
    expect(accountCount(other.file)).toBe(3)
  }, 60_000)

  it("refuses when there is no platform owner to keep", async () => {
    const { file } = academyDatabase({ owner: false })

    await expect(run(file, emptyArgs(file)))
      .rejects.toThrow(/Expected exactly one approved platform owner, found 0/u)
    expect(accountCount(file)).toBe(2)
  }, 60_000)

  it("refuses when a table it has never been told about exists", async () => {
    const { file } = academyDatabase()
    const sqlite = new Database(file)
    sqlite.exec("create table academy_notes (id text primary key)")
    sqlite.close()

    await expect(run(file, emptyArgs(file)))
      .rejects.toThrow(/not classified by this script: academy_notes/u)
    expect(accountCount(file)).toBe(3)
  }, 60_000)
})

describe("verifying an academy is empty", () => {
  it("passes on an emptied academy even after live traffic writes to it", async () => {
    const { file } = academyDatabase()
    await run(file, emptyArgs(file))

    // The site stays live through a reset, so a visitor reaching the login page
    // writes rows straight afterwards. Those must not read as survivors.
    const traffic = new Database(file)
    traffic.prepare(
      "insert into auth_login_attempts (key, failed_count, window_started_at, updated_at)"
      + " values (?, ?, ?, ?)",
    ).run("ip:1.2.3.4", 1, NOW.getTime(), NOW.getTime())
    traffic.close()

    const { stdout } = await run(file, ["--verify"])
    expect(stdout).toContain("The academy is empty")
  }, 60_000)

  it("fails while academy records remain", async () => {
    const { file } = academyDatabase()

    await expect(run(file, ["--verify"])).rejects.toThrow(/still present/u)
  }, 60_000)
})

/*
 * `npm run db:reset:academy` loads .env.local (package.json:9). An operator
 * whose .env.local holds the production Turso credentials is one unset variable
 * -- SMBA_USE_TURSO -- away from emptying the live academy, and nothing about
 * the command mentions that variable. So the refusal is keyed on the
 * credentials being *present*, not on them being switched on.
 */
describe("refusing to run beside remote credentials", () => {
  const REMOTE = "libsql://academy-live.turso.io"

  it("refuses a correctly confirmed reset while Turso credentials are in scope", async () => {
    const { file } = academyDatabase()

    await expect(run(file, emptyArgs(file), { TURSO_DATABASE_URL: REMOTE }))
      .rejects.toThrow(/requires SMBA_CONFIRM_REMOTE_RESET=1/u)
    // Refused before initializeDatabase() opened anything, so the local
    // fixture is untouched as well as the remote academy.
    expect(accountCount(file)).toBe(3)
  }, 60_000)

  it("refuses the read-only modes too, because that token can still write", async () => {
    const { file } = academyDatabase()

    await expect(run(file, [], { TURSO_DATABASE_URL: REMOTE }))
      .rejects.toThrow(/requires SMBA_CONFIRM_REMOTE_RESET=1/u)
    await expect(run(file, ["--verify"], { TURSO_DATABASE_URL: REMOTE }))
      .rejects.toThrow(/requires SMBA_CONFIRM_REMOTE_RESET=1/u)
  }, 60_000)

  /*
   * Once opted in, --confirm-target has to name what the client will actually
   * open. shouldUseTurso() needs SMBA_USE_TURSO=true as well as the URL, so
   * with the URL alone the run still lands on the local file -- and telling the
   * operator to type the remote URL there would make the confirmation describe
   * a database this run never touches.
   */
  it("names the database it will open, not the credentials lying beside it", async () => {
    const { file } = academyDatabase()
    const { stdout } = await run(file, [], {
      SMBA_CONFIRM_REMOTE_RESET: "1",
      TURSO_DATABASE_URL: REMOTE,
    })

    expect(stdout).toContain(`--confirm-target ${file}`)
    expect(stdout).not.toContain(REMOTE)
  }, 60_000)
})
