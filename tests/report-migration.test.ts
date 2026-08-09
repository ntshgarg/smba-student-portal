import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

describe("report publication idempotency migration", () => {
  it("upgrades legacy publications with nullable keys without losing rows", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-report-migration-test-"))
    const databasePath = path.join(temporaryDirectory, "legacy.db")
    const database = new Database(databasePath)

    try {
      database.exec(`
        CREATE TABLE report_publications (
          id text PRIMARY KEY NOT NULL,
          report_id text NOT NULL,
          revision integer NOT NULL,
          report_text text NOT NULL,
          attendance_snapshot text,
          published_by_account_id text NOT NULL,
          published_at integer NOT NULL
        );
        INSERT INTO report_publications (
          id, report_id, revision, report_text, published_by_account_id, published_at
        ) VALUES
          ('legacy-one', 'report-one', 1, 'First legacy report', 'coach-one', 1),
          ('legacy-two', 'report-one', 2, 'Second legacy report', 'coach-one', 2);
      `)

      const migration = fs.readFileSync(
        path.join(process.cwd(), "drizzle", "0009_report_publication_idempotency.sql"),
        "utf8",
      )
      migration.split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .forEach((statement) => database.exec(statement))

      const rows = database.prepare(
        "SELECT id, publication_key AS publicationKey FROM report_publications ORDER BY id",
      ).all() as Array<{ id: string; publicationKey: string | null }>
      const index = database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      ).get("report_publications_publication_key_idx") as { sql: string } | undefined

      expect(rows).toEqual([
        { id: "legacy-one", publicationKey: null },
        { id: "legacy-two", publicationKey: null },
      ])
      expect(index?.sql).toContain("WHERE \"report_publications\".\"publication_key\" is not null")
    } finally {
      database.close()
      fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })
})
