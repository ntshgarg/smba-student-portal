import "server-only"

import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import LibsqlDatabase from "libsql"

import * as schema from "@/lib/db/schema"

function shouldUseTurso() {
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

  return drizzle(sqlite, { schema })
}

export type SmbaDatabase = ReturnType<typeof openDatabase>
export type SmbaTransaction = Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0]
export type SmbaDatabaseExecutor = SmbaDatabase | SmbaTransaction

let database: SmbaDatabase | null = null

export function initializeDatabase() {
  database ??= openDatabase()
  return database
}
