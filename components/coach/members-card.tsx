"use client"

import { UsersRound } from "lucide-react"

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
  return (
    <CoachDashboardCard
      eyebrow="Academy roster"
      icon={UsersRound}
      title="Members"
      titleId="coach-members-card-title"
    >
      <CoachDashboardSummary>
        {memberCount} enrolled {memberCount === 1 ? "member" : "members"}
        {pendingRegistrationCount
          ? ` · ${pendingRegistrationCount} awaiting approval`
          : ""}
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Member actions">
        <CoachDashboardAction href="/coach/members">View directory</CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
