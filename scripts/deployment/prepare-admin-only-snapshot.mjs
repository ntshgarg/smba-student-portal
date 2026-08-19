import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

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
  "auth_two_factors",
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
  const schema = schemaObjects(source)
  let copiedRows = 0

  snapshot.pragma("foreign_keys = OFF")
  const clone = snapshot.transaction(() => {
    for (const table of schema.tables) snapshot.exec(table.sql)
    for (const table of schema.tables) {
      copiedRows += insertRows(
        snapshot,
        table.name,
        source.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all(),
      )
    }
    for (const index of schema.indexes) snapshot.exec(index.sql)
  })
  clone.immediate()

  const admins = snapshot.prepare(`
    SELECT accounts.id, auth_methods.identifier
    FROM accounts
    INNER JOIN auth_methods
      ON auth_methods.account_id = accounts.id
      AND auth_methods.revoked_at IS NULL
    WHERE accounts.role = 'platform_admin'
  `).all()
  if (admins.length !== 1) {
    throw new Error(`Expected exactly one active platform admin, found ${admins.length}.`)
  }

  const admin = admins[0]
  const adminUsers = snapshot.prepare(`
    SELECT id
    FROM auth_users
    WHERE id = ? OR username = ?
  `).all(admin.id, admin.identifier)
  if (adminUsers.length !== 1) {
    throw new Error(`Expected exactly one platform-admin auth user, found ${adminUsers.length}.`)
  }
  const adminUserId = adminUsers[0].id

  const sanitize = snapshot.transaction(() => {
    for (const table of schema.tables) {
      if (!PRESERVED_TABLES.has(table.name)) {
        snapshot.prepare(`DELETE FROM ${quoteIdentifier(table.name)}`).run()
      }
    }

    snapshot.prepare("DELETE FROM auth_two_factors WHERE user_id <> ?").run(adminUserId)
    snapshot.prepare("DELETE FROM auth_provider_accounts WHERE user_id <> ?").run(adminUserId)
    snapshot.prepare("DELETE FROM auth_users WHERE id <> ?").run(adminUserId)

    for (const table of [
      "academy_id_allocations",
      "auth_credential_states",
      "auth_methods",
      "auth_pin_credentials",
      "auth_recovery_emails",
    ]) {
      snapshot.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE account_id <> ?`).run(admin.id)
    }
    snapshot.prepare("DELETE FROM accounts WHERE id <> ?").run(admin.id)
    snapshot.prepare("DELETE FROM sqlite_sequence").run()
  })
  sanitize.immediate()
  snapshot.pragma("foreign_keys = ON")

  const result = {
    accounts: count(snapshot, "SELECT count(*) AS count FROM accounts"),
    batches: count(snapshot, "SELECT count(*) AS count FROM batches"),
    headCoaches: count(snapshot, "SELECT count(*) AS count FROM coach_profiles"),
    pinCredentials: count(snapshot, "SELECT count(*) AS count FROM auth_pin_credentials WHERE account_id = ?", admin.id),
    platformAdmins: count(snapshot, "SELECT count(*) AS count FROM accounts WHERE role = 'platform_admin'"),
    players: count(snapshot, "SELECT count(*) AS count FROM player_enrollments"),
    recoveryEmails: count(snapshot, "SELECT count(*) AS count FROM auth_recovery_emails WHERE account_id = ?", admin.id),
    verifiedFactors: count(snapshot, "SELECT count(*) AS count FROM auth_two_factors WHERE user_id = ? AND verified = 1", adminUserId),
  }
  if (result.accounts !== 1
    || result.platformAdmins !== 1
    || result.headCoaches !== 0
    || result.players !== 0
    || result.pinCredentials !== 1
    || result.recoveryEmails !== 1
    || result.verifiedFactors !== 1) {
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
