import "server-only"

import { and, eq, gt, isNull } from "drizzle-orm"

import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  accounts,
  authCredentialStates,
  authMethods,
  authRuntimeSessions,
} from "@/lib/db/schema"

type StandingOptions = {
  database?: SmbaDatabaseExecutor
  now?: Date
}

/**
 * The person a preview shows, while they can still be shown: approved, not
 * archived, signing in with a working Academy ID, and a coach or a player.
 * `getCurrentIdentity` shows this person; the proxy asks the same question
 * before it refuses a form, so the two never disagree about whether a preview
 * is still on.
 */
export function findAdminPreviewTarget(
  targetAccountId: string,
  { database = initializeDatabase() }: StandingOptions = {},
) {
  const target = database.select({
    accountId: accounts.id,
    academyId: authMethods.identifier,
    credentialStatus: authCredentialStates.status,
    fullName: accounts.fullName,
    role: accounts.role,
  }).from(accounts)
    .innerJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .innerJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .where(and(
      eq(accounts.id, targetAccountId),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
      eq(authCredentialStates.status, "active"),
    ))
    .get()
  if (target?.role !== "coach" && target?.role !== "player") return null
  return { ...target, role: target.role }
}

/**
 * Whether a preview whose cookie is signed, unexpired and tied to this
 * browser's sign-in cookie still stands on the server.
 *
 * The cookies alone cannot tell. When the owner's sign-in is ended from
 * another device -- Log out other devices, Revoke on that session, a password
 * change or recovery -- the server deletes it, but this browser keeps the old
 * cookie, and it still matches the preview. The proxy then refused every form
 * here, signing in included, for up to an hour, while every page treated the
 * visitor as signed out and so never showed Exit preview. Likewise when the
 * person being viewed is archived or loses their sign-in: the pages fall back
 * to the owner's console, whose buttons the preview kept switching off.
 *
 * A preview with nothing left behind it is a leftover, not a preview.
 */
export function adminPreviewStillStands(input: {
  actorAccountId: string
  sessionToken: string
  targetAccountId: string
}, { database = initializeDatabase(), now = new Date() }: StandingOptions = {}) {
  const ownerSignIn = database.select({ id: authRuntimeSessions.id })
    .from(authRuntimeSessions)
    .where(and(
      eq(authRuntimeSessions.token, input.sessionToken),
      eq(authRuntimeSessions.userId, input.actorAccountId),
      gt(authRuntimeSessions.expiresAt, now),
    ))
    .get()
  if (!ownerSignIn) return false
  return findAdminPreviewTarget(input.targetAccountId, { database }) !== null
}
