"use client"

import { ArrowDownToLine, ArrowUpRight, ChevronDown } from "lucide-react"
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
  const [newReportFocusIndex, setNewReportFocusIndex] = useState<number | null>(null)
  const firstNewReportRef = useRef<HTMLElement | null>(null)
  const visibleReports = reports.slice(0, shown)
  const hasMoreReports = visibleReports.length < reports.length
  const nextRevealCount = Math.min(
    PUBLISHED_REPORT_INITIAL_COUNT,
    reports.length - visibleReports.length,
  )

  useEffect(() => {
    if (newReportFocusIndex === null) return

    const frame = window.requestAnimationFrame(() => {
      firstNewReportRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [newReportFocusIndex, shown])

  function revealMoreReports() {
    const nextShown = nextCoachReportArchiveShown(shown, reports.length)
    if (nextShown <= shown) return

    setNewReportFocusIndex(shown)
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
    <div className="coach-published-report-register">
      <div className="coach-published-report-columns" aria-hidden="true">
        <span />
        <span>Player</span>
        <span className="coach-published-report-column-revision">Revision</span>
        <span className="coach-published-report-column-updated">Updated</span>
        <span>Actions</span>
      </div>
      <ol
        role="list"
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
          const receivesNewReportFocus = index === newReportFocusIndex

          return (
            <li key={report.reportId}>
              <article
                aria-labelledby={headingId}
                className="coach-published-report-row"
                ref={receivesNewReportFocus ? firstNewReportRef : undefined}
                tabIndex={receivesNewReportFocus ? -1 : undefined}
              >
                <span className="coach-published-report-folio" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <div className="coach-published-report-player">
                  <h3 id={headingId}>{report.playerName}</h3>
                  <p>
                    <span><span className="coach-published-visually-hidden">Academy ID </span>{report.academyId}</span>
                    {report.playerArchived ? (
                      <em>Archived<span className="coach-published-visually-hidden"> player</span></em>
                    ) : null}
                  </p>
                </div>

                <div className="coach-published-report-version">
                  <span className="coach-published-visually-hidden">Latest revision</span>
                  <strong>Rev {report.latestRevision}</strong>
                  <small>· {report.revisionCount} {report.revisionCount === 1 ? "revision" : "revisions"}</small>
                </div>

                <div className="coach-published-report-updated">
                  <span className="coach-published-visually-hidden">Last updated</span>
                  <time dateTime={report.latestPublishedAt}>{formatPublishedReportDate(report.latestPublishedAt)}</time>
                </div>

                <div className="coach-published-report-actions">
                  <Link href={detailHref}>
                    Open report
                    <span className="coach-published-visually-hidden">
                      {` for ${report.playerName}, Academy ID ${report.academyId}, ${periodLabel}, latest revision ${report.latestRevision}`}
                    </span>
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                  <a href={downloadHref}>
                    PDF
                    <span className="coach-published-visually-hidden">
                      {` download for ${report.playerName}, Academy ID ${report.academyId}, ${periodLabel}, latest revision ${report.latestRevision}`}
                    </span>
                    <ArrowDownToLine aria-hidden="true" />
                  </a>
                </div>
              </article>
            </li>
          )
        })}
      </ol>
      <div className="coach-published-report-register-footer">
        <p
          aria-label={`Showing ${visibleReports.length} of ${reports.length} published reports.`}
          aria-live="polite"
          aria-atomic="true"
          className="coach-published-reports-window-status"
          role="status"
        >
          Showing {visibleReports.length} of {reports.length}
          <span className="coach-published-visually-hidden"> published reports.</span>
        </p>
        {hasMoreReports ? (
          <button
            aria-controls={listId}
            aria-label="Show more reports"
            className="coach-published-report-show-more"
            onClick={revealMoreReports}
            type="button"
          >
            <span aria-hidden="true">Show {nextRevealCount} more reports</span>
            <ChevronDown aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
