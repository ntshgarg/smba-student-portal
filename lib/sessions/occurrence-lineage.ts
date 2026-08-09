import "server-only"

import { inArray } from "drizzle-orm"

import type { SmbaDatabaseExecutor } from "@/lib/db/client"
import { sessionOccurrences } from "@/lib/db/schema"

type OccurrenceLineageRow = {
  id: string
  seriesId: string
  occurrenceDate: string
  replacementForOccurrenceId: string | null
}

const QUERY_CHUNK_SIZE = 500

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

/**
 * Resolves the immutable source date that controls assignment and roster
 * eligibility. The occurrence's own date remains the operational date used
 * for scheduling, attendance chronology, and reporting.
 */
export function resolveOccurrenceEligibilityDates<T extends OccurrenceLineageRow>(
  executor: SmbaDatabaseExecutor,
  occurrences: readonly T[],
): Array<T & { eligibilityDate: string }> {
  if (!occurrences.length) return []

  const occurrenceById = new Map<string, OccurrenceLineageRow>()
  occurrences.forEach((occurrence) => occurrenceById.set(occurrence.id, occurrence))

  let missingAncestorIds = new Set(
    occurrences.flatMap((occurrence) => (
      occurrence.replacementForOccurrenceId
        && !occurrenceById.has(occurrence.replacementForOccurrenceId)
        ? [occurrence.replacementForOccurrenceId]
        : []
    )),
  )

  while (missingAncestorIds.size) {
    const requestedIds = [...missingAncestorIds]
    const fetchedRows = chunks(requestedIds, QUERY_CHUNK_SIZE).flatMap((ids) => (
      executor.select({
        id: sessionOccurrences.id,
        seriesId: sessionOccurrences.seriesId,
        occurrenceDate: sessionOccurrences.occurrenceDate,
        replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
      }).from(sessionOccurrences).where(inArray(sessionOccurrences.id, ids)).all()
    ))
    const fetchedById = new Map(fetchedRows.map((row) => [row.id, row]))

    requestedIds.forEach((id) => {
      const row = fetchedById.get(id)
      if (!row) {
        throw new Error("Replacement occurrence lineage is incomplete.")
      }
      occurrenceById.set(id, row)
    })

    missingAncestorIds = new Set(
      fetchedRows.flatMap((row) => (
        row.replacementForOccurrenceId
          && !occurrenceById.has(row.replacementForOccurrenceId)
          ? [row.replacementForOccurrenceId]
          : []
      )),
    )
  }

  return occurrences.map((occurrence) => {
    const visited = new Set<string>()
    let cursor: OccurrenceLineageRow = occurrence

    while (true) {
      if (visited.has(cursor.id)) {
        throw new Error("Replacement occurrence lineage contains a cycle.")
      }
      visited.add(cursor.id)

      if (!cursor.replacementForOccurrenceId) {
        return { ...occurrence, eligibilityDate: cursor.occurrenceDate }
      }

      const source = occurrenceById.get(cursor.replacementForOccurrenceId)
      if (!source) {
        throw new Error("Replacement occurrence lineage is incomplete.")
      }
      if (source.seriesId !== occurrence.seriesId) {
        throw new Error("Replacement occurrence lineage crosses session series.")
      }
      cursor = source
    }
  })
}
