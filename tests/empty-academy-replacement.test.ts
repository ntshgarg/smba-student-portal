import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { PLATFORM_ADMIN_ACADEMY_ID } from "@/lib/auth/identity"
import * as schema from "@/lib/db/schema"
import { seedReferenceData } from "@/lib/db/seed"
import {
  PLATFORM_OWNER_ACADEMY_ID,
  contentFingerprint,
  contentFingerprintQuery,
} from "@/scripts/deployment/academy-owner.mjs"

/*
 * The manual way to empty the academy is two scripts run some time apart:
 * prepare-admin-only-snapshot.mjs copies the live database and strips it to the
 * owner, then reset-empty-academy.mjs backs the live database up, wipes it and
 * loads the copy. libsql opens a local file as readily as a Turso URL, so the
 * "live database" here is a file standing in for production.
 */

const execute = promisify(execFile)
const prepareScript = new URL("../scripts/deployment/prepare-admin-only-snapshot.mjs", import.meta.url).pathname
const resetScript = new URL("../scripts/deployment/reset-empty-academy.mjs", import.meta.url).pathname
const NOW = new Date("2026-11-13T10:00:00+05:30").getTime()
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1"
const workspaces: string[] = []

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-replace-"))
  workspaces.push(directory)
  return directory
}

