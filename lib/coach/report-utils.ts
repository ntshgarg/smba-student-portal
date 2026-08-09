import type { CoachMonthlyReportRecord } from "@/lib/coach/types"
import { formatAcademyDate, formatDateKey, getAcademyMonthKey } from "@/lib/format"

export function shiftReportMonth(month: string, offset: number) {
  const [year, monthIndex] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, monthIndex - 1 + offset, 1))
  return date.toISOString().slice(0, 7)
}

export function getCurrentIndiaMonth() {
  return getAcademyMonthKey()
}

export function getLatestCompletedReportMonth() {
  return shiftReportMonth(getCurrentIndiaMonth(), -1)
}

export function formatReportMonth(month: string) {
  return formatDateKey(`${month}-01`, {
    day: undefined,
    month: "long",
    weekday: undefined,
    year: "numeric",
  })
}

export function formatPublishedReportDate(value: string) {
  return formatAcademyDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function getCoachReportState(report?: CoachMonthlyReportRecord) {
  if (!report) return "not-started" as const
  if (!report.published) return "draft" as const

  const hasRevisionDraft = report.reportText !== report.published.reportText
    || report.nextPriorities !== report.published.nextPriorities

  return hasRevisionDraft ? "revision" as const : "published" as const
}
