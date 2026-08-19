import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let directory: string
let databasePath: string
let sqlite: Database.Database

function runMonitor(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [
    path.resolve(process.cwd(), "scripts/operations/check-security-signals.mjs"),
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      SMBA_MONITOR_DATABASE_URL: databasePath,
      SMBA_MONITOR_LOOKBACK_MINUTES: "60",
      ...overrides,
    },
  })
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-monitor-"))
  databasePath = path.join(directory, "signals.db")
  sqlite = new Database(databasePath)
  sqlite.exec(`
    CREATE TABLE auth_security_events (
      event_type TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      occurred_at INTEGER NOT NULL,
      outcome TEXT NOT NULL
    );
    CREATE TABLE operational_events (
      event_type TEXT NOT NULL,
      occurred_at INTEGER NOT NULL
    );
  `)
})

afterEach(() => {
  sqlite.close()
  fs.rmSync(directory, { force: true, recursive: true })
})

describe("production security-signal monitor", () => {
  it("returns only aggregate zero counts for a quiet period", () => {
    const result = runMonitor()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      applicationErrors: 0,
      emailDeliveryFailures: 0,
      lookbackMinutes: 60,
      securityLockouts: 0,
    })
  })

  it("fails on a sanitized server error", () => {
    sqlite.prepare("INSERT INTO operational_events VALUES (?, ?)")
      .run("application_error", Date.now())

    const result = runMonitor()
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/1 server application error/u)
  })

  it("fails at the configured email and lockout thresholds", () => {
    const insert = sqlite.prepare("INSERT INTO auth_security_events VALUES (?, ?, ?, ?)")
    insert.run("password_recovery_failed", '{"reason":"email_delivery"}', Date.now(), "failure")
    insert.run("login_rate_limited", "{}", Date.now(), "blocked")

    const result = runMonitor({ SMBA_MONITOR_LOCKOUT_THRESHOLD: "1" })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/authentication email delivery failure.*security lockout/u)
  })
})
