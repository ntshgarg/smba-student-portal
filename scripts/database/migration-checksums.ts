import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { readMigrationFiles } from "drizzle-orm/migrator"

/**
 * A committed mirror of what the migrator writes into __drizzle_migrations.
 *
 * drizzle's SQLite migrator INSERTs each migration's hash and never reads one
 * back: SQLiteSyncDialect.migrate selects only the newest applied row and
 * compares created_at to folderMillis, so the hash column is write-only
 * (drizzle-orm/sqlite-core/dialect.cjs, and the INSERT ... VALUES(hash,
 * created_at) inside it). Editing a migration that has already run therefore
 * changes nothing on the live academy database and everything on a database
 * built from empty, with no record anywhere that the two now disagree. Every CI
 * fixture is built from empty, so CI is the half that silently accepts the edit.
 *
 * The pair recorded here is exactly the pair the migrator stores -- `when` is
 * the folderMillis it compares, `sha256` is the hash it inserts -- so this file
 * can be diffed directly against `SELECT hash, created_at FROM
 * __drizzle_migrations` on production when a divergence is suspected.
 */
export type MigrationChecksum = {
  tag: string
  when: number
  sha256: string
}

export type MigrationChecksumLedger = {
  version: string
  generatedBy: string
  entries: MigrationChecksum[]
}

export type MigrationChecksumDrift = {
  actual: MigrationChecksum
  recorded: MigrationChecksum
  tag: string
}

export type MigrationChecksumComparison = {
  /** Recorded once, but the file or its `when` has moved since. */
  drifted: MigrationChecksumDrift[]
  /**
   * Unrecorded, but the journal names an already-recorded migration after it.
   * drizzle-kit only ever appends -- a generated migration takes the next index
   * and a `when` above every existing one -- so a gap anywhere before the tail
   * is a ledger somebody edited, not a folder that grew. The tail is the blind
   * spot: entries deleted from the newest recorded one onwards leave a folder
   * shaped exactly like one that just grew, so they land in `unrecorded` rather
   * than here and no refusal can fire on them. describeRecordOutcome carries
   * what is left of that case.
   */
  gaps: string[]
  /** Recorded, but no longer named by the journal. */
  stale: string[]
  /** Named by the journal, never recorded. The ordinary state of a new migration. */
  unrecorded: string[]
}

type Journal = {
  entries: Array<{ tag: string; when: number }>
}

const ledgerVersion = "1"

export const migrationsFolder = path.resolve(import.meta.dirname, "..", "..", "drizzle")
export const checksumLedgerPath = path.join(migrationsFolder, "meta", "_checksums.json")
/** Repo-relative, because it is pasted into `git checkout` in the refusals below. */
export const checksumLedgerName = path.relative(path.dirname(migrationsFolder), checksumLedgerPath)

/** Quoted verbatim in the failure messages, so the two can never drift apart. */
export const recordChecksumsCommand = "npm run db:checksums"
export const rewriteChecksumsCommand = "npm run db:checksums -- --rewrite"

/**
 * Hashing is delegated to drizzle's own reader rather than repeated here, so
 * what this records cannot disagree with what the migrator computes at deploy
 * time. readMigrationFiles walks journal.entries in order and pushes one record
 * per entry, which is what makes the index alignment below safe; it throws if a
 * tag has no .sql file, which is a louder failure than anything drizzle-kit
 * check produces for the same folder.
 *
 * scripts/regression/fixture.ts builds the same pair privately, in
 * migrationJournal(), and folds it into a fingerprint it compares against a
 * fixture database's __drizzle_migrations. That control only fires when the
 * database predates the edit, and in CI it never does: fixture:build:all
 * migrates every fixture from empty and fixture:verify:all then compares it to
 * the folder it was just built from, so both sides carry the edit. It also
 * cannot be borrowed -- that module is a CLI that runs main() on import.
 */
export function computeMigrationChecksums(): MigrationChecksum[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json")
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal
  const migrations = readMigrationFiles({ migrationsFolder })

  return journal.entries.map((entry, index) => ({
    tag: entry.tag,
    when: migrations[index].folderMillis,
    sha256: migrations[index].hash,
  }))
}

