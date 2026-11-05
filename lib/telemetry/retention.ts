import "server-only"

import { lt } from "drizzle-orm"

import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import { authSecurityEvents, clientErrorReports, operationalEvents } from "@/lib/db/schema"

/*
 * docs/ACADEMY-PRIVACY-AND-RETENTION-POLICY.md promises that sanitized
 * application-error events, server and browser, are deleted after 90 days and
 * that authentication security events go after 180. Nothing did either: the
 * tables only ever grew, and one of them takes writes from an unauthenticated
 * endpoint. These are the same numbers as the policy, in one place.
 */
export const APPLICATION_ERROR_RETENTION_DAYS = 90
export const AUTH_SECURITY_EVENT_RETENTION_DAYS = 180

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

  const clientErrors = database.delete(clientErrorReports)
    .where(lt(clientErrorReports.occurredAt, errorCutoff)).run().changes
  const serverErrors = database.delete(operationalEvents)
    .where(lt(operationalEvents.occurredAt, errorCutoff)).run().changes
  const securityEvents = database.delete(authSecurityEvents)
    .where(lt(authSecurityEvents.occurredAt, securityCutoff)).run().changes

  return { clientErrors, securityEvents, serverErrors }
}

/**
 * Runs the purge at most once an hour per instance, from the write paths that
 * grow these tables, so the cost lands on whoever is producing the rows and no
 * scheduler has to exist. It never throws: a failed purge must not turn a
 * sign-in or an error report into a failure.
 */
export function purgeExpiredTelemetryOccasionally({
  database,
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
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
