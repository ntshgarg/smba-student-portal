import {
  ArrowDownToLine,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
} from "lucide-react"
import Link from "next/link"

import { PublishedReportsList } from "@/components/coach/reports/published-reports-list"
import {
  getCoachReportArchiveHref,
  getCoachReportPublicationHref,
} from "@/lib/coach/report-navigation"
import {
  formatPublishedReportDate,
  formatReportMonth,
  shiftReportMonth,
} from "@/lib/coach/report-utils"
import type { CoachPublishedReportDetail, CoachPublishedReportSummary } from "@/lib/reports/coach-archive"

function reportCountLabel(count: number) {
  return `${count} published ${count === 1 ? "report" : "reports"}`
}

export function PublishedReportsArchive({
  hasPublishedReports,
  latestCompletedPeriod,
  period,
  periodHasPublications,
  query,
  reports,
  shown,
}: {
  hasPublishedReports: boolean
  latestCompletedPeriod: string
  period: string
  periodHasPublications: boolean
  query: string
  reports: CoachPublishedReportSummary[]
  shown: number
}) {
  const previousPeriod = shiftReportMonth(period, -1)
  const nextPeriod = shiftReportMonth(period, 1)
  const previousDisabled = !hasPublishedReports
  const nextDisabled = period >= latestCompletedPeriod
  const periodLabel = formatReportMonth(period)

  return (
    <div className="coach-published-reports-page page-shell">
      <div className="coach-reports-back-row">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className="coach-published-reports-header">
        <h1>Published reports</h1>

        <nav className="coach-report-month-control" aria-label="Published report month">
          {previousDisabled ? (
            <span className="coach-published-month-disabled" aria-hidden="true">
              <ChevronLeft />
            </span>
          ) : (
            <Link
              href={getCoachReportArchiveHref({ period: previousPeriod, query })}
              aria-label={`Show ${formatReportMonth(previousPeriod)} published reports`}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
          )}
          <div>
            <span className="sr-only">Reporting month</span>
            <strong><time dateTime={period}>{periodLabel}</time></strong>
          </div>
          {nextDisabled ? (
            <span className="coach-published-month-disabled" aria-hidden="true">
              <ChevronRight />
            </span>
          ) : (
            <Link
              href={getCoachReportArchiveHref({ period: nextPeriod, query })}
              aria-label={`Show ${formatReportMonth(nextPeriod)} published reports`}
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
        </nav>
      </header>

      <section className="coach-published-reports-workspace" aria-labelledby="published-report-list-title">
        <h2 className="sr-only" id="published-report-list-title">
          {periodLabel} published report register
        </h2>
        <div className="coach-published-reports-toolbar">
          <div className="coach-published-reports-summary" aria-live="polite">
            <p>
              {query ? (
                <>
                  {reports.length} {reports.length === 1 ? "result" : "results"} for <q>{query}</q>
                </>
              ) : reportCountLabel(reports.length)}
            </p>
            {query ? (
              <Link
                aria-label="Clear player search"
                href={getCoachReportArchiveHref({ period })}
              >
                Clear search
              </Link>
            ) : null}
          </div>

          <form
            action="/coach/reports"
            aria-label="Search published reports"
            className="coach-published-reports-search"
            method="get"
            role="search"
          >
            <input name="period" type="hidden" value={period} />
            <label className="sr-only" htmlFor="published-report-search">
              Find a player by name or Academy ID
            </label>
            <div>
              <Search aria-hidden="true" />
              <input
                autoComplete="off"
                defaultValue={query}
                id="published-report-search"
                maxLength={100}
                name="q"
                placeholder="Name or Academy ID"
                type="search"
              />
              <button aria-label="Search reports" type="submit">Search</button>
            </div>
          </form>
        </div>

        {!hasPublishedReports ? (
          <div className="coach-published-reports-empty">
            <FileText aria-hidden="true" />
            <h3>No published reports yet.</h3>
            <p>Reports will appear here after they are shared with players.</p>
            <Link href={`/coach/reports/write?month=${period}`}>Write reports</Link>
          </div>
        ) : reports.length === 0 ? (
          <div className="coach-published-reports-empty is-compact">
            <FileText aria-hidden="true" />
            <h3>
              {query
                ? "No matching reports."
                : periodHasPublications
                  ? "Published reports are unavailable."
                  : `No reports for ${periodLabel}.`}
            </h3>
            <p>
              {query
                ? "Try another player name or Academy ID."
                : "No player reports were published for this reporting month."}
            </p>
            {query
              ? <Link href={getCoachReportArchiveHref({ period })}>Clear search</Link>
              : <Link href={`/coach/reports/write?month=${period}`}>Write reports</Link>}
          </div>
        ) : (
          <PublishedReportsList
            initialShown={shown}
            key={`${period}:${query}:${shown}`}
            period={period}
            periodLabel={periodLabel}
            query={query}
            reports={reports}
          />
        )}
      </section>
    </div>
  )
}

function percentageLabel(value: number | null) {
  return value === null ? "Not recorded" : `${value}%`
}

export function PublishedReportDetail({
  period,
  query,
  report,
  shown,
}: {
  period: string
  query: string
  report: CoachPublishedReportDetail
  shown: number | null
}) {
  const archiveState = { period, query, shown }
  const backHref = getCoachReportArchiveHref(archiveState)
  const downloadHref = `/coach/reports/publications/${encodeURIComponent(report.publicationId)}/download`

  return (
    <div className="coach-published-report-detail-page page-shell">
      <div className="coach-reports-back-row">
        <Link href={backHref}><ArrowLeft aria-hidden="true" /> Back to published reports</Link>
      </div>

      <header className="coach-published-report-detail-header">
        <div>
          <span className="eyebrow">Published report</span>
          <h1>{report.playerName}</h1>
          <p>
            {report.academyId}
            {report.playerArchived ? <em>Archived</em> : null}
          </p>
        </div>
        <a className="coach-published-report-download" href={downloadHref}>
          Download PDF
          <ArrowDownToLine aria-hidden="true" />
        </a>
      </header>

      <div className="coach-published-report-detail-grid">
        <aside className="coach-published-report-revisions" aria-labelledby="published-report-revisions-title">
          <div>
            <span>History</span>
            <h2 id="published-report-revisions-title">Revisions</h2>
          </div>
          <nav aria-label="Published report revisions">
            {report.revisions.map((revision) => {
              const isCurrent = revision.publicationId === report.publicationId
              return (
                <Link
                  aria-current={isCurrent ? "page" : undefined}
                  className={isCurrent ? "is-current" : undefined}
                  href={getCoachReportPublicationHref(revision.publicationId, archiveState)}
                  key={revision.publicationId}
                >
                  <span>Revision {revision.revision}</span>
                  <time dateTime={revision.publishedAt}>{formatPublishedReportDate(revision.publishedAt)}</time>
                </Link>
              )
            })}
          </nav>
        </aside>

        <article className="coach-published-report-document" aria-labelledby="published-report-document-title">
          <div className="coach-published-report-document-heading">
            <div>
              <span>{report.monthLabel}</span>
              <h2 id="published-report-document-title">Monthly development report</h2>
            </div>
            <strong>Revision {report.revision}</strong>
          </div>

          <dl className="coach-published-report-facts">
            <div>
              <dt>Attendance</dt>
              <dd>{percentageLabel(report.attendance.percentage)}</dd>
            </div>
            <div>
              <dt>Present</dt>
              <dd>{report.attendance.attended} of {report.attendance.recorded}</dd>
            </div>
            <div>
              <dt>Absent</dt>
              <dd>{report.attendance.absent}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{report.attendance.pending}</dd>
            </div>
          </dl>

          <div className="coach-published-report-copy">
            <span>Coach’s report</span>
            {report.reportText.trim().split(/\n\s*\n/u).map((paragraph, index) => (
              <p key={`${report.publicationId}-paragraph-${index}`}>{paragraph}</p>
            ))}
          </div>

          <footer className="coach-published-report-document-footer">
            <div>
              <span>Published by</span>
              <strong>{report.publishedByName}</strong>
            </div>
            <div>
              <span>Published</span>
              <time dateTime={report.publishedAt}>{formatPublishedReportDate(report.publishedAt)}</time>
            </div>
          </footer>
        </article>
      </div>
    </div>
  )
}
