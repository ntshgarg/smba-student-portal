"use client"

import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

export function SessionsCard({
  nextSessionLabel,
  todaySessionCount,
}: {
  nextSessionLabel: string | null
  todaySessionCount: number
}) {
  const status = todaySessionCount
    ? `${todaySessionCount} today`
    : nextSessionLabel
      ? "Next session"
      : "No sessions"
  const detail = todaySessionCount
    ? `${todaySessionCount} ${todaySessionCount === 1 ? "session" : "sessions"} today. Today’s running sheet and future schedules.`
    : nextSessionLabel
      ? `Next · ${nextSessionLabel}`
      : "No training scheduled yet."

  return (
    <CoachDashboardCard
      area="sessions"
      status={status}
      title="Sessions"
      titleId="coach-sessions-card-title"
    >
      <CoachDashboardSummary detail={detail}>
        Training calendar
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Session actions">
        <CoachDashboardAction href="/coach/calendar">Calendar</CoachDashboardAction>
        <CoachDashboardAction href="/coach/schedules/new">Create schedule</CoachDashboardAction>
        <CoachDashboardAction href="/coach/schedules">Schedules &amp; rosters</CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
