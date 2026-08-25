import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const migrationsDirectory = path.resolve(import.meta.dirname, "..", "drizzle")
const metaDirectory = path.join(migrationsDirectory, "meta")

// drizzle-kit stamps the very first snapshot with an all-zero parent, so the
// walk below can start from it instead of special-casing index 0.
const rootParentId = "00000000-0000-0000-0000-000000000000"

type JournalEntry = {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

type Journal = {
  version: string
  dialect: string
  entries: JournalEntry[]
}

type Snapshot = {
  id: string
  prevId: string
  version: string
  dialect: string
}

function readJson<Shape>(file: string) {
  return JSON.parse(readFileSync(file, "utf8")) as Shape
}

function snapshotPathFor(entry: JournalEntry) {
  return path.join(metaDirectory, `${String(entry.idx).padStart(4, "0")}_snapshot.json`)
}

const journal = readJson<Journal>(path.join(metaDirectory, "_journal.json"))

const entriesWithoutSnapshot = journal.entries.filter(
  (entry) => !existsSync(snapshotPathFor(entry)),
)

// One pass over the journal in applied order, linking each surviving snapshot
// to the one before it. A gap is skipped rather than reported here: the next
// snapshot rolls the skipped migrations up, so it is expected to name the last
// snapshot that still exists as its parent.
const parentLinkBreaks: Array<{ tag: string; prevId: string; expected: string }> = []
let expectedParentId = rootParentId
for (const entry of journal.entries) {
  if (!existsSync(snapshotPathFor(entry))) continue
  const snapshot = readJson<Snapshot>(snapshotPathFor(entry))
  if (snapshot.prevId !== expectedParentId) {
    parentLinkBreaks.push({
      tag: entry.tag,
      prevId: snapshot.prevId,
      expected: expectedParentId,
    })
  }
  expectedParentId = snapshot.id
}

// `drizzle-kit check` cannot stand in for any of this. In drizzle-kit's bundled
// bin.cjs, checkHandler calls prepareOutFolder, which does parse
// drizzle/meta/_journal.json -- but it destructures only `{ snapshots }` from
// the result and drops the journal on the floor. What it keeps is a readdirSync
// of drizzle/meta, handed to validateWithReport, which reports only snapshots
// that fail schema parsing, that sit below the dialect's snapshot version, or
// that share a prevId with a sibling. So a journal entry with no snapshot is
// invisible to it: the journal it read is never compared to the folder it
// listed. And a prevId is only ever used as a map key for that sibling
// collision check, never resolved back to a real id, so a parent pointer aimed
// at nothing is invisible too. It exits 0 on this folder today, which is what
// makes the "Validate migrations" step in .github/workflows/quality.yml a gate
// that cannot fail.
describe("migration journal and snapshot chain", () => {
  it("pairs every journal entry with its migration file and leaves no orphan snapshot", () => {
    expect(journal.dialect).toBe("sqlite")
    expect(journal.entries.length).toBeGreaterThan(0)

    journal.entries.forEach((entry, index) => {
      expect(entry.idx, entry.tag).toBe(index)
      expect(entry.tag.startsWith(`${String(index).padStart(4, "0")}_`), entry.tag).toBe(true)
      expect(existsSync(path.join(migrationsDirectory, `${entry.tag}.sql`)), entry.tag).toBe(true)
    })

    const journalIndexes = new Set(
      journal.entries.map((entry) => String(entry.idx).padStart(4, "0")),
    )
    const orphanSnapshots = readdirSync(metaDirectory)
      .filter((file) => /^\d{4}_snapshot\.json$/u.test(file))
      .filter((file) => !journalIndexes.has(file.slice(0, 4)))

    expect(orphanSnapshots).toEqual([])
  })

  it("keeps the newest migration snapshotted because generate diffs against it", () => {
    // drizzle-kit's preparePrevSnapshot takes snapshots[snapshots.length - 1]
    // from a lexicographically sorted readdir of drizzle/meta. If the newest
    // migration had no snapshot, the next `drizzle-kit generate` would diff the
    // schema against an older state and emit SQL that re-creates tables the
    // database already has.
    const newest = journal.entries[journal.entries.length - 1]

    expect(entriesWithoutSnapshot.map((entry) => entry.tag)).not.toContain(newest.tag)

    const newestSnapshot = readJson<Snapshot>(snapshotPathFor(newest))
    expect(newestSnapshot.dialect).toBe("sqlite")
    expect(newestSnapshot.version).toBe("6")
  })

  it("holds the unsnapshotted migrations and broken parent links to a frozen inventory", () => {
    // Both lists describe applied schema history, so neither is repaired by
    // editing drizzle/meta — that is how a chain gets corrupted for real. They
    // are pinned instead: a new break fails this test, and so does a repair,
    // which forces the repair to be a deliberate edit here rather than a silent
    // one. Equality, not containment, is the point.

    // Six migrations were committed with a SQL file and a journal entry but no
    // snapshot. The chain stays continuous because the following snapshot rolls
    // them up — 0007_snapshot already carries the report_publications
    // .attendance_snapshot column added by 0003, and 0015_snapshot already
    // carries the coach_profiles and staff_attendance_records tables added by
    // 0014 — but their intermediate states are unrecorded, so nothing can
    // reconstruct the schema as it stood between 0002 and 0007.
    expect(entriesWithoutSnapshot.map((entry) => entry.tag)).toEqual([
      "0003_report_attendance_snapshots",
      "0004_session_driven_attendance",
      "0005_reschedulable_session_occurrences",
      "0006_level_batch_multi_session",
      "0013_finance_records_indexes",
      "0014_coach_profiles_and_staff_attendance",
    ])

    // 0015_snapshot.json's prevId is the first 16 characters of
    // 0012_snapshot.json's id followed by the last 20 of 0011_snapshot.json's,
    // i.e. a hand-spliced UUID, which fits the rest of this hand-authored
    // stretch. It resolves to no snapshot in the folder.
    expect(parentLinkBreaks).toEqual([
      {
        tag: "0015_announcements",
        prevId: "cb67207c-1ade-45cc-b630-dd9dc216b155",
        expected: "cb67207c-1ade-45a8-8845-13415a43e440",
      },
    ])

    const snapshotIds = new Set(
      journal.entries
        .filter((entry) => existsSync(snapshotPathFor(entry)))
        .map((entry) => readJson<Snapshot>(snapshotPathFor(entry)).id),
    )
    const unresolvableParents = parentLinkBreaks
      .filter((breakage) => !snapshotIds.has(breakage.prevId))
      .map((breakage) => breakage.tag)

    expect(unresolvableParents).toEqual(["0015_announcements"])
  })
})
