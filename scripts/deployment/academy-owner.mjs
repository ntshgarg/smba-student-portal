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
 * the PIN hash, the recovery email and the sign-in names. Compared between the
 * prepared copy and the live database, so a change made in between is noticed
 * rather than silently undone.
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
  return JSON.stringify({ password, pin, recoveryEmail, signInNames, username })
}
