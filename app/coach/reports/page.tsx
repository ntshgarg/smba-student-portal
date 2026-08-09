import { permanentRedirect, redirect } from "next/navigation"

import { PublishedReportsArchive } from "@/components/coach/reports/published-reports"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import {
  getCoachReportArchiveHref,
  getLegacyCoachReportWriterHref,
  normalizeCoachReportArchiveQuery,
  normalizeCoachReportArchiveShown,
  PUBLISHED_REPORT_INITIAL_COUNT,
  resolveCoachReportArchivePeriod,
  type CoachPublishedReportsSearchParams,
} from "@/lib/coach/report-navigation"
import { getLatestCompletedReportMonth } from "@/lib/coach/report-utils"
import {
  listCoachPublishedReportPeriods,
  listCoachPublishedReportSummaries,
} from "@/lib/reports/coach-archive"

export const metadata = {
  title: "Published reports",
}

export default async function CoachReportsPage({
  searchParams,
}: {
  searchParams: Promise<CoachPublishedReportsSearchParams>
}) {
  const query = await searchParams
  const { identity } = await requireHeadAdminPage()

  const writerHref = getLegacyCoachReportWriterHref(query)
  if (writerHref) permanentRedirect(writerHref)

  const latestCompletedPeriod = getLatestCompletedReportMonth()
  const period = resolveCoachReportArchivePeriod(
    query.period,
    latestCompletedPeriod,
  )
  const search = normalizeCoachReportArchiveQuery(query.q)
  if (query.period !== period || (query.q ?? "") !== search) {
    redirect(getCoachReportArchiveHref({ period, query: search }))
  }

  const publishedPeriods = listCoachPublishedReportPeriods(identity.subjectId)
  const reports = listCoachPublishedReportSummaries(identity.subjectId, {
    period,
    query: search,
  })
  const shown = normalizeCoachReportArchiveShown(query.shown, reports.length)
  const canonicalShown = shown > PUBLISHED_REPORT_INITIAL_COUNT ? String(shown) : ""
  if ((query.shown ?? "") !== canonicalShown) {
    redirect(getCoachReportArchiveHref({ period, query: search, shown }))
  }

  return (
    <PublishedReportsArchive
      earliestPublishedPeriod={publishedPeriods.at(-1) ?? null}
      hasPublishedReports={publishedPeriods.length > 0}
      latestCompletedPeriod={latestCompletedPeriod}
      period={period}
      periodHasPublications={publishedPeriods.includes(period)}
      query={search}
      reports={reports}
      shown={shown}
    />
  )
}
