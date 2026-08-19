import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"

import {
  createDatabaseSnapshot,
  verifyDatabaseSnapshot,
} from "@/scripts/operations/database-snapshot.mjs"

const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-snapshot-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe("database snapshots", () => {
  it("copies schema, rows, indexes and sequences into a verified snapshot", () => {
    const directory = temporaryDirectory()
    const sourcePath = path.join(directory, "source.db")
    const snapshotPath = path.join(directory, "backup.db")
    const source = new BetterSqlite3(sourcePath)
    source.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE parent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE child (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL REFERENCES parent(id),
        note TEXT NOT NULL
      );
      CREATE INDEX child_parent_idx ON child(parent_id);
      INSERT INTO parent (name) VALUES ('academy');
      INSERT INTO child (parent_id, note) VALUES (1, 'verified');
    `)
    source.close()

    const created = createDatabaseSnapshot({
      outputPath: snapshotPath,
      source: sourcePath,
    })
    const verified = verifyDatabaseSnapshot({ snapshotPath })
    const snapshot = new BetterSqlite3(snapshotPath, { readonly: true })

    expect(created.manifest.rowCounts).toMatchObject({ child: 1, parent: 1 })
    expect(verified).toMatchObject({ file: "backup.db", tables: 2 })
    expect(snapshot.prepare("SELECT note FROM child").get()).toEqual({ note: "verified" })
    expect(snapshot.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'child'").get())
      .toEqual({ seq: 1 })
    expect(snapshot.prepare("SELECT name FROM sqlite_master WHERE name = 'child_parent_idx'").get())
      .toEqual({ name: "child_parent_idx" })
    snapshot.close()
  })

  it("rejects a snapshot whose contents no longer match its manifest", () => {
    const directory = temporaryDirectory()
    const sourcePath = path.join(directory, "source.db")
    const snapshotPath = path.join(directory, "backup.db")
    const source = new BetterSqlite3(sourcePath)
    source.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sample VALUES (1, 'one');")
    source.close()
    createDatabaseSnapshot({ outputPath: snapshotPath, source: sourcePath })

    const snapshot = new BetterSqlite3(snapshotPath)
    snapshot.prepare("UPDATE sample SET value = 'changed' WHERE id = 1").run()
    snapshot.close()

    expect(() => verifyDatabaseSnapshot({ snapshotPath }))
      .toThrow("checksum does not match")
  })
})
