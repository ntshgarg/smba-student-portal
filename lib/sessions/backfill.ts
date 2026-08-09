import "server-only"

import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"

import type { SmbaDatabase } from "@/lib/db/client"
import {
  sessionOccurrences,
  sessionRecurrenceRules,
  sessionSeries,
} from "@/lib/db/schema"
import { buildOccurrenceDrafts } from "@/lib/sessions/domain"

export type SessionOccurrenceBackfillResult = {
  examinedSeries: number
  insertedOccurrences: number
}

/**
 * Explicit release/maintenance utility for databases created before occurrence
 * generation became part of schedule creation. It is deliberately never called
 * by a read path.
 */
export function backfillSessionOccurrences({
  database,
  now = new Date(),
}: {
  database: SmbaDatabase
  now?: Date
}): SessionOccurrenceBackfillResult {
  const seriesRows = database.select().from(sessionSeries).all()
  const unboundedSeries = seriesRows.filter((series) => !series.endsOn)
  if (unboundedSeries.length) {
    throw new Error(
      `Cannot backfill ${unboundedSeries.length} session schedule${unboundedSeries.length === 1 ? "" : "s"} without an end date.`,
    )
  }

  const ruleRows = database.select().from(sessionRecurrenceRules).all()

  return database.transaction((tx) => {
    let insertedOccurrences = 0

    seriesRows.forEach((series) => {
      const existingDates = new Set(
        tx.select({ occurrenceDate: sessionOccurrences.occurrenceDate })
          .from(sessionOccurrences)
          .where(eq(sessionOccurrences.seriesId, series.id))
          .all()
          .map((occurrence) => occurrence.occurrenceDate),
      )
      const slots = ruleRows.filter((rule) => rule.seriesId === series.id)
      const drafts = buildOccurrenceDrafts({
        from: series.startsOn,
        to: series.endsOn!,
        series,
        slots,
      })

      drafts.forEach((draft) => {
        // Any occurrence at the recurrence identity is historical truth. In
        // particular, a cancelled row is a tombstone and must not be revived.
        if (existingDates.has(draft.occurrenceDate)) return
        tx.insert(sessionOccurrences).values({
          id: randomUUID(),
          ...draft,
          status: "scheduled",
          replacementForOccurrenceId: null,
          createdAt: now,
        }).run()
        existingDates.add(draft.occurrenceDate)
        insertedOccurrences += 1
      })
    })

    return { examinedSeries: seriesRows.length, insertedOccurrences }
  })
}
