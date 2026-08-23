import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const REMOTE_ENVIRONMENT_KEYS = [
  "SMBA_ALLOW_REMOTE_DB_MIGRATION",
  "SMBA_USE_TURSO",
  "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_URL",
  "VERCEL",
  "VERCEL_ENV",
] as const

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
    for (const key of REMOTE_ENVIRONMENT_KEYS) delete process.env[key]
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
})
