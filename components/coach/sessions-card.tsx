"use client"

import { CalendarDays } from "lucide-react"

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

  return (
    <CoachDashboardCard
      eyebrow="Training calendar"
      icon={CalendarDays}
      title="Sessions"
      titleId="coach-sessions-card-title"
    >
      <CoachDashboardSummary>
        {todaySessionCount
          ? `${todaySessionCount} ${todaySessionCount === 1 ? "session" : "sessions"} today`
          : nextSessionLabel
            ? `Next · ${nextSessionLabel}`
            : "No training scheduled yet"}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Session actions">
        <CoachDashboardAction href="/coach/calendar">Calendar</CoachDashboardAction>
        <CoachDashboardAction href="/coach/schedules/new">Create schedule</CoachDashboardAction>
        <CoachDashboardAction href="/coach/schedules">Schedules &amp; rosters</CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
