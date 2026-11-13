import "server-only"

import { and, isNull, lt, or } from "drizzle-orm"
import { SQLiteTransaction } from "drizzle-orm/sqlite-core"

import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  authEmailChallenges,
  authLoginAttempts,
  authRateLimits,
  authRuntimeSessions,
  authSecurityEvents,
  authSessions,
  authVerifications,
  clientErrorReports,
  operationalEvents,
} from "@/lib/db/schema"

/*
 * docs/ACADEMY-PRIVACY-AND-RETENTION-POLICY.md promises that sanitized
 * application-error events, server and browser, are deleted after 90 days and
 * that authentication security events go after 180. Nothing did either: the
 * tables only ever grew, and one of them takes writes from an unauthenticated
 * endpoint. These are the same numbers as the policy, in one place.
 */
export const APPLICATION_ERROR_RETENTION_DAYS = 90
export const AUTH_SECURITY_EVENT_RETENTION_DAYS = 180
// The policy also deletes expired email codes, sessions and rate limits within 90 days.
export const EXPIRED_SIGN_IN_RECORD_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

// A range delete on an indexed column is cheap, but it still should not run on
// every sign-in. Per instance is enough: an instance that is writing is the one
// that should be paying, and a second instance purging again deletes nothing.
const PURGE_INTERVAL_MS = 60 * 60 * 1000
let lastPurgeAt = 0

/** Deletes everything past its retention period. Returns how many rows went. */
export function purgeExpiredTelemetry({
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  const errorCutoff = new Date(now.getTime() - APPLICATION_ERROR_RETENTION_DAYS * DAY_MS)
  const securityCutoff = new Date(now.getTime() - AUTH_SECURITY_EVENT_RETENTION_DAYS * DAY_MS)
  const signInCutoff = new Date(now.getTime() - EXPIRED_SIGN_IN_RECORD_RETENTION_DAYS * DAY_MS)

  const clientErrors = database.delete(clientErrorReports)
    .where(lt(clientErrorReports.occurredAt, errorCutoff)).run().changes
  const serverErrors = database.delete(operationalEvents)
    .where(lt(operationalEvents.occurredAt, errorCutoff)).run().changes
  const securityEvents = database.delete(authSecurityEvents)
    .where(lt(authSecurityEvents.occurredAt, securityCutoff)).run().changes

  // Registration, recovery-email and password-recovery codes, used or not.
  const emailCodes = database.delete(authEmailChallenges)
    .where(lt(authEmailChallenges.expiresAt, signInCutoff)).run().changes
    + database.delete(authVerifications)
      .where(lt(authVerifications.expiresAt, signInCutoff)).run().changes
  const expiredSessions = database.delete(authSessions)
    .where(lt(authSessions.expiresAt, signInCutoff)).run().changes
    + database.delete(authRuntimeSessions)
      .where(lt(authRuntimeSessions.expiresAt, signInCutoff)).run().changes
  // Better Auth stores lastRequest as epoch milliseconds, not as a date column.
  const rateLimits = database.delete(authRateLimits)
    .where(lt(authRateLimits.lastRequest, signInCutoff.getTime())).run().changes
    + database.delete(authLoginAttempts)
      .where(and(
        lt(authLoginAttempts.updatedAt, signInCutoff),
        or(isNull(authLoginAttempts.blockedUntil), lt(authLoginAttempts.blockedUntil, signInCutoff)),
      )).run().changes

  return {
    clientErrors,
    emailCodes,
    expiredSessions,
    rateLimits,
    securityEvents,
    serverErrors,
  }
}

/**
 * Runs the purge at most once an hour per instance, from the write paths that
 * grow these tables, so the cost lands on whoever is producing the rows and no
 * scheduler has to exist. It never throws: a failed purge must not turn a
 * sign-in or an error report into a failure.
 * Skipped inside a transaction, whose rollback would undo the purge.
 */
export function purgeExpiredTelemetryOccasionally({
  database,
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  if (database instanceof SQLiteTransaction) return
  if (now.getTime() - lastPurgeAt < PURGE_INTERVAL_MS) return
  try {
    purgeExpiredTelemetry({ database, now })
    lastPurgeAt = now.getTime()
  } catch (error) {
    console.error("SMBA could not purge expired telemetry.", {
      cause: error instanceof Error ? error.name : "unknown",
    })
  }
}

/** For tests: forget when the last purge ran. */
export function resetTelemetryPurgeThrottle() {
  lastPurgeAt = 0
}
