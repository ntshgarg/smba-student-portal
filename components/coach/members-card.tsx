"use client"

import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

export function MembersCard({
  memberCount,
  pendingRegistrationCount,
}: {
  memberCount: number
  pendingRegistrationCount: number
}) {
  const memberLabel = `${memberCount} enrolled ${memberCount === 1 ? "member" : "members"}`

  return (
    <CoachDashboardCard
      area="members"
      status={pendingRegistrationCount
        ? `${pendingRegistrationCount} pending`
        : "Roster current"}
      title="Members"
      titleId="coach-members-card-title"
    >
      <CoachDashboardSummary
        detail={pendingRegistrationCount
          ? `${pendingRegistrationCount} ${pendingRegistrationCount === 1 ? "registration awaits" : "registrations await"} approval.`
          : "The academy directory is up to date."}
      >
        {memberLabel}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Member actions">
        <CoachDashboardAction href="/coach/members">View directory</CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
