import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatSessionTimeRange } from "@/lib/format"
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

  // Each open place as its time and days (the record already shows the level
  // and batch), noting a place whose schedule's term has finished.
  const sessionTimesByPlayer = new Map<string, string[]>()
  activeByPlayer.forEach((playerAssignments, playerId) => {
    sessionTimesByPlayer.set(playerId, playerAssignments.flatMap((assignment) => {
      const series = seriesById.get(assignment.seriesId)
      if (!series) return []
      const slot = series.slots[0]
      const finished = today && scheduleTermFinished(series, today) && series.endsOn
        ? ` (term finished ${formatTermDate(series.endsOn)})`
        : ""
      const range = formatSessionTimeRange({
        startTime: slot?.startTime ?? "",
        durationMinutes: slot?.durationMinutes ?? 0,
      })
      const days = assignment.weekdays.map((weekday) => weekdayLabels[weekday]).join(", ")
      return [[range, days].filter(Boolean).join(" · ") + finished]
    }))
  })

  return { earliestByPlayer, playerById, sessionTimesByPlayer }
}
