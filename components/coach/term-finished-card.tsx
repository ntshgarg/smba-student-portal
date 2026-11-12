import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"
import { termFinishedMembersHref } from "@/components/coach/members/member-directory-query"

/**
 * A to-do that only appears while it has something in it: players whose
 * schedule has reached its last day but who are still on it, with no move or
 * end booked for them yet (termFinishedToMove in lib/sessions/term.ts).
 * Nothing moves them by itself (head coach, 12 Nov 2026), so the head coach
 * does it in Members, one by one, or all at once with End schedule.
 */
export function TermFinishedCard({ playerCount }: { playerCount: number }) {
  if (playerCount <= 0) return null
  const players = `${playerCount} ${playerCount === 1 ? "player" : "players"}`

  return (
    <CoachDashboardCard
      area="todo"
      status={{ count: playerCount, tone: "attention", unit: "to move" }}
      title="To do"
      titleId="term-finished-card-title"
    >
      <CoachDashboardSummary
        detail="Their schedule's last day has passed. Move each one onto a new schedule, or end their training, in Members."
      >
        {`Term finished: ${players} to move`}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Term finished actions">
        <CoachDashboardAction href={termFinishedMembersHref}>
          Show {playerCount === 1 ? "this player" : "these players"}
        </CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
