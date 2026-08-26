import {
  compareMigrationChecksums,
  computeMigrationChecksums,
  describeRecordOutcome,
  describeRecordRefusals,
  readMigrationChecksumLedger,
  writeMigrationChecksumLedger,
} from "./migration-checksums"

/**
 * Two paths, deliberately unequal in effort. Appending the checksum of a
 * migration nobody has run yet is routine and is what the bare command does.
 * Restating the checksum of a migration that was already recorded -- the only
 * way to make tests/migration-journal-integrity.test.ts accept an edited or
 * deleted migration -- is a rewrite of applied history and has to be asked for
 * by name, so that it shows up as an intent in the diff rather than as the
 * reflex of clearing a red test.
 *
 * The refusals live in describeRecordRefusals because the reflex is not only
 * "re-run the recorder": it is "delete the stale-looking entry and re-run the
 * recorder". Hollowing the ledger used to make the comparison vacuous and the
 * write silent. Two of the three shapes it takes are refused there -- an empty
 * ledger, and a hole before the newest recorded entry. The third, deleting from
 * the newest recorded entry to the end, is indistinguishable on disk from a
 * folder that has just grown and so still appends; describeRecordOutcome says
 * as much in the line this script prints for it.
 */
const rewrite = process.argv.includes("--rewrite")

const actual = computeMigrationChecksums()
const ledger = readMigrationChecksumLedger()
const comparison = compareMigrationChecksums(actual, ledger)
const refusals = describeRecordRefusals(comparison, actual, ledger)

if (!rewrite && refusals.length > 0) {
  for (const refusal of refusals) {
    console.error(refusal)
  }
  process.exit(1)
}

writeMigrationChecksumLedger(actual)

// Described from the comparison taken before the write, so the report is of
// what changed rather than of the file that now exists.
for (const line of describeRecordOutcome(comparison, actual, ledger)) {
  console.log(line)
}
