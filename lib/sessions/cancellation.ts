import type { TrainingSessionOccurrence } from "@/lib/sessions/types"

/**
 * Why a cancelled session is off, as far as a screen can tell: a holiday, a
 * move to another day or time, or an ordinary cancellation. A move can be moved
 * again, so the chain of replacements is followed to its end. Ending a schedule
 * is recorded the same way as an ordinary cancellation, so it reads as "Cancelled".
 * The calendar and the Mark tab both say it this way.
 */
export function cancellationLabel(
  occurrence: Pick<TrainingSessionOccurrence, "holidayId" | "id" | "occurrenceDate">,
  occurrences: readonly Pick<TrainingSessionOccurrence, "id" | "replacementForOccurrenceId" | "status">[],
  holidayByDate: ReadonlyMap<string, { label: string }>,
) {
  if (occurrence.holidayId) {
    const holiday = holidayByDate.get(occurrence.occurrenceDate)
    return holiday ? `Closed for ${holiday.label}` : "Closed for a holiday"
  }
  const seen = new Set([occurrence.id])
  let frontier = [occurrence.id]
  while (frontier.length) {
    const next: string[] = []
    for (const candidate of occurrences) {
      if (!candidate.replacementForOccurrenceId || !frontier.includes(candidate.replacementForOccurrenceId)) continue
      if (candidate.status === "scheduled") return "Moved"
      if (seen.has(candidate.id)) continue
      seen.add(candidate.id)
      next.push(candidate.id)
    }
    frontier = next
  }
  return "Cancelled"
}
