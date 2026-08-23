import "server-only"

import path from "node:path"

import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import { initializeDatabase, shouldUseTurso, type SmbaDatabase } from "@/lib/db/client"
import { seedDatabase, seedReferenceData } from "@/lib/db/seed"
import { ensureBootstrapCredential } from "@/lib/auth/credential-service"
import { validateAuthEmailConfiguration } from "@/lib/auth/mailer"

type PrepareDatabaseOptions = {
  database?: SmbaDatabase
  emptyAcademy?: boolean
  seed?: boolean
}

/**
 * Vercel runs one build command for every environment, so a preview build
 * migrates whichever database its Turso variables happen to name. On
 * 22 August 2026 that applied an unreviewed migration to the live academy and
 * left production serving old code against a new schema. Preparing a remote
 * database is therefore confined to production, unless an environment declares
 * that the database it points at is its own and disposable.
 */
export function remoteDatabasePreparationBlocked() {
  if (process.env.VERCEL !== "1") return false
  if (process.env.VERCEL_ENV === "production") return false
  if (process.env.SMBA_ALLOW_REMOTE_DB_MIGRATION === "true") return false
  return shouldUseTurso()
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
