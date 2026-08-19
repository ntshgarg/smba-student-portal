import "server-only"

import { and, asc, eq, gt, isNull } from "drizzle-orm"

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
    .where(and(
      eq(authAuthenticatorResetRequests.status, "pending"),
      gt(authAuthenticatorResetRequests.expiresAt, now),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(authAuthenticatorResetRequests.requestedAt))
    .all()
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
    tx.update(authUsers).set({ twoFactorEnabled: false, updatedAt: now })
      .where(eq(authUsers.id, request.accountId)).run()
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
