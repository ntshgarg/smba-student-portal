import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatSessionLabel } from "@/lib/format"
import { formatTermDate, scheduleTermFinished } from "@/lib/sessions/term"
import type {
  SessionAssignment,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/**
 * `today` is the academy's today from the server. Without it no schedule is
 * marked as finished, rather than guessing from the device's clock.
 */
export function buildMemberDirectoryIndex(
  players: PlayerMemberRecord[],
  assignments: SessionAssignment[],
  seriesRecords: TrainingSessionSeries[],
  today: string | null = null,
) {
  const playerById = new Map(players.map((player) => [player.member.id, player]))
  const seriesById = new Map(seriesRecords.map((series) => [series.id, series]))
  const activeByPlayer = new Map<string, SessionAssignment[]>()
  const earliestByPlayer = new Map<string, string>()

  assignments.forEach((assignment) => {
    const earliest = earliestByPlayer.get(assignment.playerId)
    if (!earliest || assignment.effectiveFrom < earliest) {
      earliestByPlayer.set(assignment.playerId, assignment.effectiveFrom)
    }

    if (!assignment.effectiveTo) {
      const active = activeByPlayer.get(assignment.playerId) ?? []
      active.push(assignment)
      activeByPlayer.set(assignment.playerId, active)
    }
  })

  const sessionLabelsByPlayer = new Map<string, string[]>()
  activeByPlayer.forEach((playerAssignments, playerId) => {
    sessionLabelsByPlayer.set(playerId, playerAssignments.flatMap((assignment) => {
      const series = seriesById.get(assignment.seriesId)
      if (!series) return []
      const dayLabel = assignment.weekdays
        .map((weekday) => weekdayLabels[weekday])
        .join(", ")
      const slot = series.slots[0]
      // A place on a schedule that has run out is still an open place, but
      // the label says so rather than listing it like a running one.
      const finished = today && scheduleTermFinished(series, today) && series.endsOn
        ? ` (term finished ${formatTermDate(series.endsOn)})`
        : ""
      return `${formatSessionLabel({
        programme: series.programme,
        batch: series.batch,
        startTime: slot?.startTime ?? "",
        durationMinutes: slot?.durationMinutes ?? 0,
      })} · ${dayLabel}${finished}`
    }))
  })

  return { earliestByPlayer, playerById, sessionLabelsByPlayer }
}
