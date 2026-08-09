"use client"

import { ArrowDownToLine, ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"

import {
  getCoachReportPublicationHref,
  nextCoachReportArchiveShown,
  PUBLISHED_REPORT_INITIAL_COUNT,
} from "@/lib/coach/report-navigation"
import { formatPublishedReportDate } from "@/lib/coach/report-utils"
import type { CoachPublishedReportSummary } from "@/lib/reports/coach-archive"

export function PublishedReportsList({
  initialShown,
  period,
  periodLabel,
  query,
  reports,
}: {
  initialShown: number
  period: string
  periodLabel: string
  query: string
  reports: CoachPublishedReportSummary[]
}) {
  const listId = useId()
  const [shown, setShown] = useState(initialShown)
  const [finalRevealFocusIndex, setFinalRevealFocusIndex] = useState<number | null>(null)
  const firstNewReportRef = useRef<HTMLElement | null>(null)
  const visibleReports = reports.slice(0, shown)
  const hasMoreReports = visibleReports.length < reports.length

  useEffect(() => {
    if (hasMoreReports || finalRevealFocusIndex === null) return

    const frame = window.requestAnimationFrame(() => {
      firstNewReportRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [finalRevealFocusIndex, hasMoreReports])

  function revealMoreReports() {
    const nextShown = nextCoachReportArchiveShown(shown, reports.length)
    if (nextShown <= shown) return

    if (nextShown === reports.length) setFinalRevealFocusIndex(shown)
    setShown(nextShown)

    const url = new URL(window.location.href)
    if (nextShown > PUBLISHED_REPORT_INITIAL_COUNT) {
      url.searchParams.set("shown", String(nextShown))
    } else {
      url.searchParams.delete("shown")
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    )
  }

  return (
    <>
      <p className="coach-published-reports-window-status" aria-live="polite">
        Showing {visibleReports.length} of {reports.length} published reports.
      </p>
      <ol
        className="coach-published-report-list"
        id={listId}
        aria-label={`${periodLabel} published reports`}
      >
        {visibleReports.map((report, index) => {
          const headingId = `${listId}-report-${index}`
          const detailHref = getCoachReportPublicationHref(
            report.latestPublicationId,
            { period, query, shown },
          )
          const downloadHref = `/coach/reports/publications/${encodeURIComponent(report.latestPublicationId)}/download`
          const receivesFinalRevealFocus = index === finalRevealFocusIndex

          return (
            <li key={report.reportId}>
              <article
                aria-labelledby={headingId}
                className="coach-published-report-row"
                ref={receivesFinalRevealFocus ? firstNewReportRef : undefined}
                tabIndex={receivesFinalRevealFocus ? -1 : undefined}
              >
                <div className="coach-published-report-player">
                  <h3 id={headingId}>{report.playerName}</h3>
                  <p>
                    <span>{report.academyId}</span>
                    {report.playerArchived ? <em>Archived</em> : null}
                  </p>
                </div>

                <div className="coach-published-report-version">
                  <span>Latest revision</span>
                  <strong>Revision {report.latestRevision}</strong>
                  <small>{report.revisionCount} {report.revisionCount === 1 ? "revision" : "revisions"}</small>
                </div>

                <div className="coach-published-report-updated">
                  <span>Last updated</span>
                  <time dateTime={report.latestPublishedAt}>{formatPublishedReportDate(report.latestPublishedAt)}</time>
                </div>

                <div className="coach-published-report-actions">
                  <Link href={detailHref}>
                    Open report
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                  <a
                    aria-label={`Download ${periodLabel} report for ${report.playerName}`}
                    href={downloadHref}
                  >
                    Download PDF
                    <ArrowDownToLine aria-hidden="true" />
                  </a>
                </div>
              </article>
            </li>
          )
        })}
      </ol>
      {hasMoreReports ? (
        <button
          aria-controls={listId}
          className="coach-published-report-show-more"
          onClick={revealMoreReports}
          type="button"
        >
          Show more reports
        </button>
      ) : null}
    </>
  )
}
