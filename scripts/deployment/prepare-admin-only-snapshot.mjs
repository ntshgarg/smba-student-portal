// Builds the source that reset-empty-academy.mjs loads into the live database:
// a local copy of the academy holding the platform owner and nothing else.
//
// It reads the remote and never writes to it. The copy keeps the owner's
// account, password, PIN, recovery email and Academy ID allocation, plus the
// batch catalogue and the update history. It does not keep the owner's
// authenticator app: a handover must not pass on a phone that is still paired to
// the outgoing operator, so whoever holds the account next pairs their own on
// the next sign-in. scripts/database/reset-academy.ts -- the "Empty the academy"
// button -- does exactly the same, so both routes hand over the same account.
//
// Procedure: docs/PRODUCTION-OPERATIONS.md, "Resetting the academy to an empty
// state".

import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

import {
  PLATFORM_OWNER_ACADEMY_ID,
  readConsistently,
  soleOwnerQuery,
} from "./academy-owner.mjs"

const CONFIRMATION = "PREPARE-ADMIN-ONLY-SNAPSHOT"
const outputArgument = process.argv[2]
const databaseUrl = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()

if (process.env.SMBA_CONFIRM_ADMIN_ONLY_SNAPSHOT !== CONFIRMATION) {
  throw new Error(`Set SMBA_CONFIRM_ADMIN_ONLY_SNAPSHOT=${CONFIRMATION} to authorize this snapshot.`)
}
if (!outputArgument) throw new Error("Provide a new local SQLite snapshot path.")
if (!databaseUrl) throw new Error("TURSO_DATABASE_URL is required.")
if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required.")

const outputPath = path.resolve(process.cwd(), outputArgument)
if (fs.existsSync(outputPath)) throw new Error("The requested snapshot path already exists.")
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.closeSync(fs.openSync(outputPath, "wx", 0o600))

const source = new LibsqlDatabase(databaseUrl, { authToken })
const snapshot = new BetterSqlite3(outputPath)
const INSERT_BATCH_SIZE = 50
const PRESERVED_TABLES = new Set([
  "__drizzle_migrations",
  "accounts",
  "academy_id_allocations",
  "auth_credential_states",
  "auth_methods",
  "auth_pin_credentials",
  "auth_provider_accounts",
  "auth_recovery_emails",
  "auth_users",
  "batches",
])

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function schemaObjects(database) {
  const tables = database.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY rowid
  `).all()
  const indexes = database.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY name
  `).all()
  return { indexes, tables }
}

function insertRows(database, tableName, rows) {
  if (!rows.length) return 0
  const columns = Object.keys(rows[0])
  const valuePlaceholders = `(${columns.map(() => "?").join(", ")})`
  let inserted = 0
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE)
    database.prepare(`
      INSERT INTO ${quoteIdentifier(tableName)}
        (${columns.map(quoteIdentifier).join(", ")})
      VALUES ${batch.map(() => valuePlaceholders).join(", ")}
    `).run(...batch.flatMap((row) => columns.map((column) => row[column])))
    inserted += batch.length
  }
  return inserted
}

function count(database, query, ...parameters) {
  return Number(database.prepare(query).get(...parameters).count)
}

let completed = false

