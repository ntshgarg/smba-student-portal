import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

describe("client error reports migration", () => {
  it("constrains the report vocabulary and holds no column for exception text", () => {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    const instant = Date.parse("2026-08-23T10:00:00+05:30")

    try {
      sqlite.exec(`
        CREATE TABLE accounts (id text PRIMARY KEY NOT NULL);
        INSERT INTO accounts (id) VALUES ('coach');
      `)
      const migration = fs.readFileSync(
        path.join(process.cwd(), "drizzle", "0028_client_error_reports.sql"),
        "utf8",
      )
      migration.split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .forEach((statement) => sqlite.exec(statement))

      const insert = sqlite.prepare(`
        INSERT INTO client_error_reports (
          id, event_type, boundary, fingerprint, route_path, error_name,
          digest, account_id, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      insert.run(
        "report-one", "client_error", "coach_financials", "fingerprint-one",
        "/coach/financials/:id", "TypeError", "1737209896", "coach", instant,
      )
      // A report from an anonymous visitor keeps no account reference.
      insert.run(
        "report-two", "unhandled_rejection", "window", "fingerprint-two",
        "/login", "Error", null, null, instant,
      )

      expect(sqlite.prepare("SELECT count(*) AS count FROM client_error_reports").get())
        .toEqual({ count: 2 })

      expect(() => insert.run(
        "report-three", "audit_event", "coach", "fingerprint-three",
        "/coach", "Error", null, null, instant,
      )).toThrow(/CHECK constraint failed/u)
      expect(() => insert.run(
        "report-four", "client_error", "somewhere_else", "fingerprint-four",
        "/coach", "Error", null, null, instant,
      )).toThrow(/CHECK constraint failed/u)
      expect(() => insert.run(
        "report-five", "client_error", "coach", "fingerprint-five",
        "/coach", "Error", null, "unknown-account", instant,
      )).toThrow(/FOREIGN KEY constraint failed/u)

      // The table cannot hold a message, a stack trace or a resolved URL because
      // it has nowhere to put one.
      const columns = new Set(
        (sqlite.pragma("table_info(client_error_reports)") as Array<{ name: string }>)
          .map((column) => column.name),
      )
      expect([...columns].sort()).toEqual([
        "account_id",
        "boundary",
        "digest",
        "error_name",
        "event_type",
        "fingerprint",
        "id",
        "occurred_at",
        "route_path",
      ])

      // Retention is a single indexed range delete over occurred_at.
      const indexes = new Set(
        (sqlite.pragma("index_list(client_error_reports)") as Array<{ name: string }>)
          .map((index) => index.name),
      )
      expect(indexes.has("client_error_reports_occurred_idx")).toBe(true)
      expect(indexes.has("client_error_reports_fingerprint_idx")).toBe(true)

      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
    }
  })
})
