import "server-only"

import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import { seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"

function openDatabase() {
  const configuredPath = process.env.DB_FILE_NAME ?? ".data/smba.db"
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const sqlite = new Database(databasePath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  return drizzle(sqlite, { schema })
}

export type SmbaDatabase = ReturnType<typeof openDatabase>
export type SmbaTransaction = Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0]
export type SmbaDatabaseExecutor = SmbaDatabase | SmbaTransaction

let database: SmbaDatabase | null = null
let initialized = false

export function initializeDatabase() {
  database ??= openDatabase()
  if (initialized) return database

  migrate(database, {
    migrationsFolder: path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      "drizzle",
    ),
  })
  seedDatabase(database)
  initialized = true
  return database
}
