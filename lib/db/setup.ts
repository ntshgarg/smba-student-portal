import "server-only"

import path from "node:path"

import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import { initializeDatabase, type SmbaDatabase } from "@/lib/db/client"
import { seedDatabase } from "@/lib/db/seed"

type PrepareDatabaseOptions = {
  database?: SmbaDatabase
  seed?: boolean
}

/**
 * Deployment, development and test setup only. Request code must use
 * initializeDatabase(), which opens the prepared database without writing to it.
 */
export function prepareDatabase({
  database = initializeDatabase(),
  seed = false,
}: PrepareDatabaseOptions = {}) {
  migrate(database, {
    migrationsFolder: path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      "drizzle",
    ),
  })
  if (seed) seedDatabase(database)
  return database
}
