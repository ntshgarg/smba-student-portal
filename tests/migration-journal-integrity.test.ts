import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  checksumLedgerName,
  checksumLedgerPath,
  compareMigrationChecksums,
  computeMigrationChecksums,
  describeDrift,
  describeRecordOutcome,
  describeRecordRefusals,
  describeTags,
  type MigrationChecksum,
  readMigrationChecksumLedger,
  recordChecksumsCommand,
  rewriteChecksumsCommand,
} from "@/scripts/database/migration-checksums"

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
// at nothing is invisible too. It never opens a migration .sql at all, and it
// never reads `when`. Re-verified against drizzle-kit 0.31.10 on a scratch copy
// of this folder: deleting 0015_snapshot.json, deleting 0015_announcements.sql,
// pointing that snapshot's prevId at a uuid nothing owns, appending a DROP
// TABLE to that .sql, and moving 0015's `when` below 0014's each printed
// "Everything's fine" and exited 0. It exits 0 on this folder today, which is
// what makes the "Validate migrations" step in .github/workflows/quality.yml a
// gate that cannot fail.
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

  it("keeps `when` strictly increasing, because the migrator applies above a high-water mark", () => {
    // SQLiteSyncDialect.migrate reads one row -- SELECT id, hash, created_at
    // ... ORDER BY created_at DESC LIMIT 1 -- and then runs every migration
    // whose folderMillis is greater than that single value. It is a high-water
    // mark, not a set difference, and `when` is exactly what readMigrationFiles
    // hands over as folderMillis. So an entry whose `when` lands at or below an
    // already-applied entry's is skipped forever on any database that has
    // migrated past it, while applying normally on any database built from
    // empty. Every fixture CI builds is built from empty, which is what makes
    // CI structurally incapable of reproducing the schema production would be
    // left holding. Eight of the entries below have a `when` that is a whole
    // number of seconds and four of those are round to ten million ms, so this
    // journal already contains hand-chosen timestamps and the ordering it
    // happens to have is not something generation guarantees.
    const outOfOrder = journal.entries.flatMap((entry, index) => {
      if (index === 0) return []
      const previous = journal.entries[index - 1]
      if (entry.when > previous.when) return []
      return [`${entry.tag} (when ${entry.when}) after ${previous.tag} (when ${previous.when})`]
    })

    expect(
      outOfOrder,
      "Each journal entry's `when` must be greater than the entry before it, or the migration is "
        + "skipped on every database that has already run past it and applied on every fresh one. "
        + "Regenerate the migration with drizzle-kit rather than hand-editing `when`.",
    ).toEqual([])
  })

  it("holds every migration file to the checksum committed alongside it", () => {
    // The migrator INSERTs each migration's hash into __drizzle_migrations and
    // never reads one back -- the only column it ever selects for a decision is
    // created_at. The hash is therefore write-only, and editing a migration
    // that has already run is silent in both directions: the live academy keeps
    // the statements it applied, every database built from empty gets the new
    // ones, and nothing anywhere compares the two. drizzle/meta/_checksums.json
    // is the missing read. It records the same pair the migrator stores, taken
    // from drizzle's own readMigrationFiles rather than recomputed here, so a
    // suspected divergence can be settled by diffing it against SELECT hash,
    // created_at FROM __drizzle_migrations on the database in question.
    //
    // A migration the journal names but the ledger does not is an ordinary new
    // migration, and the message says so. A migration whose recorded checksum
    // has moved is a rewrite of applied history, and the message says that
    // instead. They are separated because only one of the two has an answer
    // that is safe to reach for.
    const ledger = readMigrationChecksumLedger()
    const comparison = compareMigrationChecksums(computeMigrationChecksums(), ledger)
    const drifted = comparison.drifted.map(describeDrift)

    expect(
      existsSync(checksumLedgerPath),
      `${path.relative(process.cwd(), checksumLedgerPath)} is missing. `
        + `Run \`${recordChecksumsCommand}\` to write it.`,
    ).toBe(true)

    expect(
      comparison.unrecorded,
      `New migrations have no recorded checksum yet: ${describeTags(comparison.unrecorded)}. `
        + `Run \`${recordChecksumsCommand}\`, then read the ledger diff: recording a migration `
        + "that is genuinely new only adds lines. A deleted sha256 line means the entry was "
        + "already recorded and something removed it, which is a rewrite of applied history.",
    ).toEqual([])

    expect(
      drifted,
      `These migrations no longer match the checksum committed with them: ${describeTags(drifted)}. `
        + "Any database that has already applied one keeps the statements it applied and will never "
        + "be offered the edit, so the edit reaches fixtures only. Add a new migration instead. If "
        + "one of these has genuinely never been applied anywhere, re-record it with "
        + `\`${rewriteChecksumsCommand}\`.`,
    ).toEqual([])

    expect(
      comparison.stale,
      `The ledger records migrations the journal no longer names: ${describeTags(comparison.stale)}. `
        + "Dropping a migration from the journal does not undo it on a database that has already "
        + `applied it. If the removal is deliberate, re-record with \`${rewriteChecksumsCommand}\`.`,
    ).toEqual([])

    expect(ledger.entries.length, "one recorded checksum per journal entry").toBe(
      journal.entries.length,
    )
  })
})

