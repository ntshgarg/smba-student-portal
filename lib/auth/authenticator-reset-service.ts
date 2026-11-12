import "server-only"

import { and, asc, desc, eq, gt, isNull, lte } from "drizzle-orm"

import { releaseSecondFactorAttempt } from "@/lib/auth/credential-service"
import { createAuthMailer, type AuthMailer } from "@/lib/auth/mailer"
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

/*
 * A request that ran out of time without a decision. Nothing marks it at the
 * moment it lapses, so it is marked whenever the queue is read: left "pending"
 * it read as still waiting to anyone who looked at the row, for ever.
 */
function expireLapsedRequests(database: SmbaDatabaseExecutor, now: Date) {
  database.update(authAuthenticatorResetRequests).set({
    resolvedAt: now,
    status: "expired",
    updatedAt: now,
  }).where(and(
    eq(authAuthenticatorResetRequests.status, "pending"),
    lte(authAuthenticatorResetRequests.expiresAt, now),
  )).run()
}

export function listPendingAuthenticatorResetRequests({
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  expireLapsedRequests(database, now)
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

/**
 * Withdraws the coach's waiting request, if there is one.
 *
 * Two ways in. The coach presses "Cancel reset request" -- because they found
 * the phone, or because they never asked and someone with their recovery inbox
 * did. Or the coach connects a new authenticator: from then on an approval
 * could only do harm, wiping the authenticator they have just set up and
 * signing them out everywhere, from a request the owner had no way to know was
 * stale. Merely signing in with a code does not withdraw it: that code can come
 * from the lost phone or the printed recovery codes the request is about.
 *
 * Recorded as declined by the coach themself, so it can never be read as the
 * owner's decision.
 */
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

/**
 * What became of the coach's latest authenticator reset request, for the page
 * a locked-out coach actually sees: the authenticator check after the password
 * or PIN. Approval needs no notice there -- an approved coach is sent straight
 * on to connect a new authenticator -- and a request the coach withdrew is
 * something they already know. Null when there is nothing to say.
 */
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

/**
 * Tells the coach, at the recovery address that asked, what the owner decided.
 * Best effort: the decision stands whether or not the email goes out, and a
 * mail outage must not turn the owner's approval into an error.
 */
export async function notifyAuthenticatorResetDecision(requestId: string, {
  database = initializeDatabase(),
  mailer,
}: {
  database?: SmbaDatabaseExecutor
  mailer?: AuthMailer
} = {}) {
  const request = database.select({
    fullName: accounts.fullName,
    recoveryEmail: authAuthenticatorResetRequests.recoveryEmail,
    status: authAuthenticatorResetRequests.status,
  }).from(authAuthenticatorResetRequests)
    .innerJoin(accounts, eq(accounts.id, authAuthenticatorResetRequests.accountId))
    .where(eq(authAuthenticatorResetRequests.id, requestId))
    .get()
  if (!request || (request.status !== "approved" && request.status !== "rejected")) return false
  const lines = request.status === "approved"
    ? [
      "The platform admin approved your request to reset your SMBA authenticator. Your old authenticator and its recovery codes no longer work, and every device was signed out.",
      "Sign in with your password or PIN and the portal will ask you to connect a new authenticator. If you have forgotten your password as well, use “Forgot password?” on the sign-in page within the next 24 hours.",
    ]
    : [
      "The platform admin did not approve your request to reset your SMBA authenticator. Nothing about your account has changed.",
      "If you still cannot sign in, speak to the platform admin, or send a new request from the authenticator page.",
    ]
  try {
    const sender = mailer ?? createAuthMailer()
    if (!sender.sendSecurityNotice) return false
    await sender.sendSecurityNotice({
      fullName: request.fullName,
      lines,
      subject: request.status === "approved"
        ? "Your SMBA authenticator reset was approved"
        : "Your SMBA authenticator reset was not approved",
      to: request.recoveryEmail,
    })
    return true
  } catch {
    return false
  }
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
