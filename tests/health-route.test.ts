import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const databaseGet = vi.hoisted(() => vi.fn())
const connection = vi.hoisted(() => ({ current: null as unknown }))

vi.mock("@/lib/db/client", () => ({
  initializeDatabase: () => connection.current,
}))

import { GET } from "@/app/api/health/route"
import { seedReferenceData } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"

describe("public health endpoint", () => {
  beforeEach(() => {
    databaseGet.mockReset()
    // `run` answers too, the way any reachable database answers `select 1`;
    // only a read of real academy tables tells a prepared database apart.
    connection.current = { get: databaseGet, run: vi.fn(() => ({ rowsAffected: 0 })) }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns a cache-resistant success without exposing database details", async () => {
    databaseGet.mockReturnValue({ ready: 1 })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.json()).toEqual({ status: "ok" })
    expect(databaseGet).toHaveBeenCalledOnce()
  })

  it("fails closed when the database cannot be reached", async () => {
    databaseGet.mockImplementation(() => {
      throw new Error("connection unavailable")
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "unavailable" })
    expect(consoleError).toHaveBeenCalledWith(
      "Health check database probe failed.",
      { cause: expect.stringContaining("connection unavailable") },
    )
    consoleError.mockRestore()
  })

  it("echoes the day the accessibility gate pinned this server to", async () => {
    // The only way the gate can tell a pinned server from a wall-clock one:
    // SMBA_ACCESSIBILITY_CLOCK is read here, in the Next process, while the
    // Playwright runner attaches to a server it did not start. The success case
    // above is the other half -- unpinned, the payload is exactly {status:"ok"},
    // so a deployment's health response is unchanged and an absent field is
    // proof of a wall-clock server rather than of an older build.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-health-clock-"))
    try {
      databaseGet.mockReturnValue({ ready: 1 })
      vi.stubEnv("VERCEL", "")
      vi.stubEnv("TMPDIR", directory)
      vi.stubEnv("DB_FILE_NAME", path.join(directory, "smba-accessibility-stress.db"))
      vi.stubEnv("SMBA_ACCESSIBILITY_PROFILE", "stress")
      vi.stubEnv("SMBA_ACCESSIBILITY_CLOCK", "2026-08-17T09:30:00+05:30")

      expect(await (await GET()).json()).toEqual({ fixtureClock: "2026-08-17", status: "ok" })
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  /*
   * Reachable is not ready. A blank file, a database whose tables were never
   * created, and one migrated but never given its batches all answered
   * `select 1`, so the "is the site working" checks said yes while every
   * signed-in page failed.
   */
  describe("against a real database", () => {
    let sqlite: Database.Database

    beforeEach(() => {
      sqlite = new Database(":memory:")
      connection.current = drizzle(sqlite, { schema })
    })

    afterEach(() => {
      sqlite.close()
    })

    it("reports a database that was never set up as unavailable", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

      const response = await GET()

      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ status: "unavailable" })
      consoleError.mockRestore()
    })

    it("reports a database with tables but no academy set-up as unavailable", async () => {
      migrate(connection.current as never, {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      })
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

      const response = await GET()

      expect(response.status).toBe(503)
      expect(consoleError).toHaveBeenCalledWith("Health check found a database that has not been set up.")
      consoleError.mockRestore()
    })

    it("reports a prepared academy as healthy", async () => {
      const database = connection.current as Parameters<typeof seedReferenceData>[0]
      migrate(database as never, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
      seedReferenceData(database)

      const response = await GET()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "ok" })
    })
  })
})
