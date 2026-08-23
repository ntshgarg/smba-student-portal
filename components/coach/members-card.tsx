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
      status={memberCount > 0 ? { state: "Clear" } : { state: "Setup" }}
      title="Members"
      titleId="coach-members-card-title"
    >
      <CoachDashboardSummary
        detail={memberCount > 0
          ? "Approved players and staff, with their training and contact records."
          : "Approved players and staff appear here once onboarding is complete."}
      >
        {memberLabel}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Member actions">
        <CoachDashboardAction href="/coach/members">View directory</CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
