import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatSessionLabel } from "@/lib/format"
import type {
  SessionAssignment,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function buildMemberDirectoryIndex(
  players: PlayerMemberRecord[],
  assignments: SessionAssignment[],
  seriesRecords: TrainingSessionSeries[],
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
      return `${formatSessionLabel({
        programme: series.programme,
        batch: series.batch,
        startTime: slot?.startTime ?? "",
        durationMinutes: slot?.durationMinutes ?? 0,
      })} · ${dayLabel}`
    }))
  })

  return { earliestByPlayer, playerById, sessionLabelsByPlayer }
}
