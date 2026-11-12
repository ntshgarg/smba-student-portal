// What the two manual handover scripts in this folder agree on: which account
// is the academy's owner, what that owner signs in with, and how to read a live
// database as of one moment.
//
// The owner rule is the one scripts/database/reset-academy.ts uses, so the
// "Empty the academy" button and the manual route can never pick different
// accounts to keep. PLATFORM_OWNER_ACADEMY_ID repeats lib/auth/identity.ts's
// PLATFORM_ADMIN_ACADEMY_ID because these scripts run under plain node and
// cannot import TypeScript; tests/empty-academy-replacement.test.ts keeps the
// two equal.

export const PLATFORM_OWNER_ACADEMY_ID = "SMBA-ADMIN-0001"

export const soleOwnerQuery = `
  SELECT a.id AS id, a.full_name AS fullName, u.username AS username
  FROM accounts a
  LEFT JOIN auth_users u ON u.id = a.id
  WHERE a.role = 'platform_admin'
    AND a.approval_status = 'approved'
    AND a.archived_at IS NULL
`

/**
 * Runs `read` inside one read transaction, so everything it reads is from the
 * same moment. A plain BEGIN, not BEGIN IMMEDIATE, so a read-only token can do
 * it -- the same way scripts/operations/database-snapshot.mjs reads.
 */
export function readConsistently(database, read) {
  return database.transaction(read)()
}

/**
 * Everything the owner signs in with that a handover keeps: the password hash,
 * the PIN hash, the recovery email, the sign-in names and whether the sign-in
 * is active, must be reset or has been revoked. Compared between the prepared
 * copy and the live database, so a change made in between -- a new PIN, or an
 * owner locked out after a suspected compromise -- is noticed rather than
 * silently undone.
 */
export function ownerSignInDetails(database, ownerId) {
  const password = database.prepare(`
    SELECT password FROM auth_provider_accounts
    WHERE user_id = ? AND provider_id = 'credential'
    ORDER BY id
  `).all(ownerId).map((row) => row.password)
  const pin = database.prepare("SELECT pin_hash AS pinHash FROM auth_pin_credentials WHERE account_id = ?")
    .all(ownerId).map((row) => row.pinHash)
  const recoveryEmail = database.prepare("SELECT email FROM auth_recovery_emails WHERE account_id = ?")
    .all(ownerId).map((row) => row.email)
  const signInNames = database.prepare(`
    SELECT method, identifier FROM auth_methods
    WHERE account_id = ? AND revoked_at IS NULL
    ORDER BY method, identifier
  `).all(ownerId).map((row) => `${row.method}:${row.identifier}`)
  const username = database.prepare("SELECT username FROM auth_users WHERE id = ?")
    .all(ownerId).map((row) => row.username)
  const credentialState = database.prepare("SELECT status FROM auth_credential_states WHERE account_id = ?")
    .all(ownerId).map((row) => row.status)
  return JSON.stringify({ credentialState, password, pin, recoveryEmail, signInNames, username })
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

/**
 * One SQL statement that summarises every row of the named tables -- how many
 * rows, and for each column the total size, numeric total and first-character
 * total of its values. The database works it out and sends back one short line
 * per table, so it costs a single round trip however large the academy is.
 *
 * It is not a cryptographic hash. It exists to notice that somebody saved
 * something in the seconds between the reset's backup and its write lock, and
 * any insert, delete or ordinary edit changes it.
 */
export function contentFingerprintQuery(database, tableNames) {
  if (!tableNames.length) throw new Error("There are no tables to fingerprint.")
  const parts = tableNames.map((tableName, position) => {
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
      .map((column) => quoteIdentifier(String(column.name)))
    const measures = columns.flatMap((column) => [
      `total(length(quote(${column})))`,
      `total(CASE WHEN typeof(${column}) = 'integer' THEN ${column} END)`,
      `total(unicode(${column}))`,
    ])
    return `(SELECT json_array(count(*)${measures.map((measure) => `, ${measure}`).join("")}) `
      + `FROM ${quoteIdentifier(tableName)}) AS t${position}`
  })
  return `SELECT ${parts.join(",\n  ")}`
}

export function contentFingerprint(database, query) {
  return JSON.stringify(database.prepare(query).all())
}
