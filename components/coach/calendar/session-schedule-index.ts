import type {
  SessionAssignment,
  TrainingProgramme,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

const programmes: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult", "Elite"]

export function assignmentKey(playerId: string, seriesId: string) {
  return `${playerId}:${seriesId}`
}

export function buildSessionScheduleIndex(assignments: SessionAssignment[]) {
  const activeByPlayer = new Map<string, SessionAssignment[]>()
  const activeBySeries = new Map<string, SessionAssignment[]>()
  const activeByPlayerSeries = new Map<string, SessionAssignment>()

  assignments.forEach((assignment) => {
    if (assignment.effectiveTo) return
    const playerAssignments = activeByPlayer.get(assignment.playerId) ?? []
    playerAssignments.push(assignment)
    activeByPlayer.set(assignment.playerId, playerAssignments)
    const seriesAssignments = activeBySeries.get(assignment.seriesId) ?? []
    seriesAssignments.push(assignment)
    activeBySeries.set(assignment.seriesId, seriesAssignments)
    activeByPlayerSeries.set(
      assignmentKey(assignment.playerId, assignment.seriesId),
      assignment,
    )
  })

  return { activeByPlayer, activeByPlayerSeries, activeBySeries }
}

export function buildProgrammeGroups(
  seriesRecords: TrainingSessionSeries[],
  activeBySeries: Map<string, SessionAssignment[]>,
) {
  return programmes.flatMap((programme) => {
    const series = seriesRecords.filter((item) => (
      item.status === "active" && item.programme === programme
    ))
    if (!series.length) return []
    const playerIds = new Set(series.flatMap((item) => (
      (activeBySeries.get(item.id) ?? []).map((assignment) => assignment.playerId)
    )))
    return [{ playerCount: playerIds.size, programme, series }]
  })
}
