import { scheduleIsRunning, scheduleTermFinished } from "@/lib/sessions/term"
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

function playerCount(
  series: TrainingSessionSeries[],
  activeBySeries: Map<string, SessionAssignment[]>,
) {
  return new Set(series.flatMap((item) => (
    (activeBySeries.get(item.id) ?? []).map((assignment) => assignment.playerId)
  ))).size
}

/**
 * The running schedules, one group per level. A schedule whose last day has
 * passed is not running any more, even though nobody has ended it, so it is
 * left to {@link buildFinishedSchedules}.
 */
export function buildProgrammeGroups(
  seriesRecords: TrainingSessionSeries[],
  activeBySeries: Map<string, SessionAssignment[]>,
  today: string,
) {
  return programmes.flatMap((programme) => {
    const series = seriesRecords.filter((item) => (
      item.programme === programme && scheduleIsRunning(item, today)
    ))
    if (!series.length) return []
    return [{ playerCount: playerCount(series, activeBySeries), programme, series }]
  })
}

/**
 * Schedules whose last day has passed but which have not been ended, shown
 * below the running ones with the players still on them. Nothing changes by
 * itself at term end (head coach, 12 Nov 2026): each player is moved on in
 * Members, or all of them at once with End schedule.
 */
export function buildFinishedSchedules(
  seriesRecords: TrainingSessionSeries[],
  activeBySeries: Map<string, SessionAssignment[]>,
  today: string,
) {
  const series = seriesRecords.filter((item) => scheduleTermFinished(item, today))
  return { playerCount: playerCount(series, activeBySeries), series }
}

/** Running schedules sit in their level's group; finished ones in "finished". */
export type ScheduleGroupKey = TrainingProgramme | "finished"

export function scheduleGroupKey(series: TrainingSessionSeries, today: string): ScheduleGroupKey {
  return scheduleTermFinished(series, today) ? "finished" : series.programme
}
