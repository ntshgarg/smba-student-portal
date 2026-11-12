import type { PlayerProfile } from "@/lib/types"

export type PlayerDashboardState =
  | "assessment-pending"
  | "schedule-pending"
  | "active"
  | "paused"
  | "term-finished"

/**
 * Which story the player's dashboard tells when there is no next session.
 * A schedule that runs out leaves the stored status "active" (nothing changes
 * by itself at term end), so a finished term is read from `termFinishedOn`
 * rather than from the status, and it comes before "paused" and "pending".
 */
export function playerDashboardState(
  player: Pick<PlayerProfile, "level" | "status" | "termFinishedOn">,
): PlayerDashboardState {
  if (player.level === "Assessment pending") return "assessment-pending"
  if (player.termFinishedOn) return "term-finished"
  if (player.status === "paused") return "paused"
  if (player.status === "unassigned") return "schedule-pending"
  return "active"
}
