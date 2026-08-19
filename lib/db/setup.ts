import "server-only"

import path from "node:path"

import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import { initializeDatabase, type SmbaDatabase } from "@/lib/db/client"
import { seedDatabase, seedReferenceData } from "@/lib/db/seed"
import { ensureBootstrapCredential } from "@/lib/auth/credential-service"
import { validateAuthEmailConfiguration } from "@/lib/auth/mailer"

type PrepareDatabaseOptions = {
  database?: SmbaDatabase
  emptyAcademy?: boolean
  seed?: boolean
}

/**
 * Deployment, development and test setup only. Request code must use
 * initializeDatabase(), which opens the prepared database without writing to it.
 */
export function prepareDatabase({
  database = initializeDatabase(),
  emptyAcademy = false,
  seed = false,
}: PrepareDatabaseOptions = {}) {
  validateAuthEmailConfiguration()
  migrate(database, {
    migrationsFolder: path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      "drizzle",
    ),
  })
  if (seed) {
    if (emptyAcademy) seedReferenceData(database)
    else seedDatabase(database)
  }
  // A genuinely empty academy must not contain a hidden or default owner
  // credential. Its platform owner is created only through the one-time,
  // token-bound setup flow.
  if (!emptyAcademy) ensureBootstrapCredential({ database })
  return database
}
