import { and, eq, isNull, sql, type SQL } from "drizzle-orm"

import { accounts, authCredentialStates, authMethods } from "@/lib/db/schema"

type ApprovalStatus = (typeof accounts.$inferSelect)["approvalStatus"]
type CredentialStatus = (typeof authCredentialStates.$inferSelect)["status"]

/**
 * The one rule for "this account is live and may sign in or act": approved,
 * not archived, and nothing that signs it in has been revoked. Every sign-in,
 * session, recovery, PIN, two-factor and admin door reads it, each adding only
 * what is its own (a role, an active credential, a live Academy ID, a matching
 * recovery email), so the doors cannot drift apart.
 *
 * Archiving revokes the Academy ID and the credential in the same transaction
 * (revokePortalAccess in lib/coach/member-service.ts), so the last two facts
 * are defence in depth: they also refuse a row revoked by any other means. A
 * missing method or credential row is not a revocation.
 */
export type AccountLiveFacts = {
  approvalStatus: ApprovalStatus
  archivedAt: Date | null
  /** revoked_at of the account's academy_id method; null or absent when live or missing. */
  academyIdRevokedAt?: Date | null
  /** auth_credential_states.status; null or absent when the account has no row. */
  credentialStatus?: CredentialStatus | null
}

export function isAccountLive(facts: AccountLiveFacts) {
  return facts.approvalStatus === "approved"
    && facts.archivedAt == null
    && facts.academyIdRevokedAt == null
    && facts.credentialStatus !== "revoked"
}

/** isAccountLive as a WHERE condition on a query that reads `accounts` (unaliased). */
export function accountIsLive(): SQL {
  return and(
    eq(accounts.approvalStatus, "approved"),
    isNull(accounts.archivedAt),
    sql`not exists (select 1 from ${authMethods} where ${authMethods.accountId} = ${accounts.id} and ${authMethods.method} = 'academy_id' and ${authMethods.revokedAt} is not null)`,
    sql`not exists (select 1 from ${authCredentialStates} where ${authCredentialStates.accountId} = ${accounts.id} and ${authCredentialStates.status} = 'revoked')`,
  )!
}