// The test above is only as strong as the effort it takes to make it green the
// wrong way. `npm run db:checksums -- --rewrite` is the sanctioned way, and it
// reads as an intent in the shell history and in review. Deleting the ledger,
// or deleting an entry the ledger still records something after, used to reach
// the identical one-line sha256 diff through a command that reports success --
// measured on this folder with a `DROP TABLE announcements;` appended to the
// already-applied 0015_announcements.sql, which produced exit 0 and "Recorded
// 31 new migration checksum(s)" for the whole-file delete and exit 0 with
// "Recorded 1 new migration checksum(s): 0015_announcements" for the
// single-entry delete. Those two are refused now. Deleting from the newest
// recorded entry onwards is not, and cannot be: on disk it is the folder a
// freshly generated migration leaves. These cover both halves on the same
// functions the script runs.
describe("recording a migration checksum", () => {
  const ledgerOf = (entries: MigrationChecksum[]) => ({
    version: "1",
    generatedBy: recordChecksumsCommand,
    entries,
  })
  const applied: MigrationChecksum[] = [
    { tag: "0000_init_shared_identity", when: 1785661333261, sha256: "aaaa" },
    { tag: "0001_single_active_batch_and_adult_level", when: 1785665343029, sha256: "bbbb" },
    { tag: "0002_align_level_with_current_batch", when: 1785665539030, sha256: "cccc" },
  ]
  const refusalsFor = (actual: MigrationChecksum[], entries: MigrationChecksum[]) => {
    const ledger = ledgerOf(entries)
    return describeRecordRefusals(compareMigrationChecksums(actual, ledger), actual, ledger)
  }
  const outcomeFor = (actual: MigrationChecksum[], entries: MigrationChecksum[]) => {
    const ledger = ledgerOf(entries)
    return describeRecordOutcome(compareMigrationChecksums(actual, ledger), actual, ledger).join(" ")
  }

  it("appends a migration the folder has genuinely just grown", () => {
    const grown = [...applied, { tag: "0003_report_attendance_snapshots", when: 1785668400000, sha256: "dddd" }]

    expect(refusalsFor(grown, applied)).toEqual([])
  })

  it("refuses an empty ledger rather than restating every migration as new", () => {
    // The ledger reads as empty whether it was deleted or truncated, so this is
    // the one condition for both. Without it the comparison has nothing to
    // compare against, every tag lands in `unrecorded`, and the write is silent.
    const refusals = refusalsFor(applied, [])

    expect(refusals.length).toBeGreaterThan(0)
    expect(refusals.join(" ")).toContain(`git checkout ${checksumLedgerName}`)
    expect(refusals.join(" ")).toContain(rewriteChecksumsCommand)
  })

  it("refuses a hole punched in the middle of the ledger", () => {
    // Quieter than deleting the whole file -- it reports a single new
    // migration -- and it reaches the same restated checksum.
    const refusals = refusalsFor(applied, [applied[0], applied[2]])

    expect(refusals.length).toBeGreaterThan(0)
    expect(refusals.join(" ")).toContain("0001_single_active_batch_and_adult_level")
    expect(refusals.join(" ")).toContain(`git checkout ${checksumLedgerName}`)
  })

  it("appends a deleted tail entry without refusing it, and says so instead of reporting success", () => {
    // The residual case, and the likeliest one: edit the migration you applied
    // most recently, delete the single stale-looking entry, re-run. Measured on
    // this folder, that is exit 0 and "Recorded 1 new migration checksum(s):
    // 0030_session_occurrence_series_date_lookup" with a one-line sha256 diff
    // identical to --rewrite's. No refusal can fire, because a ledger stopping
    // one entry short of the journal is the same shape whichever way it got
    // there -- both arrive here as a single tag the ledger does not carry. So
    // the two print the same sentences, and those sentences name the read that
    // does separate them.
    const tailDeleted = applied.slice(0, 2)
    const grown = [...applied, { tag: "0003_report_attendance_snapshots", when: 1785668400000, sha256: "dddd" }]
    const afterTailDelete = outcomeFor(applied, tailDeleted)
    const afterGrowth = outcomeFor(grown, applied)

    expect(refusalsFor(applied, tailDeleted)).toEqual([])
    expect(afterTailDelete).toContain("0002_align_level_with_current_batch")
    expect(afterGrowth).toContain("0003_report_attendance_snapshots")

    for (const outcome of [afterTailDelete, afterGrowth]) {
      expect(outcome).toContain(`git diff -- ${checksumLedgerName}`)
      expect(outcome).toContain("deletes the sha256 it replaced")
    }

    // The control: a run with nothing to record makes no claim about deletions.
    expect(outcomeFor(applied, applied)).not.toContain("git diff")
  })

  it("has nothing to refuse about the ledger committed in this folder", () => {
    // Guards the gap walk against the folder it actually runs on: a false
    // refusal here would block the next real migration from being recorded.
    const actual = computeMigrationChecksums()
    const ledger = readMigrationChecksumLedger()

    expect(describeRecordRefusals(compareMigrationChecksums(actual, ledger), actual, ledger)).toEqual([])
  })
})
