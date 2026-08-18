import "server-only"

import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import LibsqlDatabase from "libsql"

import * as schema from "@/lib/db/schema"

const REMOTE_DATABASE_IDLE_LIMIT_MS = 30_000

export function shouldUseTurso() {
  return Boolean(
    process.env.TURSO_DATABASE_URL
    && (process.env.VERCEL === "1" || process.env.SMBA_USE_TURSO === "true"),
  )
}

function openSqliteConnection(): BetterSqlite3.Database {
  if (shouldUseTurso()) {
    const url = process.env.TURSO_DATABASE_URL?.trim()
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim()

    if (!url) throw new Error("TURSO_DATABASE_URL is required for the remote database.")
    if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required for the remote database.")

    // libsql's synchronous runtime supports authToken, but its compatibility
    // declaration still mirrors the older better-sqlite3 Options type.
    return new LibsqlDatabase(url, { authToken } as never) as unknown as BetterSqlite3.Database
  }

  const configuredPath = process.env.DB_FILE_NAME ?? ".data/smba.db"
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  return new BetterSqlite3(databasePath)
}

function openDatabase() {
  const sqlite = openSqliteConnection()
  if (!shouldUseTurso()) sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  return {
    database: drizzle(sqlite, { schema }),
    sqlite,
  }
}

export type SmbaDatabase = ReturnType<typeof openDatabase>["database"]
export type SmbaTransaction = Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0]
export type SmbaDatabaseExecutor = SmbaDatabase | SmbaTransaction

let database: SmbaDatabase | null = null
let sqliteConnection: BetterSqlite3.Database | null = null
let lastDatabaseAccessAt = 0

function closeCachedDatabase() {
  if (sqliteConnection?.open) sqliteConnection.close()
  database = null
  sqliteConnection = null
  lastDatabaseAccessAt = 0
}

export function initializeDatabase() {
  const now = Date.now()
  if (database
    && shouldUseTurso()
    && now - lastDatabaseAccessAt > REMOTE_DATABASE_IDLE_LIMIT_MS) {
    // A Vercel worker can be frozen longer than Turso keeps its Hrana stream.
    // Never hand the resumed request that expired stream; open a new one.
    closeCachedDatabase()
  }
  if (!database) {
    const opened = openDatabase()
    database = opened.database
    sqliteConnection = opened.sqlite
  }
  lastDatabaseAccessAt = now
  return database
}

export function closeDatabaseConnection() {
  closeCachedDatabase()
}