/** An absent ledger reads as an empty one so the first run has nothing to special-case. */
export function readMigrationChecksumLedger(): MigrationChecksumLedger {
  if (!existsSync(checksumLedgerPath)) {
    return { version: ledgerVersion, generatedBy: recordChecksumsCommand, entries: [] }
  }

  return JSON.parse(readFileSync(checksumLedgerPath, "utf8")) as MigrationChecksumLedger
}

export function compareMigrationChecksums(
  actual: MigrationChecksum[] = computeMigrationChecksums(),
  ledger: MigrationChecksumLedger = readMigrationChecksumLedger(),
): MigrationChecksumComparison {
  const recordedByTag = new Map(ledger.entries.map((entry) => [entry.tag, entry]))
  const actualTags = new Set(actual.map((entry) => entry.tag))

  const drifted: MigrationChecksumDrift[] = []
  const unrecorded: string[] = []
  for (const entry of actual) {
    const recorded = recordedByTag.get(entry.tag)
    if (!recorded) {
      unrecorded.push(entry.tag)
      continue
    }
    if (recorded.sha256 !== entry.sha256 || recorded.when !== entry.when) {
      drifted.push({ actual: entry, recorded, tag: entry.tag })
    }
  }

  // Walked backwards so a tag counts as a gap only when something the ledger
  // does record follows it. The unrecorded tail of a folder that has just grown
  // never reaches `gaps`, which is what keeps a genuinely new migration routed
  // to the appending path.
  const gaps: string[] = []
  let recordedFollows = false
  for (let index = actual.length - 1; index >= 0; index -= 1) {
    const tag = actual[index].tag
    if (recordedByTag.has(tag)) {
      recordedFollows = true
    } else if (recordedFollows) {
      gaps.unshift(tag)
    }
  }

  return {
    drifted,
    gaps,
    stale: ledger.entries.map((entry) => entry.tag).filter((tag) => !actualTags.has(tag)),
    unrecorded,
  }
}

/**
 * Every line the bare `npm run db:checksums` prints before it exits 1, or none
 * if it has nothing to refuse. Split out from the script so the refusal can be
 * exercised without running the writer that follows it.
 *
 * The drift and stale arms are the obvious two. The other two exist because
 * hollowing the ledger routes around them, and both routes were reachable
 * before this function: with `DROP TABLE announcements;` appended to the
 * already-applied 0015_announcements.sql, `rm drizzle/meta/_checksums.json &&
 * npx tsx scripts/database/record-migration-checksums.ts` exited 0 and reported
 * "Recorded 31 new migration checksum(s)" -- 30 of which were restatements --
 * and deleting only 0015's entry exited 0 with the quieter "Recorded 1 new
 * migration checksum(s): 0015_announcements". Both left the same one-line
 * sha256 diff `--rewrite` leaves, so `--rewrite` bought no signal a reviewer
 * could see. An emptied or holed ledger is therefore a refusal in its own
 * right, and the remedy it names is the one that restores the recorded past
 * rather than the one that overwrites it.
 *
 * A third shape is left un-refused on purpose: deleting entries from the newest
 * recorded one to the end. Measured the same way on this folder, editing
 * 0030_session_occurrence_series_date_lookup.sql and deleting only its entry
 * still exits 0 with "Recorded 1 new migration checksum(s)", and truncating the
 * ledger from 0015 onwards exits 0 with "Recorded 16", both leaving the same
 * one-line sha256 diff. Nothing here can refuse either, because a ledger that
 * stops at 0029 while the journal names 0030 is the same on disk as the folder
 * a freshly generated 0030 produces, and refusing it would block every real
 * migration from ever being recorded. Only the committed ledger separates the
 * two, so describeRecordOutcome names that read rather than guessing.
 */
