"use client"

import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

export function MembersCard({
  memberCount,
}: {
  memberCount: number
}) {
  const memberLabel = `${memberCount} enrolled ${memberCount === 1 ? "member" : "members"}`

  return (
    <CoachDashboardCard
      area="members"
      status="Roster current"
      title="Members"
      titleId="coach-members-card-title"
    >
      <CoachDashboardSummary detail="The academy directory is up to date.">
        {memberLabel}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Member actions">
        <CoachDashboardAction href="/coach/members">View directory</CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
