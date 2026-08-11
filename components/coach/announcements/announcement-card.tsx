import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

export function AnnouncementCard({ activeCount = 0 }: { activeCount?: number }) {
  const summary = activeCount > 0
    ? `${activeCount} active ${activeCount === 1 ? "announcement" : "announcements"}`
    : "Notice board is clear"

  return (
    <CoachDashboardCard
      area="announcements"
      status={activeCount > 0 ? `${activeCount} active` : "Clear"}
      title="Announcements"
      titleId="coach-announcements-card-title"
    >
      <CoachDashboardSummary detail="Publish one academy message at a time.">
        {summary}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Announcement actions">
        <CoachDashboardAction href="/coach/announcements/new">
          New announcement
        </CoachDashboardAction>
        <CoachDashboardAction href="/coach/announcements">
          Published announcements
        </CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
