"use client"

import { Check, FileText } from "lucide-react"

import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"
import { useReportResume } from "@/components/coach/reports/report-resume"
import { formatReportMonth } from "@/lib/coach/report-utils"

const REPORT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function ReportsCard({
  activePlayerIds,
  completedCount,
  month,
}: {
  activePlayerIds: string[]
  completedCount: number
  month: string
}) {
  const { resumePoint } = useReportResume()
  const isComplete = activePlayerIds.length > 0 && completedCount === activePlayerIds.length
  const hasActiveResumePoint = resumePoint
    && activePlayerIds.includes(resumePoint.playerId)
    && REPORT_MONTH_PATTERN.test(resumePoint.month)
    && resumePoint.month <= month
  const writeSearch = new URLSearchParams({
    month: hasActiveResumePoint ? resumePoint.month : month,
  })
  if (hasActiveResumePoint) writeSearch.set("player", resumePoint.playerId)
  const monthLabel = formatReportMonth(month).replace(/\s+\d{4}$/, "")

  return (
    <CoachDashboardCard
      eyebrow="Player development"
      icon={FileText}
      title="Monthly reports"
      titleId="coach-reports-card-title"
    >
      <CoachDashboardSummary
        ariaLabel={`${monthLabel}, ${completedCount} of ${activePlayerIds.length} reports published`}
        icon={isComplete ? <Check aria-hidden="true" /> : undefined}
      >
        {monthLabel} · {completedCount}/{activePlayerIds.length} published
      </CoachDashboardSummary>
      <CoachDashboardActions ariaLabel="Monthly report actions">
        <CoachDashboardAction href={`/coach/reports/write?${writeSearch.toString()}`}>
          Write reports
        </CoachDashboardAction>
        <CoachDashboardAction href={`/coach/reports?period=${month}`}>
          Published reports
        </CoachDashboardAction>
      </CoachDashboardActions>
    </CoachDashboardCard>
  )
}