function account(sqlite: Database.Database, id: string, role: "player" | "coach" | "platform_admin") {
  sqlite.prepare(`
    insert into accounts (id, full_name, normalized_name, requested_role, role, approval_status,
      approved_at, created_at, updated_at)
    values (?, ?, ?, ?, ?, 'approved', ?, ?, ?)
  `).run(id, id, id, role, role, NOW, NOW, NOW)
  sqlite.prepare(`
    insert into auth_users (id, name, email, email_verified, username, display_username,
      two_factor_enabled, created_at, updated_at)
    values (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    id, id, `${id}@accounts.smba.invalid`,
    role === "platform_admin" ? "SMBA-ADMIN-0001" : id,
    role === "platform_admin" ? "SMBA-ADMIN-0001" : id,
    role === "platform_admin" ? 1 : 0,
    NOW, NOW,
  )
}

/** A live academy: the owner with a paired phone, a head coach and a player. */
function liveAcademy(directory: string, ownerId = OWNER_ID) {
  const file = path.join(directory, "live.db")
  const sqlite = new Database(file)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedReferenceData(drizzle(sqlite, { schema }))

  account(sqlite, ownerId, "platform_admin")
  sqlite.prepare("insert into auth_methods (id, account_id, method, identifier, created_at) values (?, ?, 'academy_id', ?, ?)")
    .run("method-owner", ownerId, "SMBA-ADMIN-0001", NOW)
  sqlite.prepare(`
    insert into auth_provider_accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
    values (?, ?, 'credential', ?, ?, ?, ?)
  `).run("password-owner", ownerId, ownerId, "owner-password-hash", NOW, NOW)
  sqlite.prepare("insert into auth_pin_credentials (account_id, pin_hash, created_at, updated_at) values (?, ?, ?, ?)")
    .run(ownerId, "owner-pin-hash", NOW, NOW)
  sqlite.prepare("insert into auth_recovery_emails (account_id, email, verified_at, created_at, updated_at) values (?, ?, ?, ?, ?)")
    .run(ownerId, "owner@example.com", NOW, NOW, NOW)
  sqlite.prepare("insert into auth_two_factors (id, user_id, secret, backup_codes, verified) values (?, ?, ?, ?, 1)")
    .run("tf-owner", ownerId, "OUTGOING-OPERATOR-PHONE", "codes")

  account(sqlite, "coach-one", "coach")
  sqlite.prepare(`
    insert into coach_profiles (account_id, access_level, joined_on, created_at, updated_at)
    values (?, 'head_admin', '2026-01-01', ?, ?)
  `).run("coach-one", NOW, NOW)
  account(sqlite, "player-one", "player")
  sqlite.close()
  return file
}

async function prepareCopy(live: string, output: string) {
  return execute("node", [prepareScript, output], {
    env: {
      ...process.env,
      SMBA_CONFIRM_ADMIN_ONLY_SNAPSHOT: "PREPARE-ADMIN-ONLY-SNAPSHOT",
      TURSO_AUTH_TOKEN: "local-test-token",
      TURSO_DATABASE_URL: live,
    },
  })
}

async function replaceLive(live: string, copy: string, backup: string) {
  return execute("node", [resetScript, copy, backup], {
    env: {
      ...process.env,
      SMBA_CONFIRM_REMOTE_EMPTY_RESET: "RESET-TO-EMPTY-ACADEMY",
      TURSO_AUTH_TOKEN: "local-test-token",
      TURSO_DATABASE_URL: live,
    },
  })
}

function total(file: string, query: string, ...parameters: unknown[]) {
  const sqlite = new Database(file, { readonly: true })
  const row = sqlite.prepare(query).get(...parameters) as { total: number }
  sqlite.close()
  return row.total
}

describe("the manual empty-academy route", () => {
  it("names the owner the same way as the reset button", () => {
    expect(PLATFORM_OWNER_ACADEMY_ID).toBe(PLATFORM_ADMIN_ACADEMY_ID)
  })

  it("removes the owner's authenticator, as the 'Empty the academy' button does", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const copy = path.join(directory, "owner-only.db")

    await prepareCopy(live, copy)

    // The outgoing operator's phone must not keep producing the owner's codes.
    expect(total(copy, "select count(*) as total from auth_two_factors")).toBe(0)
    expect(total(copy, "select two_factor_enabled as total from auth_users where id = ?", OWNER_ID)).toBe(0)
    // What the owner signs in with to pair a new phone survives.
    expect(total(copy, "select count(*) as total from auth_pin_credentials")).toBe(1)
    expect(total(copy, "select count(*) as total from auth_provider_accounts")).toBe(1)
    expect(total(copy, "select count(*) as total from accounts")).toBe(1)
    // Reading the live database never changed it.
    expect(total(live, "select count(*) as total from auth_two_factors")).toBe(1)
  }, 60_000)

  it("replaces the live academy and keeps its update history and a backup", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const copy = path.join(directory, "owner-only.db")
    const backup = path.join(directory, "pre-reset.db")
    const historyBefore = total(live, "select count(*) as total from __drizzle_migrations")

    await prepareCopy(live, copy)
    await replaceLive(live, copy, backup)

    expect(total(live, "select count(*) as total from accounts")).toBe(1)
    expect(total(live, "select count(*) as total from coach_profiles")).toBe(0)
    expect(total(live, "select count(*) as total from auth_two_factors")).toBe(0)
    expect(total(live, "select count(*) as total from __drizzle_migrations")).toBe(historyBefore)
    // The backup is the academy as it was, owner's phone and all.
    expect(total(backup, "select count(*) as total from accounts")).toBe(3)
    expect(total(backup, "select count(*) as total from auth_two_factors")).toBe(1)
  }, 60_000)

  /*
   * The finding that mattered: an update released between the two steps was
   * rolled back in the live database's update history while its changes
   * stayed, and every later deploy then failed trying to apply it again.
   */
  it("refuses, and leaves no backup file behind, when an update shipped after the copy was made", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const copy = path.join(directory, "owner-only.db")
    const backup = path.join(directory, "pre-reset.db")
    await prepareCopy(live, copy)

    const sqlite = new Database(live)
    sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
      .run("a-later-update", NOW + 1)
    sqlite.close()

    await expect(replaceLive(live, copy, backup))
      .rejects.toThrow(/has had an update since the prepared copy was made/u)
    expect(total(live, "select count(*) as total from accounts")).toBe(3)
    // A failed attempt must not leave a "backup" that blocks the retry.
    expect(fs.existsSync(backup)).toBe(false)
  }, 60_000)

  it("refuses when an update changed a table after the copy was made", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const copy = path.join(directory, "owner-only.db")
    const backup = path.join(directory, "pre-reset.db")
    await prepareCopy(live, copy)

    const sqlite = new Database(live)
    sqlite.exec("alter table batches add column colour text")
    sqlite.close()

    await expect(replaceLive(live, copy, backup)).rejects.toThrow(/table layout differs/u)
    expect(total(live, "select count(*) as total from accounts")).toBe(3)
    expect(fs.existsSync(backup)).toBe(false)
  }, 60_000)

  it("refuses rather than bring back the owner's old PIN", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const copy = path.join(directory, "owner-only.db")
    const backup = path.join(directory, "pre-reset.db")
    await prepareCopy(live, copy)

    const sqlite = new Database(live)
    sqlite.prepare("update auth_pin_credentials set pin_hash = ? where account_id = ?").run("new-pin-hash", OWNER_ID)
    sqlite.close()

    await expect(replaceLive(live, copy, backup)).rejects.toThrow(/PIN, recovery email or sign-in name changed/u)
    expect(total(live, "select count(*) as total from accounts")).toBe(3)
  }, 60_000)

  it("refuses rather than undo locking the owner out after a suspected compromise", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const sqlite = new Database(live)
    sqlite.prepare("insert into auth_credential_states (account_id, status, activated_at, updated_at) values (?, 'active', ?, ?)")
      .run(OWNER_ID, NOW, NOW)
    sqlite.close()
    const copy = path.join(directory, "owner-only.db")
    const backup = path.join(directory, "pre-reset.db")
    await prepareCopy(live, copy)

    const after = new Database(live)
    after.prepare("update auth_credential_states set status = 'revoked' where account_id = ?").run(OWNER_ID)
    after.close()

    await expect(replaceLive(live, copy, backup)).rejects.toThrow(/sign-in was marked for reset or revoked/u)
    expect(total(live, "select status as total from auth_credential_states where account_id = ?", OWNER_ID))
      .toBe("revoked")
    expect(fs.existsSync(backup)).toBe(false)
  }, 60_000)

  /*
   * The backup is read without the write lock, because Turso ends a write
   * transaction after a few seconds. The reset then proves under the lock that
   * nothing was saved since, using this one-request summary of every row.
   */
  it("notices anything saved after the backup was read", () => {
    const directory = workspace()
    const sqlite = new Database(liveAcademy(directory))
    const tables = (sqlite.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as Array<{ name: string }>).map((table) => table.name)
    const query = contentFingerprintQuery(sqlite, tables)
    const before = contentFingerprint(sqlite, query)
    expect(contentFingerprint(sqlite, query)).toBe(before)

    // A status edit that keeps the same length still shows.
    sqlite.prepare("update accounts set approval_status = 'rejected' where id = ?").run("player-one")
    const edited = contentFingerprint(sqlite, query)
    expect(edited).not.toBe(before)

    // So does a new row, and a changed amount or time.
    account(sqlite, "player-two", "player")
    const added = contentFingerprint(sqlite, query)
    expect(added).not.toBe(edited)
    sqlite.prepare("update accounts set updated_at = updated_at + 1 where id = ?").run("player-two")
    expect(contentFingerprint(sqlite, query)).not.toBe(added)
    sqlite.close()
  })

  it("refuses a copy prepared from a different academy", async () => {
    const directory = workspace()
    const live = liveAcademy(directory)
    const elsewhere = workspace()
    const otherLive = liveAcademy(elsewhere, "00000000-0000-4000-8000-0000000000b2")
    const copy = path.join(elsewhere, "owner-only.db")
    const backup = path.join(directory, "pre-reset.db")
    await prepareCopy(otherLive, copy)

    await expect(replaceLive(live, copy, backup)).rejects.toThrow(/made from a different academy/u)
    expect(total(live, "select count(*) as total from accounts")).toBe(3)
  }, 60_000)
})
