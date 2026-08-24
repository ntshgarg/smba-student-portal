// Blast radius: this DELETEs every row of every table in the Turso database
// named by TURSO_DATABASE_URL and re-inserts the contents of the local source
// database. Pointed at production it destroys every account, enrollment,
// attendance mark, fee, payment and refund the academy holds, and the backup
// written to backupArgument is the only recovery, so give that a durable path.
//
// Four guards stand in front of that, all of them before the first DELETE:
// SMBA_CONFIRM_REMOTE_EMPTY_RESET must equal CONFIRMATION, the source must
// already be a zero-member academy, the two schemas must name exactly the same
// tables, and the remote backup must pass an integrity check.
//
// Procedure and preconditions: docs/PRODUCTION-OPERATIONS.md, "Resetting the
// academy to an empty state". prepare-admin-only-snapshot.mjs builds the source
// this consumes, so that the platform owner's login survives the reset.

import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

const CONFIRMATION = "RESET-TO-EMPTY-ACADEMY"
const sourceArgument = process.argv[2]
const backupArgument = process.argv[3]
const databaseUrl = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()

if (process.env.SMBA_CONFIRM_REMOTE_EMPTY_RESET !== CONFIRMATION) {
  throw new Error(`Set SMBA_CONFIRM_REMOTE_EMPTY_RESET=${CONFIRMATION} to authorize this reset.`)
}
if (!sourceArgument) throw new Error("Provide the prepared empty-academy SQLite database.")
if (!backupArgument) throw new Error("Provide a new local SQLite backup path.")
if (!databaseUrl) throw new Error("TURSO_DATABASE_URL is required.")
if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required.")

const sourcePath = path.resolve(process.cwd(), sourceArgument)
const backupPath = path.resolve(process.cwd(), backupArgument)
if (fs.existsSync(backupPath)) throw new Error("The requested backup path already exists.")
fs.mkdirSync(path.dirname(backupPath), { recursive: true })

const source = new BetterSqlite3(sourcePath, { readonly: true, fileMustExist: true })
const target = new LibsqlDatabase(databaseUrl, { authToken })
const backup = new BetterSqlite3(backupPath)
const INSERT_BATCH_SIZE = 50

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

function orderTablesByDependencies(database, tables) {
  const tableNames = new Set(tables.map((table) => table.name))
  const dependencies = new Map(tables.map((table) => [
    table.name,
    new Set(database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`)
      .all()
      .map((foreignKey) => foreignKey.table)
      .filter((name) => name !== table.name && tableNames.has(name))),
  ]))
  const ordered = []
  const remaining = new Map(tables.map((table) => [table.name, table]))
  while (remaining.size) {
    const ready = [...remaining.values()].filter((table) => (
      [...dependencies.get(table.name)].every((dependency) => !remaining.has(dependency))
    ))
    if (!ready.length) throw new Error("The database schema contains a circular table dependency.")
    for (const table of ready) {
      ordered.push(table)
      remaining.delete(table.name)
    }
  }
  return ordered
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

function count(database, query) {
  return Number(database.prepare(query).get().count)
}

function sequenceRows(database) {
  try {
    return database.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all()
  } catch {
    return []
  }
}

function restoreSequences(database, rows) {
  try {
    database.prepare("DELETE FROM sqlite_sequence").run()
  } catch {
    if (rows.length) throw new Error("The database does not expose sqlite_sequence.")
    return
  }

  if (!rows.length) return
  database.prepare(`
    INSERT INTO sqlite_sequence (name, seq)
    VALUES ${rows.map(() => "(?, ?)").join(", ")}
  `).run(...rows.flatMap((row) => [row.name, row.seq]))
}

try {
  const sourceCounts = {
    accounts: count(source, "SELECT count(*) AS count FROM accounts"),
    headCoaches: count(source, "SELECT count(*) AS count FROM coach_profiles"),
    platformAdmins: count(source, "SELECT count(*) AS count FROM accounts WHERE role = 'platform_admin'"),
    players: count(source, "SELECT count(*) AS count FROM player_enrollments"),
  }
  if (sourceCounts.accounts !== 1
    || sourceCounts.platformAdmins !== 1
    || sourceCounts.headCoaches !== 0
    || sourceCounts.players !== 0) {
    throw new Error(`The source is not a zero-member academy: ${JSON.stringify(sourceCounts)}`)
  }

  const sourceSchema = schemaObjects(source)
  const targetSchema = schemaObjects(target)
  const sourceSequences = sequenceRows(source)
  const targetSequences = sequenceRows(target)
  const sourceNames = sourceSchema.tables.map((table) => table.name).sort()
  const targetNames = targetSchema.tables.map((table) => table.name).sort()
  if (JSON.stringify(sourceNames) !== JSON.stringify(targetNames)) {
    throw new Error("The Turso schema does not exactly match the prepared empty-academy schema.")
  }

  let backupRows = 0
  backup.pragma("foreign_keys = OFF")
  const createBackup = backup.transaction(() => {
    for (const table of targetSchema.tables) backup.exec(table.sql)
    for (const table of targetSchema.tables) {
      backupRows += insertRows(
        backup,
        table.name,
        target.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all(),
      )
    }
    restoreSequences(backup, targetSequences)
    for (const index of targetSchema.indexes) backup.exec(index.sql)
  })
  createBackup.immediate()
  backup.pragma("foreign_keys = ON")
  const backupIntegrity = backup.pragma("integrity_check", { simple: true })
  if (backupIntegrity !== "ok") throw new Error(`Backup integrity check failed: ${backupIntegrity}`)

  const orderedTables = orderTablesByDependencies(source, sourceSchema.tables)
  let restoredRows = 0
  const reset = target.transaction(() => {
    for (const table of [...orderedTables].reverse()) {
      target.prepare(`DELETE FROM ${quoteIdentifier(table.name)}`).run()
    }
    for (const table of orderedTables) {
      restoredRows += insertRows(
        target,
        table.name,
        source.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all(),
      )
    }
    restoreSequences(target, sourceSequences)
  })
  reset.immediate()

  const result = {
    accounts: count(target, "SELECT count(*) AS count FROM accounts"),
    headCoaches: count(target, "SELECT count(*) AS count FROM coach_profiles"),
    platformAdmins: count(target, "SELECT count(*) AS count FROM accounts WHERE role = 'platform_admin'"),
    players: count(target, "SELECT count(*) AS count FROM player_enrollments"),
  }
  if (JSON.stringify(result) !== JSON.stringify(sourceCounts)) {
    throw new Error(`Remote verification failed: ${JSON.stringify(result)}`)
  }
  console.log(JSON.stringify({ backupPath, backupRows, restoredRows, result }))
} finally {
  source.close()
  target.close()
  backup.close()
}
