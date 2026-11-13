import "server-only"

import { createHash } from "node:crypto"

import { and, asc, eq, gt, like, lt } from "drizzle-orm"

import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import { authRuntimeSessions, authSessions, authVerifications } from "@/lib/db/schema"

/*
 * What has to go when an account's second factor changes hands.
 *
 * "Trust this private device" is a Better Auth verification row whose value is
 * the account id and whose identifier the library names "trust-device-<random>"
 * (node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs).
 * The library only ever deletes the row named by the cookie of the browser it
 * is talking to, so a lost phone's trust survived reconnecting the authenticator,
 * an owner-approved reset and "Log out other devices", and that phone kept
 * skipping the code for as long as it signed in at least monthly.
 *
 * Identifiers are stored hashed (lib/auth/better-auth.ts), which left nothing
 * to tell a trust row from any other row for the same account. These are
 * hashed the same way but stored behind a readable prefix, so all of one
 * account's can be found; the random part still never reaches the database.
 */
export const TRUST_DEVICE_IDENTIFIER_PREFIX = "trust-device-"
const STORED_TRUST_DEVICE_PREFIX = "trust-device-sha256:"

export async function storedTrustDeviceIdentifier(identifier: string) {
  return `${STORED_TRUST_DEVICE_PREFIX}${createHash("sha256").update(identifier).digest("base64url")}`
}

/** Forgets every browser trusted to skip the authenticator code for this account. */
export function forgetTrustedDevices(
  accountId: string,
  { database = initializeDatabase() }: { database?: SmbaDatabaseExecutor } = {},
) {
  return database.delete(authVerifications).where(and(
    eq(authVerifications.value, accountId),
    like(authVerifications.identifier, `${TRUST_DEVICE_IDENTIFIER_PREFIX}%`),
  )).run().changes
}

// Expiries of the browsers this account trusts to skip the authenticator, soonest first.
export function listTrustedDevices(
  accountId: string,
  {
    database = initializeDatabase(),
    now = new Date(),
  }: { database?: SmbaDatabaseExecutor, now?: Date } = {},
) {
  return database.select({ expiresAt: authVerifications.expiresAt })
    .from(authVerifications)
    .where(and(
      eq(authVerifications.value, accountId),
      // Only rows the library can still find; older unprefixed ones no longer
      // skip anything and just wait out their expiry.
      like(authVerifications.identifier, `${STORED_TRUST_DEVICE_PREFIX}%`),
      gt(authVerifications.expiresAt, now),
    ))
    .orderBy(asc(authVerifications.expiresAt))
    .all()
    .map((row) => row.expiresAt)
}

// Better Auth renews a trusted browser on each sign-in (delete then create in one request).
// These hooks carry the old expiry across, so trust ends 30 days after it was first given.
const trustExpiryBeingRenewed = new WeakMap<object, { accountId: string, expiresAt: Date }>()

type TrustRow = { expiresAt: Date | number | string, identifier?: string, value?: string }

function storedTrustRow(row: TrustRow | null | undefined): row is TrustRow & { identifier: string, value: string } {
  return typeof row?.identifier === "string"
    && row.identifier.startsWith(STORED_TRUST_DEVICE_PREFIX)
    && typeof row.value === "string"
}

export const trustedDeviceDatabaseHooks = {
  verification: {
    create: {
      async before(data: TrustRow, context: object | null | undefined) {
        if (!context || !storedTrustRow(data)) return
        const renewed = trustExpiryBeingRenewed.get(context)
        if (!renewed || renewed.accountId !== data.value) return
        trustExpiryBeingRenewed.delete(context)
        if (new Date(data.expiresAt).getTime() <= renewed.expiresAt.getTime()) return
        return { data: { expiresAt: renewed.expiresAt } }
      },
    },
    delete: {
      async before(row: TrustRow, context: object | null | undefined) {
        if (!context || !storedTrustRow(row)) return
        // Better Auth also deletes rows that have already run out, as cleanup
        // during any lookup. That is not a renewal, and carrying its past date
        // over would make a trust ticked in the same request expire at once.
        if (new Date(row.expiresAt).getTime() <= Date.now()) return
        trustExpiryBeingRenewed.set(context, {
          accountId: row.value,
          expiresAt: new Date(row.expiresAt),
        })
      },
    },
  },
}

/*
 * Ends every sign-in this account started before `startedBefore`.
 *
 * While an account has no authenticator, a correct PIN or password gives a
 * plain session. Those sessions see nothing of a head coach's workspace, but
 * the account is re-read on every request, so the moment an authenticator was
 * connected from another device they became full head-coach sessions without
 * a code ever being entered. Connecting an authenticator therefore ends them;
 * Better Auth has already given the device that connected it a fresh session.
 */
export function endSessionsStartedBefore(
  accountId: string,
  startedBefore: Date,
  { database = initializeDatabase() }: { database?: SmbaDatabaseExecutor } = {},
) {
  const runtime = database.delete(authRuntimeSessions).where(and(
    eq(authRuntimeSessions.userId, accountId),
    lt(authRuntimeSessions.createdAt, startedBefore),
  )).run().changes
  const legacy = database.delete(authSessions).where(and(
    eq(authSessions.accountId, accountId),
    lt(authSessions.createdAt, startedBefore),
  )).run().changes
  return runtime + legacy
}
