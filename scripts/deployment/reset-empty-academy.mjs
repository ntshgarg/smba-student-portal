// Blast radius: this DELETEs every row of every table in the Turso database
// named by TURSO_DATABASE_URL and re-inserts the contents of the local source
// database. Pointed at production it destroys every account, enrollment,
// attendance mark, fee, payment and refund the academy holds, and the backup
// written to backupArgument is the only recovery, so give that a durable path.
//
// Guards, all of them before the first DELETE:
//
// - SMBA_CONFIRM_REMOTE_EMPTY_RESET must equal CONFIRMATION;
// - the source must already be a zero-member academy with no authenticator;
// - the live database must still be the one the source was prepared from:
//   the same table layout, the same update history, the same owner, and the
//   owner's password, PIN, recovery email and sign-in names unchanged. Time
//   can pass between preparing the copy and running this. An update released
//   in between used to be rolled back in the update history while its changes
//   stayed, which broke every later deploy; an owner who changed their PIN in
//   between had the old one silently brought back;
// - the backup of the live database must pass an integrity check.
//
// The backup is read in one read transaction, so it is of one moment, without
// taking the write lock: Turso ends a write transaction after a few seconds,
// and reading a real academy over the network takes longer than that. Only
// then does this take the write lock, check every guard again, and check that
// nothing was saved since the backup -- one summary of every row, worked out
// by the database in a single request and compared with the same summary taken
// alongside the backup. If anything changed, nothing is deleted. So the backup
// is exactly what is replaced, and the lock is held only for those checks and
// the replacement. The update history (__drizzle_migrations) is never deleted
// or rewritten.
//
// Procedure and preconditions: docs/PRODUCTION-OPERATIONS.md, "Resetting the
// academy to an empty state". prepare-admin-only-snapshot.mjs builds the source
// this consumes, so that the platform owner's login survives the reset.

import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

import {
  PLATFORM_OWNER_ACADEMY_ID,
  contentFingerprint,
  contentFingerprintQuery,
  ownerSignInDetails,
  readConsistently,
  soleOwnerQuery,
} from "./academy-owner.mjs"

const CONFIRMATION = "RESET-TO-EMPTY-ACADEMY"
const UPDATE_HISTORY_TABLE = "__drizzle_migrations"
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
let backup = null
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

function layout(schema) {
  const describe = (objects) => objects
    .map((object) => `${object.name}\n${object.sql}`)
    .sort()
  return JSON.stringify({ indexes: describe(schema.indexes), tables: describe(schema.tables) })
}

function updateHistory(database) {
  return JSON.stringify(database.prepare(`
    SELECT hash, created_at AS createdAt
    FROM ${quoteIdentifier(UPDATE_HISTORY_TABLE)}
    ORDER BY created_at, id
  `).all().map((row) => [row.hash, String(row.createdAt)]))
}