export function describeRecordRefusals(
  comparison: MigrationChecksumComparison,
  actual: MigrationChecksum[],
  ledger: MigrationChecksumLedger,
): string[] {
  const refusals: string[] = []

  if (actual.length > 0 && ledger.entries.length === 0) {
    refusals.push(
      `${checksumLedgerName} records no checksum at all while the journal names ${actual.length} `
        + `migrations, so recording now would restate all ${actual.length} as if they were new. `
        + `Restore it with \`git checkout ${checksumLedgerName}\`.`,
    )
  }

  if (comparison.gaps.length > 0) {
    refusals.push(
      `${checksumLedgerName} has no checksum for ${describeTags(comparison.gaps)}, which the journal `
        + "names before migrations it does record, so this is a hole in the ledger rather than a new "
        + `migration. Restore it with \`git checkout ${checksumLedgerName}\`.`,
    )
  }

  if (comparison.drifted.length > 0) {
    refusals.push(
      `Refusing to overwrite the recorded checksum of ${describeTags(comparison.drifted.map(describeDrift))}.`,
    )
  }

  if (comparison.stale.length > 0) {
    refusals.push(
      `Refusing to drop the recorded checksum of ${describeTags(comparison.stale)}, which the journal no longer names.`,
    )
  }

  if (refusals.length === 0) return []

  refusals.push([
    "These migrations may already have run on the live academy database, where the migrator",
    "recorded the previous checksum and will never re-read it. Add a new migration instead.",
    `If they have genuinely never been applied anywhere, run ${rewriteChecksumsCommand}.`,
  ].join(" "))

  return refusals
}

/**
 * Every line the recorder prints once the write has gone through. Split out for
 * the same reason as the refusals, and read on the path that has no refusal
 * behind it: appending is the only outcome the checks above cannot guard.
 *
 * "Recorded N new migration checksum(s)" was the whole of it, which is true of
 * the ledger and silent about the databases. A tag the ledger does not carry is
 * a migration drizzle-kit has just generated or an entry somebody deleted off
 * the end, and this function cannot tell which -- so it says so, and names the
 * read that can. Measured on a committed copy of this ledger: appending a
 * genuinely new entry is a pure insertion, 5 insertions and 0 deletions, no `-`
 * on a sha256 line; re-recording a deleted tail entry after editing its .sql is
 * 1 insertion and 1 deletion, and the deleted line is the sha256 it replaced.
 */
export function describeRecordOutcome(
  comparison: MigrationChecksumComparison,
  actual: MigrationChecksum[],
  ledger: MigrationChecksumLedger,
): string[] {
  const lines: string[] = []

  if (ledger.entries.length === 0 && actual.length > 0) {
    // Reachable only under `--rewrite` now. Calling 31 restatements "new" is
    // true of the ledger and false of every database that has already run them,
    // so this path reports what the write actually was.
    lines.push(`Recorded all ${actual.length} migration checksum(s) into an empty ledger.`)
  } else if (comparison.unrecorded.length > 0) {
    lines.push(
      `Recorded ${comparison.unrecorded.length} checksum(s) the ledger did not carry: `
        + `${describeTags(comparison.unrecorded)}.`,
    )
    lines.push(
      "An entry deleted from the end of the ledger appends exactly as a new migration does, so "
        + `confirm with \`git diff -- ${checksumLedgerName}\`: a genuinely new migration only adds `
        + "lines, while a deleted entry re-recorded after an edit deletes the sha256 it replaced.",
    )
  }

  if (comparison.drifted.length > 0) {
    lines.push(`Rewrote ${comparison.drifted.length} recorded checksum(s): ${describeTags(comparison.drifted.map(describeDrift))}.`)
  }

  if (comparison.stale.length > 0) {
    lines.push(`Dropped ${comparison.stale.length} recorded checksum(s) the journal no longer names: ${describeTags(comparison.stale)}.`)
  }

  if (comparison.unrecorded.length + comparison.drifted.length + comparison.stale.length === 0) {
    lines.push(`All ${actual.length} migrations already match their recorded checksums.`)
  }

  return lines
}

export function writeMigrationChecksumLedger(entries: MigrationChecksum[]) {
  const ledger: MigrationChecksumLedger = {
    version: ledgerVersion,
    generatedBy: recordChecksumsCommand,
    entries,
  }
  writeFileSync(checksumLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
}

/** Keeps a failure message readable when the list is the whole folder. */
export function describeTags(tags: string[], limit = 4) {
  if (tags.length <= limit) return tags.join(", ")
  return `${tags.slice(0, limit).join(", ")} and ${tags.length - limit} more`
}

export function describeDrift(drift: MigrationChecksumDrift) {
  const changed: string[] = []
  if (drift.recorded.sha256 !== drift.actual.sha256) {
    changed.push(`sha256 ${drift.recorded.sha256.slice(0, 12)} -> ${drift.actual.sha256.slice(0, 12)}`)
  }
  if (drift.recorded.when !== drift.actual.when) {
    changed.push(`when ${drift.recorded.when} -> ${drift.actual.when}`)
  }
  return `${drift.tag} (${changed.join(", ")})`
}
