import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

const sourceArgument = process.argv[2]
const databaseUrl = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()

if (!sourceArgument) throw new Error("Provide the local SQLite database to copy.")
if (!databaseUrl) throw new Error("TURSO_DATABASE_URL is required.")
if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required.")

const sourcePath = path.resolve(process.cwd(), sourceArgument)
const source = new BetterSqlite3(sourcePath, { readonly: true, fileMustExist: true })
const target = new LibsqlDatabase(databaseUrl, { authToken })
const INSERT_BATCH_SIZE = 50
const TRANSIENT_AUTH_TABLES = new Set([
  "auth_access_codes",
  "auth_login_attempts",
  "auth_rate_limits",
  "auth_runtime_sessions",
  "auth_security_events",
  "auth_sessions",
  "auth_verifications",
])

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function orderTablesByDependencies(tables) {
  const tableNames = new Set(tables.map((table) => table.name))
  const dependencies = new Map(tables.map((table) => {
    const referencedTables = source
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`)
      .all()
      .map((foreignKey) => foreignKey.table)
      .filter((name) => name !== table.name && tableNames.has(name))

    return [table.name, new Set(referencedTables)]
  }))
  const ordered = []
  const remaining = new Map(tables.map((table) => [table.name, table]))

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((table) => (
      [...dependencies.get(table.name)].every((dependency) => !remaining.has(dependency))
    ))

    if (ready.length === 0) {
      throw new Error("The preview schema contains a circular table dependency.")
    }

    for (const table of ready) {
      ordered.push(table)
      remaining.delete(table.name)
    }
  }

  return ordered
}

try {
  const tables = source.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY rowid
  `).all()
  const indexes = source.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY name
  `).all()
  const orderedTables = orderTablesByDependencies(tables)
  const sourceTableNames = new Set(tables.map((table) => table.name))
  const existingTables = target.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `).all()
  const targetHasPreparedSchema = existingTables.length > 0

  if (targetHasPreparedSchema) {
    const unexpectedTables = existingTables
      .map((table) => table.name)
      .filter((name) => !sourceTableNames.has(name))
    const missingTables = tables
      .map((table) => table.name)
      .filter((name) => !existingTables.some((table) => table.name === name))

    if (unexpectedTables.length > 0 || missingTables.length > 0) {
      throw new Error("The prepared Turso schema does not match the preview source schema.")
    }

    const populatedTables = existingTables
      .map((table) => table.name)
      .filter((name) => name !== "__drizzle_migrations")
      .filter((name) => target.prepare(
        `SELECT 1 FROM ${quoteIdentifier(name)} LIMIT 1`,
      ).get())

    if (populatedTables.length > 0) {
      throw new Error(
        "The Turso database contains application data. Preview copying is create-only.",
      )
    }
  }

  let copiedRows = 0
  const copy = target.transaction(() => {
    if (!targetHasPreparedSchema) {
      for (const table of tables) target.exec(table.sql)
    }

    for (const table of orderedTables) {
      if (TRANSIENT_AUTH_TABLES.has(table.name)) continue
      if (targetHasPreparedSchema && table.name === "__drizzle_migrations") continue

      const rows = source.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all()
      if (rows.length === 0) continue

      const columns = Object.keys(rows[0])
      const valuePlaceholders = `(${columns.map(() => "?").join(", ")})`

      for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE)
        const insert = target.prepare(`
          INSERT INTO ${quoteIdentifier(table.name)}
            (${columns.map(quoteIdentifier).join(", ")})
          VALUES ${batch.map(() => valuePlaceholders).join(", ")}
        `)
        insert.run(...batch.flatMap((row) => columns.map((column) => row[column])))
        copiedRows += batch.length
      }
    }

    if (!targetHasPreparedSchema) {
      for (const index of indexes) target.exec(index.sql)
    }
  })

  copy.immediate()

  const integrity = target.pragma("integrity_check", { simple: true })
  const integrityValue = typeof integrity === "string"
    ? integrity
    : integrity?.integrity_check
  if (integrityValue !== "ok") {
    throw new Error(`Turso integrity check failed: ${JSON.stringify(integrity)}`)
  }

  console.log(`Copied ${copiedRows} synthetic preview rows across ${tables.length} tables.`)
} finally {
  source.close()
  target.close()
}
