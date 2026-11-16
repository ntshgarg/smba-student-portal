import { and, gt, gte, isNull, lt, or } from "drizzle-orm"

import { sessionAssignments, sessionSeries } from "@/lib/db/schema"

/*
 * Which days a schedule place covers. One rule, written twice only because one
 * copy runs in code (placeReachesWindow in lib/sessions/term.ts, which client
 * screens share) and the other in a database query
 * (tests/place-coverage.test.ts proves they agree):
 *
 * - a place covers its first day up to, not including, `effective_to` (the
 *   first day off it -- unlike a fee plan, whose effective_to is its last day);
 * - a place cut back to its own first day never covered a day;
 * - its schedule's first and last day cut it off.
 */

/**
 * placeReachesWindow as a query condition on session_assignments joined to
 * session_series. `schedule: false` leaves the schedule's dates out (the code
 * form with no schedule), for a query that does not join session_series.
 */
export function placeReachesWindowCondition(
  from: string,
  toExclusive: string | null,
  { schedule = true }: { schedule?: boolean } = {},
) {
  return and(
    toExclusive === null ? undefined : lt(sessionAssignments.effectiveFrom, toExclusive),
    or(
      isNull(sessionAssignments.effectiveTo),
      and(
        gt(sessionAssignments.effectiveTo, from),
        gt(sessionAssignments.effectiveTo, sessionAssignments.effectiveFrom),
      ),
    ),
    schedule && toExclusive !== null ? lt(sessionSeries.startsOn, toExclusive) : undefined,
    schedule ? or(isNull(sessionSeries.endsOn), gte(sessionSeries.endsOn, from)) : undefined,
  )
}