function soleOwner(database, where) {
  const owners = database.prepare(soleOwnerQuery).all()
  if (owners.length !== 1) {
    throw new Error(`Expected exactly one approved platform owner in the ${where}, found ${owners.length}.`)
  }
  if (owners[0].username !== PLATFORM_OWNER_ACADEMY_ID) {
    throw new Error(`The ${where}'s platform owner does not sign in as ${PLATFORM_OWNER_ACADEMY_ID}.`)
  }
  return owners[0]
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

// Set immediately before the first DELETE. Until then the live database is
// untouched, so a backup file left by a failed attempt is worthless and only
// blocks a retry. After it, the backup is kept whatever happens: a lost
// connection can hide a change that did commit.
let liveDatabaseTouched = false

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
  if (count(source, "SELECT count(*) AS count FROM auth_two_factors") !== 0) {
    throw new Error(
      "The prepared copy still holds the owner's authenticator. Prepare it again with the current "
      + "prepare-admin-only-snapshot.mjs, which removes it.",
    )
  }
  const sourceSchema = schemaObjects(source)
  const sourceOwner = soleOwner(source, "prepared copy")
  const sourceSequences = sequenceRows(source)
  const orderedTables = orderTablesByDependencies(source, sourceSchema.tables)
    .filter((table) => table.name !== UPDATE_HISTORY_TABLE)

  fs.closeSync(fs.openSync(backupPath, "wx", 0o600))
  backup = new BetterSqlite3(backupPath)

  // Every guard, asked of the live database. Run once alongside the backup and
  // again under the write lock, so nothing can change in between unnoticed.
  function checkLiveDatabase() {
    const targetSchema = schemaObjects(target)
    if (layout(sourceSchema) !== layout(targetSchema)) {
      throw new Error(
        "The live database's table layout differs from the prepared copy. An update may have been "
        + "released since the copy was made. Nothing was changed: prepare the copy again from this database.",
      )
    }
    if (updateHistory(source) !== updateHistory(target)) {
      throw new Error(
        "The live database has had an update since the prepared copy was made. Nothing was changed: "
        + "prepare the copy again from this database.",
      )
    }
    const targetOwner = soleOwner(target, "live database")
    if (targetOwner.id !== sourceOwner.id) {
      throw new Error(
        "The prepared copy was made from a different academy: its owner is not this database's owner. "
        + "Nothing was changed.",
      )
    }
    if (ownerSignInDetails(source, sourceOwner.id) !== ownerSignInDetails(target, targetOwner.id)) {
      throw new Error(
        "The owner's password, PIN, recovery email or sign-in name changed, or their sign-in was marked for "
        + "reset or revoked, after the prepared copy was made. Nothing was changed: prepare the copy again "
        + "so the current ones are kept.",
      )
    }
    return targetSchema
  }

  // Step 1, no write lock: the guards, the backup and the summary of what it
  // holds, all from one read transaction.
  const snapshot = readConsistently(target, () => {
    const targetSchema = checkLiveDatabase()
    const fingerprintQuery = contentFingerprintQuery(target, targetSchema.tables.map((table) => table.name))
    return {
      fingerprint: contentFingerprint(target, fingerprintQuery),
      fingerprintQuery,
      rows: Object.fromEntries(targetSchema.tables.map(({ name }) => [
        name,
        target.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all(),
      ])),
      sequences: sequenceRows(target),
      targetSchema,
    }
  })

  let backupRows = 0
  let restoredRows = 0
  backup.pragma("foreign_keys = OFF")
  const createBackup = backup.transaction(() => {
    for (const table of snapshot.targetSchema.tables) backup.exec(table.sql)
    for (const table of snapshot.targetSchema.tables) {
      backupRows += insertRows(backup, table.name, snapshot.rows[table.name])
    }
    restoreSequences(backup, snapshot.sequences)
    for (const index of snapshot.targetSchema.indexes) backup.exec(index.sql)
  })
  createBackup.immediate()
  backup.pragma("foreign_keys = ON")
  const backupIntegrity = backup.pragma("integrity_check", { simple: true })
  if (backupIntegrity !== "ok") throw new Error(`Backup integrity check failed: ${backupIntegrity}`)
  backup.close()

  // Step 2, under the write lock and kept short: the guards again, proof that
  // nothing was saved since the backup, then the replacement.
  const reset = target.transaction(() => {
    checkLiveDatabase()
    if (contentFingerprint(target, snapshot.fingerprintQuery) !== snapshot.fingerprint) {
      throw new Error(
        "Something was saved in the live database after the backup was taken, so the backup would not "
        + "hold it. Nothing was changed: run the reset again when nobody is using the academy.",
      )
    }

    liveDatabaseTouched = true
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
} catch (error) {
  if (backup?.open) backup.close()
  if (!liveDatabaseTouched) {
    for (const leftover of [backupPath, `${backupPath}-journal`, `${backupPath}-wal`, `${backupPath}-shm`]) {
      fs.rmSync(leftover, { force: true })
    }
  }
  throw error
} finally {
  source.close()
  target.close()
  if (backup?.open) backup.close()
}
