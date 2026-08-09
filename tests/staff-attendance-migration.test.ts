import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

describe("coach profile and staff attendance migration", () => {
  it("preserves accounts, backfills Sathiya, and enforces attendance integrity", () => {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    const approvedAt = Date.parse("2026-07-31T20:00:00.000Z")

    try {
      sqlite.exec(`
        CREATE TABLE accounts (
          id text PRIMARY KEY NOT NULL,
          role text,
          approval_status text NOT NULL,
          approved_at integer,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
      `)
      sqlite.prepare(`
        INSERT INTO accounts (
          id, role, approval_status, approved_at, created_at, updated_at
        ) VALUES (?, 'coach', 'approved', ?, ?, ?)
      `).run(
        "00000000-0000-4000-8000-000000000001",
        approvedAt,
        approvedAt,
        approvedAt,
      )
      sqlite.prepare(`
        INSERT INTO accounts (
          id, role, approval_status, approved_at, created_at, updated_at
        ) VALUES ('legacy-player', 'player', 'approved', ?, ?, ?)
      `).run(approvedAt, approvedAt, approvedAt)

      const migration = fs.readFileSync(
        path.join(
          process.cwd(),
          "drizzle",
          "0014_coach_profiles_and_staff_attendance.sql",
        ),
        "utf8",
      )
      migration.split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .forEach((statement) => sqlite.exec(statement))

      expect(sqlite.prepare("SELECT count(*) AS count FROM accounts").get())
        .toEqual({ count: 2 })
      expect(sqlite.prepare(`
        SELECT account_id AS accountId, access_level AS accessLevel, joined_on AS joinedOn
        FROM coach_profiles
      `).get()).toEqual({
        accountId: "00000000-0000-4000-8000-000000000001",
        accessLevel: "head_admin",
        joinedOn: "2026-08-01",
      })

      sqlite.prepare(`
        INSERT INTO accounts (
          id, role, approval_status, approved_at, created_at, updated_at
        ) VALUES ('junior', 'coach', 'approved', ?, ?, ?)
      `).run(approvedAt, approvedAt, approvedAt)
      sqlite.prepare(`
        INSERT INTO coach_profiles (
          account_id, access_level, joined_on, created_at, updated_at
        ) VALUES ('junior', 'junior_coach', '2026-08-01', ?, ?)
      `).run(approvedAt, approvedAt)
      sqlite.prepare(`
        INSERT INTO staff_attendance_records (
          id, coach_account_id, date_key, choice, marked_by_account_id,
          created_at, updated_at
        ) VALUES (
          'attendance-one', 'junior', '2026-08-01', 'present',
          '00000000-0000-4000-8000-000000000001', ?, ?
        )
      `).run(approvedAt, approvedAt)

      expect(() => sqlite.prepare(`
        INSERT INTO staff_attendance_records (
          id, coach_account_id, date_key, choice, marked_by_account_id,
          created_at, updated_at
        ) VALUES (
          'attendance-duplicate', 'junior', '2026-08-01', 'absent',
          '00000000-0000-4000-8000-000000000001', ?, ?
        )
      `).run(approvedAt, approvedAt)).toThrow(/UNIQUE constraint failed/u)
      expect(() => sqlite.prepare(`
        INSERT INTO staff_attendance_records (
          id, coach_account_id, date_key, choice, marked_by_account_id,
          created_at, updated_at
        ) VALUES (
          'attendance-invalid', 'junior', '2026-08-02', 'late',
          '00000000-0000-4000-8000-000000000001', ?, ?
        )
      `).run(approvedAt, approvedAt)).toThrow(/CHECK constraint failed/u)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
    }
  })
})