try {
  // One read transaction, so every table is copied as of the same moment. Read
  // table by table on a live site, a row could arrive in one table after its
  // neighbour had already been copied, and the copy would fail its own checks.
  const { rows, schema } = readConsistently(source, () => {
    const schema = schemaObjects(source)
    return {
      rows: Object.fromEntries(schema.tables.map(({ name }) => [
        name,
        source.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all(),
      ])),
      schema,
    }
  })
  let copiedRows = 0

  snapshot.pragma("foreign_keys = OFF")
  const clone = snapshot.transaction(() => {
    for (const table of schema.tables) snapshot.exec(table.sql)
    for (const table of schema.tables) copiedRows += insertRows(snapshot, table.name, rows[table.name])
    for (const index of schema.indexes) snapshot.exec(index.sql)
  })
  clone.immediate()

  // The same rule scripts/database/reset-academy.ts uses to name the owner, so
  // the two routes can never disagree about which account survives.
  const owners = snapshot.prepare(soleOwnerQuery).all()
  if (owners.length !== 1) {
    throw new Error(`Expected exactly one approved platform owner, found ${owners.length}.`)
  }
  const owner = owners[0]
  if (owner.username !== PLATFORM_OWNER_ACADEMY_ID) {
    throw new Error(
      `The platform owner signs in as ${owner.username ?? "(no username)"}, not ${PLATFORM_OWNER_ACADEMY_ID}.`,
    )
  }

  const sanitize = snapshot.transaction(() => {
    for (const table of schema.tables) {
      if (!PRESERVED_TABLES.has(table.name)) {
        snapshot.prepare(`DELETE FROM ${quoteIdentifier(table.name)}`).run()
      }
    }

    snapshot.prepare("DELETE FROM auth_provider_accounts WHERE user_id <> ?").run(owner.id)
    snapshot.prepare("DELETE FROM auth_users WHERE id <> ?").run(owner.id)
    // The authenticator row went with every other non-preserved table above.
    // The flag has to fall with it: an account claiming an authenticator it no
    // longer has cannot sign in at all.
    snapshot.prepare("UPDATE auth_users SET two_factor_enabled = 0 WHERE id = ?").run(owner.id)

    for (const table of [
      "academy_id_allocations",
      "auth_credential_states",
      "auth_methods",
      "auth_pin_credentials",
      "auth_recovery_emails",
    ]) {
      snapshot.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE account_id <> ?`).run(owner.id)
    }
    snapshot.prepare("DELETE FROM accounts WHERE id <> ?").run(owner.id)
    snapshot.prepare("DELETE FROM sqlite_sequence").run()
  })
  sanitize.immediate()
  snapshot.pragma("foreign_keys = ON")

  const result = {
    accounts: count(snapshot, "SELECT count(*) AS count FROM accounts"),
    authenticators: count(snapshot, "SELECT count(*) AS count FROM auth_two_factors"),
    authenticatorFlag: count(snapshot, "SELECT count(*) AS count FROM auth_users WHERE two_factor_enabled <> 0"),
    batches: count(snapshot, "SELECT count(*) AS count FROM batches"),
    headCoaches: count(snapshot, "SELECT count(*) AS count FROM coach_profiles"),
    pinCredentials: count(snapshot, "SELECT count(*) AS count FROM auth_pin_credentials WHERE account_id = ?", owner.id),
    platformAdmins: count(snapshot, "SELECT count(*) AS count FROM accounts WHERE role = 'platform_admin'"),
    players: count(snapshot, "SELECT count(*) AS count FROM player_enrollments"),
    recoveryEmails: count(snapshot, "SELECT count(*) AS count FROM auth_recovery_emails WHERE account_id = ?", owner.id),
  }
  if (result.accounts !== 1
    || result.platformAdmins !== 1
    || result.headCoaches !== 0
    || result.players !== 0
    || result.pinCredentials !== 1
    || result.recoveryEmails !== 1
    || result.authenticators !== 0
    || result.authenticatorFlag !== 0) {
    throw new Error(`Admin-only snapshot verification failed: ${JSON.stringify(result)}`)
  }

  const integrity = snapshot.pragma("integrity_check", { simple: true })
  if (integrity !== "ok") throw new Error(`Snapshot integrity check failed: ${integrity}`)
  const foreignKeyFailures = snapshot.pragma("foreign_key_check")
  if (foreignKeyFailures.length) {
    throw new Error(`Snapshot foreign-key check failed: ${JSON.stringify(foreignKeyFailures)}`)
  }
  fs.chmodSync(outputPath, 0o600)
  completed = true
  console.log(JSON.stringify({ copiedRows, outputPath, result }))
} finally {
  if (snapshot.open) snapshot.close()
  source.close()
  if (!completed && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
}
