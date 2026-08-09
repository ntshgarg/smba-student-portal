import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

describe("registration idempotency migration", () => {
  it("preserves legacy accounts and enforces only non-null request keys", () => {
    const sqlite = new Database(":memory:")

    try {
      sqlite.pragma("foreign_keys = ON")
      sqlite.exec(`
        CREATE TABLE accounts (
          id text PRIMARY KEY NOT NULL,
          full_name text NOT NULL,
          normalized_name text NOT NULL,
          requested_role text NOT NULL,
          approval_status text DEFAULT 'pending' NOT NULL,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        INSERT INTO accounts (
          id, full_name, normalized_name, requested_role, created_at, updated_at
        ) VALUES
          ('legacy-one', 'Mira Rao', 'mira rao', 'player', 1, 1),
          ('legacy-two', 'Mira Rao', 'mira rao', 'player', 2, 2);
      `)

      const migration = fs.readFileSync(
        path.join(process.cwd(), "drizzle", "0016_registration_request_idempotency.sql"),
        "utf8",
      )
      migration.split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .forEach((statement) => sqlite.exec(statement))

      expect(sqlite.prepare(`
        SELECT id,
          registration_request_fingerprint AS requestFingerprint,
          registration_request_key AS requestKey
        FROM accounts
        ORDER BY id
      `).all()).toEqual([
        { id: "legacy-one", requestFingerprint: null, requestKey: null },
        { id: "legacy-two", requestFingerprint: null, requestKey: null },
      ])

      const insert = sqlite.prepare(`
        INSERT INTO accounts (
          id, full_name, normalized_name, registration_request_key,
          requested_role, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'player', ?, ?)
      `)
      insert.run("new-one", "Riya Rao", "riya rao", null, 3, 3)
      insert.run(
        "new-two",
        "Aarav Rao",
        "aarav rao",
        "11111111-1111-4111-8111-111111111111",
        4,
        4,
      )
      expect(() => insert.run(
        "duplicate-key",
        "Another Player",
        "another player",
        "11111111-1111-4111-8111-111111111111",
        5,
        5,
      )).toThrow(/UNIQUE constraint failed/u)

      expect(sqlite.prepare("SELECT count(*) AS count FROM accounts").get())
        .toEqual({ count: 4 })
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      sqlite.close()
    }
  })
})
