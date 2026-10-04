import { Check } from "lucide-react"

import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

/**
 * The dashboard's reports card. There is no "outstanding this month" here any
 * more: the coach decides when to assess, so the card says how many players have
 * ever been assessed and flags only the drafts she has left unfinished.
 */
export function AssessmentsCard({
  assessedCount,
  draftCount,
  playerCount,
}: {
  assessedCount: number
  draftCount: number
  playerCount: number
}) {
  const everyoneAssessed = playerCount > 0 && assessedCount === playerCount

  return (
    <CoachDashboardCard
      area="reports"
      status={draftCount > 0
        ? { count: draftCount, unit: draftCount === 1 ? "draft" : "drafts" }
        : { state: "Clear" }}
      title="Assessments"
      titleId="coach-reports-card-title"
    >
      <CoachDashboardSummary
        detail="Assess a player whenever you choose."
        icon={everyoneAssessed ? <Check aria-hidden="true" /> : undefined}
      >
        {assessedCount} of {playerCount} assessed
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Assessment actions">
        <CoachDashboardAction href="/coach/assessments">
          Assess players
        </CoachDashboardAction>
        <CoachDashboardAction href="/coach/reports">
          Monthly reports
        </CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
