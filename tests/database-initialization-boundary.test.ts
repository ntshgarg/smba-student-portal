import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-db-boundary-"))
const databasePath = path.join(temporaryDirectory, "runtime.db")
process.env.DB_FILE_NAME = databasePath

describe("database initialization boundary", () => {
  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("opens a runtime connection without migrating or seeding until setup is explicit", async () => {
    const client = await import("@/lib/db/client")
    client.initializeDatabase()

    const inspection = new BetterSqlite3(databasePath)
    expect(inspection.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
    `).all()).toEqual([])

    const { prepareDatabase } = await import("@/lib/db/setup")
    prepareDatabase({ seed: true })

    expect(inspection.prepare("SELECT full_name FROM accounts").all()).toEqual([
      { full_name: "Sathiya Moorthy" },
    ])
    inspection.close()
  })
})
