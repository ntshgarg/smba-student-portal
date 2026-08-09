import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

describe("announcements migration", () => {
  it("creates immutable publication facts and constrained presentation records", () => {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    const instant = Date.parse("2026-08-09T10:00:00+05:30")

    try {
      sqlite.exec(`
        CREATE TABLE accounts (id text PRIMARY KEY NOT NULL);
        INSERT INTO accounts (id) VALUES ('coach');
      `)
      const migration = fs.readFileSync(
        path.join(process.cwd(), "drizzle", "0015_announcements.sql"),
        "utf8",
      )
      migration.split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .forEach((statement) => sqlite.exec(statement))

      sqlite.prepare(`
        INSERT INTO broadcasts (
          id, title, content, published_by_account_id, published_at,
          expires_on, publication_key, payload_fingerprint, pinned,
          presentation_revision, presentation_updated_by_account_id,
          presentation_updated_at
        ) VALUES (?, ?, ?, 'coach', ?, ?, ?, ?, 1, 0, 'coach', ?)
      `).run(
        "announcement-one",
        "Training update",
        "The academy will open at 6 am.",
        instant,
        "2026-08-09",
        "publication-one",
        "fingerprint-one",
        instant,
      )
      sqlite.prepare(`
        INSERT INTO broadcast_audience_targets (broadcast_id, audience)
        VALUES ('announcement-one', 'everyone')
      `).run()
      sqlite.prepare(`
        INSERT INTO broadcast_channels (broadcast_id, channel)
        VALUES ('announcement-one', 'homepage'), ('announcement-one', 'player_dashboard')
      `).run()
      sqlite.prepare(`
        INSERT INTO broadcast_withdrawals (
          id, broadcast_id, reason, withdrawn_by_account_id, withdrawn_at
        ) VALUES ('withdrawal-one', 'announcement-one', 'Timing changed', 'coach', ?)
      `).run(instant)

      expect(sqlite.prepare("SELECT count(*) AS count FROM broadcast_channels").get())
        .toEqual({ count: 2 })
      expect(() => sqlite.prepare(`
        INSERT INTO broadcast_withdrawals (
          id, broadcast_id, reason, withdrawn_by_account_id, withdrawn_at
        ) VALUES ('withdrawal-two', 'announcement-one', 'Duplicate', 'coach', ?)
      `).run(instant)).toThrow(/UNIQUE constraint failed/u)
      expect(() => sqlite.prepare(`
        INSERT INTO broadcasts (
          id, title, content, published_by_account_id, published_at,
          expires_on, publication_key, payload_fingerprint,
          presentation_updated_by_account_id, presentation_updated_at
        ) VALUES (
          'invalid-expiry', 'Invalid', 'Invalid expiry', 'coach', ?,
          '2026-08-08', 'publication-two', 'fingerprint-two', 'coach', ?
        )
      `).run(instant, instant)).toThrow(/CHECK constraint failed/u)
      expect(() => sqlite.prepare(`
        INSERT INTO broadcast_channels (broadcast_id, channel)
        VALUES ('announcement-one', 'whatsapp')
      `).run()).toThrow(/CHECK constraint failed/u)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
    }
  })
})
