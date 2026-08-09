import { notFound } from "next/navigation"

import { PublishedReportDetail } from "@/components/coach/reports/published-reports"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import {
  isCompletedReportPeriod,
  normalizeCoachReportArchiveQuery,
  normalizeCoachReportArchiveReturnShown,
} from "@/lib/coach/report-navigation"
import { getLatestCompletedReportMonth } from "@/lib/coach/report-utils"
import { getCoachPublishedReportDetail } from "@/lib/reports/coach-archive"

export const metadata = {
  title: "Published report",
}

export default async function CoachPublishedReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicationId: string }>
  searchParams: Promise<{ period?: string; q?: string; shown?: string }>
}) {
  const [{ publicationId }, query, { identity }] = await Promise.all([
    params,
    searchParams,
    requireHeadAdminPage(),
  ])
  const report = getCoachPublishedReportDetail(identity.subjectId, publicationId)
  if (!report) notFound()

  const latestCompletedPeriod = getLatestCompletedReportMonth()
  const period = isCompletedReportPeriod(query.period, latestCompletedPeriod)
    ? query.period
    : report.month

  return (
    <PublishedReportDetail
      period={period}
      query={normalizeCoachReportArchiveQuery(query.q)}
      report={report}
      shown={normalizeCoachReportArchiveReturnShown(query.shown)}
    />
  )
}
