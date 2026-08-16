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
  const existingTables = target.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `).all()

  if (existingTables.length > 0) {
    throw new Error(
      "The Turso database is not empty. Preview copying is intentionally create-only.",
    )
  }

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

  let copiedRows = 0
  const copy = target.transaction(() => {
    for (const table of tables) target.exec(table.sql)

    for (const table of orderedTables) {
      if (table.name === "auth_sessions") continue

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

    for (const index of indexes) target.exec(index.sql)
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
