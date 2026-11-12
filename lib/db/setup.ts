import "server-only"

import path from "node:path"

import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"

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
 *
 * The gate keys on whether the target database is remote, not on which host is
 * running. An earlier `VERCEL !== "1" -> false` first line exempted every shell
 * and CI runner outright, and shouldUseTurso() is satisfied off Vercel by
 * TURSO_DATABASE_URL plus SMBA_USE_TURSO=true alone -- so a laptop or a
 * workflow step holding the production Turso variables could apply the working
 * tree's migrations to the live academy and seed it, which is exactly the
 * 22 August 2026 incident. A local file database is unaffected: shouldUseTurso()
 * is false there, so the gate never fires for a DB_FILE_NAME run.
 */
export function remoteDatabasePreparationBlocked() {
  // Nothing remote is at stake; a DB_FILE_NAME database is the caller's own.
  if (!shouldUseTurso()) return false
  // The environment declares the remote database it names is its own and
  // disposable. The one deliberate opt-out, on or off Vercel.
  if (process.env.SMBA_ALLOW_REMOTE_DB_MIGRATION === "true") return false
  // Production's own deploy is the build that is supposed to migrate it.
  // VERCEL_ENV is only trusted alongside VERCEL=1: on its own it is an
  // ordinary shell variable anyone can export.
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") return false
  return true
}

const MIGRATIONS_TABLE = "__drizzle_migrations"

/**
 * Applies the pending migrations in one transaction, deciding which are
 * pending inside that transaction.
 *
 * Drizzle's own migrator reads the last applied migration first and only then
 * opens its transaction, so two deploys preparing the same database at once
 * could both decide the same migration is still to do and the second would
 * run it again. Reading the ledger after BEGIN means the second deploy either
 * sees the first one's work (and skips it) or is refused by the database when
 * it tries to write over a newer state, rolling back cleanly. The ledger rows
 * written are exactly drizzle's, so drizzle tooling still reads them.
 */
export function applyMigrations(database: SmbaDatabase, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder })
  const table = sql.identifier(MIGRATIONS_TABLE)
  database.run(sql`BEGIN`)
  try {
    database.run(sql`
      CREATE TABLE IF NOT EXISTS ${table} (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `)
    const lastApplied = database.values<[unknown, string, number | string]>(
      sql`SELECT id, hash, created_at FROM ${table} ORDER BY created_at DESC LIMIT 1`,
    )[0]
    for (const migration of migrations) {
      if (lastApplied && Number(lastApplied[2]) >= migration.folderMillis) continue
      for (const statement of migration.sql) database.run(sql.raw(statement))
      database.run(sql`
        INSERT INTO ${table} ("hash", "created_at")
        VALUES (${migration.hash}, ${migration.folderMillis})
      `)
    }
    database.run(sql`COMMIT`)
  } catch (error) {
    database.run(sql`ROLLBACK`)
    throw error
  }
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
  applyMigrations(database, path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "drizzle",
  ))
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
