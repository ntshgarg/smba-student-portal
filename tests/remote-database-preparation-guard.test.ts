import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const REMOTE_ENVIRONMENT_KEYS = [
  "CI",
  "DB_FILE_NAME",
  "GITHUB_ACTIONS",
  "SMBA_ALLOW_REMOTE_DB_MIGRATION",
  "SMBA_USE_TURSO",
  "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_URL",
  "VERCEL",
  "VERCEL_ENV",
] as const

const ORIGINAL_ENVIRONMENT = new Map(
  REMOTE_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
)

function restoreEnvironment() {
  for (const [key, value] of ORIGINAL_ENVIRONMENT) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

async function preparationBlocked() {
  const { remoteDatabasePreparationBlocked } = await import("@/lib/db/setup")
  return remoteDatabasePreparationBlocked()
}

describe("remote database preparation guard", () => {
  beforeEach(() => {
    for (const key of REMOTE_ENVIRONMENT_KEYS) delete process.env[key]
    process.env.TURSO_DATABASE_URL = "libsql://smba-development.turso.io"
    process.env.TURSO_AUTH_TOKEN = "test-token"
  })

  afterEach(() => {
    restoreEnvironment()
  })

  it("blocks a preview deployment from preparing the remote database", async () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "preview"

    expect(await preparationBlocked()).toBe(true)
  })

  it("blocks a Vercel deployment that reports no environment", async () => {
    process.env.VERCEL = "1"

    expect(await preparationBlocked()).toBe(true)
  })

  it("allows a production deployment to prepare the remote database", async () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "production"

    expect(await preparationBlocked()).toBe(false)
  })

  it("allows a preview deployment that owns a disposable database", async () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "preview"
    process.env.SMBA_ALLOW_REMOTE_DB_MIGRATION = "true"

    expect(await preparationBlocked()).toBe(false)
  })

  it("allows a preview deployment whose Turso variables are scoped away", async () => {
    delete process.env.TURSO_DATABASE_URL
    delete process.env.TURSO_AUTH_TOKEN
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "preview"

    expect(await preparationBlocked()).toBe(false)
  })

  it("leaves local, CI and restore-drill preparation untouched", async () => {
    expect(await preparationBlocked()).toBe(false)
  })

  // SEC-8. The guard used to return false on its first line whenever VERCEL was
  // not "1", so every environment below was exempt from it entirely even while
  // its Turso variables named the live academy.
  it("blocks a developer shell whose Turso variables name the live academy", async () => {
    process.env.SMBA_USE_TURSO = "true"
    process.env.TURSO_DATABASE_URL = "libsql://smba-production.turso.io"

    expect(await preparationBlocked()).toBe(true)
  })

  it("blocks a GitHub Actions runner that opts into the remote database", async () => {
    process.env.CI = "true"
    process.env.GITHUB_ACTIONS = "true"
    process.env.SMBA_USE_TURSO = "true"
    process.env.TURSO_DATABASE_URL = "libsql://smba-production.turso.io"

    expect(await preparationBlocked()).toBe(true)
  })

  it("blocks an off-Vercel shell even when DB_FILE_NAME is also set", async () => {
    // shouldUseTurso() wins over DB_FILE_NAME in openSqliteConnection(), so a
    // local-looking path in the command line is not evidence of a local target.
    process.env.DB_FILE_NAME = "/tmp/smba-scratch.db"
    process.env.SMBA_USE_TURSO = "true"
    process.env.TURSO_DATABASE_URL = "libsql://smba-production.turso.io"

    expect(await preparationBlocked()).toBe(true)
  })

  it("does not accept a bare VERCEL_ENV=production as the production escape", async () => {
    // Off Vercel, VERCEL_ENV is an ordinary variable any shell can export; it
    // must not buy the exemption that a real production deployment gets.
    process.env.SMBA_USE_TURSO = "true"
    process.env.TURSO_DATABASE_URL = "libsql://smba-production.turso.io"
    process.env.VERCEL_ENV = "production"

    expect(await preparationBlocked()).toBe(true)
  })

  it("allows an off-Vercel runner that declares its remote database disposable", async () => {
    process.env.SMBA_ALLOW_REMOTE_DB_MIGRATION = "true"
    process.env.SMBA_USE_TURSO = "true"
    process.env.TURSO_DATABASE_URL = "libsql://smba-branch-preview.turso.io"

    expect(await preparationBlocked()).toBe(false)
  })

  // The three CI steps that actually run database preparation:
  // encrypted-backup-restore.yml:120 (db:migrate) and :127 (db:prepare:empty),
  // and ui-accessibility.yml:61 (db:prepare:empty). Each passes DB_FILE_NAME
  // and sets neither SMBA_USE_TURSO nor TURSO_DATABASE_URL.
  it("never fires for a CI step preparing a DB_FILE_NAME database", async () => {
    delete process.env.TURSO_DATABASE_URL
    delete process.env.TURSO_AUTH_TOKEN
    process.env.CI = "true"
    process.env.GITHUB_ACTIONS = "true"
    process.env.DB_FILE_NAME = "/tmp/smba-accessibility-admin-source.db"

    expect(await preparationBlocked()).toBe(false)
  })

  it("never fires when SMBA_USE_TURSO is set without a remote URL", async () => {
    delete process.env.TURSO_DATABASE_URL
    delete process.env.TURSO_AUTH_TOKEN
    process.env.DB_FILE_NAME = "/tmp/smba-local.db"
    process.env.SMBA_USE_TURSO = "true"

    expect(await preparationBlocked()).toBe(false)
  })

  it("keeps vercel-build's production behaviour byte for byte", async () => {
    // vercel-build runs db:prepare:empty under VERCEL=1. Production prepares
    // its own database; every other Vercel environment stays blocked.
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "production"
    expect(await preparationBlocked()).toBe(false)

    process.env.VERCEL_ENV = "preview"
    expect(await preparationBlocked()).toBe(true)

    process.env.VERCEL_ENV = "development"
    expect(await preparationBlocked()).toBe(true)
  })
})
