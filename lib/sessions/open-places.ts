import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import type { SmbaDatabaseExecutor } from "@/lib/db/client"
import { sessionAssignments, sessionSeries } from "@/lib/db/schema"

/**
 * A player's open place (an assignment with no end) together with the dates
 * and state of its schedule, which is what lib/sessions/term.ts needs to tell
 * a running place from one whose term has finished.
 */
export type OpenPlace = {
  accountId: string
  effectiveFrom: string
  effectiveTo: null
  endsOn: string | null
  seriesId: string
  startsOn: string
  status: "active" | "ended"
}

/** Every open place, grouped by player. Omit `accountIds` to read all players. */
export function loadOpenPlaces(
  database: SmbaDatabaseExecutor,
  accountIds?: readonly string[],
) {
  const byPlayer = new Map<string, OpenPlace[]>()
  if (accountIds && !accountIds.length) return byPlayer
  database.select({
    accountId: sessionAssignments.accountId,
    effectiveFrom: sessionAssignments.effectiveFrom,
    endsOn: sessionSeries.endsOn,
    seriesId: sessionAssignments.seriesId,
    startsOn: sessionSeries.startsOn,
    status: sessionSeries.status,
  }).from(sessionAssignments)
    .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
    .where(and(
      isNull(sessionAssignments.effectiveTo),
      accountIds ? inArray(sessionAssignments.accountId, [...new Set(accountIds)]) : undefined,
    ))
    .all()
    .forEach((row) => {
      const places = byPlayer.get(row.accountId) ?? []
      places.push({ ...row, effectiveTo: null })
      byPlayer.set(row.accountId, places)
    })
  return byPlayer
}
