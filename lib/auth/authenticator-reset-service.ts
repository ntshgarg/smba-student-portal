import "server-only"

import { and, asc, desc, eq, gt, isNull } from "drizzle-orm"

import { releaseSecondFactorAttempt } from "@/lib/auth/credential-service"
import { forgetTrustedDevices } from "@/lib/auth/second-factor-reset"
import { writeAuthSecurityEvent } from "@/lib/auth/security-context"
import {
  initializeDatabase,
  type SmbaDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  accounts,
  authAuthenticatorResetRequests,
  authMethods,
  authRecoveryEmails,
  authRuntimeSessions,
  authSessions,
  authTwoFactors,
  authUsers,
  coachProfiles,
} from "@/lib/db/schema"

function platformAdminActive(accountId: string, database: SmbaDatabaseExecutor) {
  return Boolean(database.select({ id: accounts.id }).from(accounts).where(and(
    eq(accounts.id, accountId),
    eq(accounts.role, "platform_admin"),
    eq(accounts.approvalStatus, "approved"),
    isNull(accounts.archivedAt),
  )).get())
}

export function listPendingAuthenticatorResetRequests({
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  return database.select({
    academyId: authMethods.identifier,
    accountId: accounts.id,
    expiresAt: authAuthenticatorResetRequests.expiresAt,
    fullName: accounts.fullName,
    id: authAuthenticatorResetRequests.id,
    recoveryEmail: authAuthenticatorResetRequests.recoveryEmail,
    requestedAt: authAuthenticatorResetRequests.requestedAt,
  }).from(authAuthenticatorResetRequests)
    .innerJoin(accounts, eq(accounts.id, authAuthenticatorResetRequests.accountId))
    .innerJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .innerJoin(authUsers, and(
      eq(authUsers.id, accounts.id),
      eq(authUsers.twoFactorEnabled, true),
    ))
    .innerJoin(coachProfiles, and(
      eq(coachProfiles.accountId, accounts.id),
      eq(coachProfiles.accessLevel, "head_admin"),
    ))
    // Approval refuses a request whose address is no longer the account's
    // recovery email, so the queue must not offer one.
    .innerJoin(authRecoveryEmails, and(
      eq(authRecoveryEmails.accountId, accounts.id),
      eq(authRecoveryEmails.email, authAuthenticatorResetRequests.recoveryEmail),
    ))
    .where(and(
      eq(authAuthenticatorResetRequests.status, "pending"),
      gt(authAuthenticatorResetRequests.expiresAt, now),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(authAuthenticatorResetRequests.requestedAt))
    .all()
}

/** The coach's own request still waiting for the owner, if there is one. */
export function getPendingAuthenticatorResetRequest(accountId: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  return database.select({
    expiresAt: authAuthenticatorResetRequests.expiresAt,
    id: authAuthenticatorResetRequests.id,
    requestedAt: authAuthenticatorResetRequests.requestedAt,
  }).from(authAuthenticatorResetRequests)
    .where(and(
      eq(authAuthenticatorResetRequests.accountId, accountId),
      eq(authAuthenticatorResetRequests.status, "pending"),
      gt(authAuthenticatorResetRequests.expiresAt, now),
    ))
    .get() ?? null
}

// Withdraws the coach's waiting request (cancelled, or a new authenticator connected).
// Recorded as rejected by the coach themself, never as the owner's decision.
export function withdrawPendingAuthenticatorResetRequests(accountId: string, {
  database = initializeDatabase(),
  now = new Date(),
  reason,
}: {
  database?: SmbaDatabase
  now?: Date
  reason: "authenticator_connected" | "cancelled_by_coach"
}) {
  return database.transaction((tx) => {
    const pending = tx.select({ id: authAuthenticatorResetRequests.id })
      .from(authAuthenticatorResetRequests)
      .where(and(
        eq(authAuthenticatorResetRequests.accountId, accountId),
        eq(authAuthenticatorResetRequests.status, "pending"),
      ))
      .all()
    if (pending.length === 0) return 0
    tx.update(authAuthenticatorResetRequests).set({
      resolvedAt: now,
      resolvedByAccountId: accountId,
      status: "rejected",
      updatedAt: now,
    }).where(and(
      eq(authAuthenticatorResetRequests.accountId, accountId),
      eq(authAuthenticatorResetRequests.status, "pending"),
    )).run()
    for (const request of pending) {
      writeAuthSecurityEvent({
        accountId,
        actorAccountId: accountId,
        eventType: "totp_reset_rejected",
        metadata: { reason, requestId: request.id },
        outcome: "success",
      }, { database: tx, now })
    }
    return pending.length
  }, { behavior: "immediate" })
}

export type AuthenticatorResetOutcome = {
  at: Date
  state: "declined" | "lapsed" | "pending"
}

/** How far back a finished request is still worth telling the coach about. */
const OUTCOME_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// What became of the coach's latest reset request, for the authenticator page. Null when there is nothing to say.
export function latestAuthenticatorResetOutcome(accountId: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}): AuthenticatorResetOutcome | null {
  const latest = database.select({
    expiresAt: authAuthenticatorResetRequests.expiresAt,
    requestedAt: authAuthenticatorResetRequests.requestedAt,
    resolvedAt: authAuthenticatorResetRequests.resolvedAt,
    resolvedByAccountId: authAuthenticatorResetRequests.resolvedByAccountId,
    status: authAuthenticatorResetRequests.status,
  }).from(authAuthenticatorResetRequests)
    .where(eq(authAuthenticatorResetRequests.accountId, accountId))
    .orderBy(desc(authAuthenticatorResetRequests.requestedAt))
    .get()
  if (!latest) return null
  if (latest.status === "pending" && latest.expiresAt > now) {
    return { at: latest.requestedAt, state: "pending" }
  }
  const lapsed = latest.status === "expired" || latest.status === "pending"
  // A lapsed request ran out at its own expiry; `resolvedAt` on an expired row
  // is only when somebody next opened the owner's queue.
  const finishedAt = lapsed
    ? latest.expiresAt
    : latest.resolvedAt ?? latest.expiresAt
  if (now.getTime() - finishedAt.getTime() > OUTCOME_NOTICE_WINDOW_MS) return null
  if (lapsed) return { at: finishedAt, state: "lapsed" }
  if (latest.status === "rejected" && latest.resolvedByAccountId !== accountId) {
    return { at: finishedAt, state: "declined" }
  }
  return null
}

export function approveAuthenticatorResetRequest(input: {
  actorAccountId: string
  requestId: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  if (!platformAdminActive(input.actorAccountId, database)) return null

  return database.transaction((tx) => {
    const request = tx.select({
      accountId: authAuthenticatorResetRequests.accountId,
      recoveryEmail: authAuthenticatorResetRequests.recoveryEmail,
    }).from(authAuthenticatorResetRequests)
      .innerJoin(accounts, and(
        eq(accounts.id, authAuthenticatorResetRequests.accountId),
        eq(accounts.role, "coach"),
        eq(accounts.approvalStatus, "approved"),
        isNull(accounts.archivedAt),
      ))
      .innerJoin(coachProfiles, and(
        eq(coachProfiles.accountId, accounts.id),
        eq(coachProfiles.accessLevel, "head_admin"),
      ))
      .innerJoin(authUsers, and(
        eq(authUsers.id, accounts.id),
        eq(authUsers.twoFactorEnabled, true),
      ))
      .where(and(
        eq(authAuthenticatorResetRequests.id, input.requestId),
        eq(authAuthenticatorResetRequests.status, "pending"),
        gt(authAuthenticatorResetRequests.expiresAt, now),
      )).get()
    if (!request) return null
    const currentRecoveryEmail = tx.select({ email: authRecoveryEmails.email })
      .from(authRecoveryEmails)
      .where(eq(authRecoveryEmails.accountId, request.accountId))
      .get()?.email
    if (currentRecoveryEmail !== request.recoveryEmail) return null

    const resolved = tx.update(authAuthenticatorResetRequests).set({
      resolvedAt: now,
      resolvedByAccountId: input.actorAccountId,
      status: "approved",
      updatedAt: now,
    }).where(and(
      eq(authAuthenticatorResetRequests.id, input.requestId),
      eq(authAuthenticatorResetRequests.status, "pending"),
    )).run()
    if (resolved.changes !== 1) return null

    tx.delete(authRuntimeSessions).where(eq(authRuntimeSessions.userId, request.accountId)).run()
    tx.delete(authSessions).where(eq(authSessions.accountId, request.accountId)).run()
    tx.delete(authTwoFactors).where(eq(authTwoFactors.userId, request.accountId)).run()
    // A reset is for a lost or stolen phone; a browser trusted earlier must not
    // keep skipping the code once a new authenticator is connected.
    forgetTrustedDevices(request.accountId, { database: tx })
    tx.update(authUsers).set({ twoFactorEnabled: false, updatedAt: now })
      .where(eq(authUsers.id, request.accountId)).run()
    // The old factor is gone, so failures against it must not stand in the way
    // of enrolling the new one.
    releaseSecondFactorAttempt(request.accountId, { database: tx })
    writeAuthSecurityEvent({
      accountId: request.accountId,
      actorAccountId: input.actorAccountId,
      eventType: "totp_reset_approved",
      metadata: { requestId: input.requestId },
      outcome: "success",
    }, { database: tx, now })
    writeAuthSecurityEvent({
      accountId: request.accountId,
      actorAccountId: input.actorAccountId,
      eventType: "sessions_revoked",
      metadata: { reason: "admin_approved_authenticator_reset", scope: "all_devices" },
      outcome: "success",
    }, { database: tx, now })
    return { accountId: request.accountId }
  }, { behavior: "immediate" })
}

export function rejectAuthenticatorResetRequest(input: {
  actorAccountId: string
  requestId: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  if (!platformAdminActive(input.actorAccountId, database)) return false
  return database.transaction((tx) => {
    const request = tx.select({ accountId: authAuthenticatorResetRequests.accountId })
      .from(authAuthenticatorResetRequests)
      .where(and(
        eq(authAuthenticatorResetRequests.id, input.requestId),
        eq(authAuthenticatorResetRequests.status, "pending"),
        gt(authAuthenticatorResetRequests.expiresAt, now),
      )).get()
    if (!request) return false
    const resolved = tx.update(authAuthenticatorResetRequests).set({
      resolvedAt: now,
      resolvedByAccountId: input.actorAccountId,
      status: "rejected",
      updatedAt: now,
    }).where(and(
      eq(authAuthenticatorResetRequests.id, input.requestId),
      eq(authAuthenticatorResetRequests.status, "pending"),
    )).run()
    if (resolved.changes !== 1) return false
    writeAuthSecurityEvent({
      accountId: request.accountId,
      actorAccountId: input.actorAccountId,
      eventType: "totp_reset_rejected",
      metadata: { requestId: input.requestId },
      outcome: "success",
    }, { database: tx, now })
    return true
  }, { behavior: "immediate" })
}
