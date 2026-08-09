import { Megaphone } from "lucide-react"

import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

export function AnnouncementCard({ activeCount = 0 }: { activeCount?: number }) {
  const summary = activeCount > 0
    ? `${activeCount} active ${activeCount === 1 ? "announcement" : "announcements"}`
    : "The academy notice board is clear"

  return (
    <CoachDashboardCard
      eyebrow="Academy notice board"
      icon={Megaphone}
      title="Announcements"
      titleId="coach-announcements-card-title"
    >
      <CoachDashboardSummary>{summary}</CoachDashboardSummary>
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
