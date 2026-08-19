import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import BetterSqlite3 from "better-sqlite3"
import LibsqlDatabase from "libsql"

const INSERT_BATCH_SIZE = 50

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function localDatabasePath(source) {
  if (!source.startsWith("file:")) return source
  return fileURLToPath(new URL(source))
}

function openSource(source, authToken) {
  if (/^(libsql|https|wss):\/\//u.test(source)) {
    if (!authToken) throw new Error("A database auth token is required for a remote snapshot.")
    return new LibsqlDatabase(source, { authToken })
  }

  return new BetterSqlite3(localDatabasePath(source), {
    fileMustExist: true,
    readonly: true,
  })
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
  const secondary = database.prepare(`
    SELECT name, sql, type
    FROM sqlite_master
    WHERE type IN ('index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY CASE type WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name
  `).all()

  return { secondary, tables }
}

function insertRows(database, tableName, rows) {
  if (!rows.length) return
  const columns = Object.keys(rows[0])
  const valuePlaceholders = `(${columns.map(() => "?").join(", ")})`

  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE)
    database.prepare(`
      INSERT INTO ${quoteIdentifier(tableName)}
        (${columns.map(quoteIdentifier).join(", ")})
      VALUES ${batch.map(() => valuePlaceholders).join(", ")}
    `).run(...batch.flatMap((row) => columns.map((column) => row[column])))
  }
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
    if (rows.length) throw new Error("The snapshot does not expose sqlite_sequence.")
    return
  }

  if (!rows.length) return
  database.prepare(`
    INSERT INTO sqlite_sequence (name, seq)
    VALUES ${rows.map(() => "(?, ?)").join(", ")}
  `).run(...rows.flatMap((row) => [row.name, row.seq]))
}

function tableCounts(database, tables) {
  return Object.fromEntries(tables.map(({ name }) => [
    name,
    Number(database.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(name)}`).get().count),
  ]))
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function assertHealthySnapshot(database) {
  const integrity = database.pragma("integrity_check", { simple: true })
  if (integrity !== "ok") throw new Error(`Snapshot integrity check failed: ${integrity}`)

  const foreignKeyFailures = database.pragma("foreign_key_check")
  if (foreignKeyFailures.length) {
    throw new Error(`Snapshot contains ${foreignKeyFailures.length} foreign-key violation(s).`)
  }
}

export function createDatabaseSnapshot({
  authToken,
  outputPath,
  source,
}) {
  const resolvedOutput = path.resolve(outputPath)
  const manifestPath = `${resolvedOutput}.manifest.json`
  const temporaryPath = `${resolvedOutput}.partial-${process.pid}`

  if (fs.existsSync(resolvedOutput) || fs.existsSync(manifestPath)) {
    throw new Error("The snapshot or its manifest already exists; choose a new output path.")
  }
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true })

  const sourceDatabase = openSource(source, authToken)
  let snapshot = null

  try {
    const readConsistentSource = sourceDatabase.transaction(() => {
      const schema = schemaObjects(sourceDatabase)
      if (!schema.tables.length) throw new Error("The source database has no application tables.")
      const rows = Object.fromEntries(schema.tables.map(({ name }) => [
        name,
        sourceDatabase.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all(),
      ]))
      return {
        expectedCounts: Object.fromEntries(
          Object.entries(rows).map(([name, values]) => [name, values.length]),
        ),
        rows,
        schema,
        sequences: sequenceRows(sourceDatabase),
      }
    })
    const { expectedCounts, rows, schema, sequences } = readConsistentSource()

    snapshot = new BetterSqlite3(temporaryPath)
    snapshot.pragma("foreign_keys = OFF")
    const copy = snapshot.transaction(() => {
      for (const table of schema.tables) snapshot.exec(table.sql)
      for (const table of schema.tables) {
        insertRows(
          snapshot,
          table.name,
          rows[table.name],
        )
      }
      restoreSequences(snapshot, sequences)
      for (const object of schema.secondary) snapshot.exec(object.sql)
    })
    copy.immediate()
    snapshot.pragma("foreign_keys = ON")
    assertHealthySnapshot(snapshot)

    const actualCounts = tableCounts(snapshot, schema.tables)
    if (JSON.stringify(actualCounts) !== JSON.stringify(expectedCounts)) {
      throw new Error("Snapshot row counts do not match the source database.")
    }

    snapshot.close()
    snapshot = null
    fs.renameSync(temporaryPath, resolvedOutput)
    fs.chmodSync(resolvedOutput, 0o600)

    const manifest = {
      createdAt: new Date().toISOString(),
      file: path.basename(resolvedOutput),
      rowCounts: actualCounts,
      schemaObjects: schema.tables.length + schema.secondary.length,
      sha256: sha256(resolvedOutput),
      source: /^(libsql|https|wss):\/\//u.test(source) ? "remote" : "local",
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })

    return { manifest, manifestPath, snapshotPath: resolvedOutput }
  } catch (error) {
    if (snapshot?.open) snapshot.close()
    fs.rmSync(temporaryPath, { force: true })
    throw error
  } finally {
    sourceDatabase.close()
  }
}

export function verifyDatabaseSnapshot({ manifestPath, snapshotPath }) {
  const resolvedSnapshot = path.resolve(snapshotPath)
  const resolvedManifest = path.resolve(manifestPath ?? `${resolvedSnapshot}.manifest.json`)
  const manifest = JSON.parse(fs.readFileSync(resolvedManifest, "utf8"))

  if (sha256(resolvedSnapshot) !== manifest.sha256) {
    throw new Error("Snapshot checksum does not match its manifest.")
  }

  const database = new BetterSqlite3(resolvedSnapshot, {
    fileMustExist: true,
    readonly: true,
  })
  try {
    assertHealthySnapshot(database)
    const schema = schemaObjects(database)
    const counts = tableCounts(database, schema.tables)
    if (JSON.stringify(counts) !== JSON.stringify(manifest.rowCounts)) {
      throw new Error("Snapshot row counts do not match its manifest.")
    }

    return {
      checkedAt: new Date().toISOString(),
      file: path.basename(resolvedSnapshot),
      sha256: manifest.sha256,
      tables: schema.tables.length,
    }
  } finally {
    database.close()
  }
}
