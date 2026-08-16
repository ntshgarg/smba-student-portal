"use client"

import { useMemo } from "react"
import { ChevronDown } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ReportExportButton } from "@/components/report-export-button"
import { formatDate, formatDateKey } from "@/lib/format"
import {
  groupReportsByYear,
  reportYearFromMonth,
} from "@/lib/reports/archive"
import type { PlayerReportArchiveItem } from "@/lib/types"

function reportMonthName(report: PlayerReportArchiveItem) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(report.month)
    ? formatDateKey(`${report.month}-01`, {
        day: undefined,
        month: "long",
        weekday: undefined,
        year: undefined,
      })
    : report.monthLabel
}

function reportYearLabel(year: string) {
  return year === "Earlier" ? "Earlier reports" : year
}

export function ReportAccordion({
  playerName,
  reports,
}: {
  playerName: string
  reports: PlayerReportArchiveItem[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const reduceMotion = useReducedMotion()
  const yearGroups = useMemo(() => groupReportsByYear(reports), [reports])
  const reportById = useMemo(
    () => new Map(reports.map((report) => [report.id, report])),
    [reports],
  )
  const latestYear = yearGroups[0]?.year ?? null
  const requestedReport = reportById.get(searchParams.get("report") ?? "") ?? null
  const requestedReportYear = requestedReport
    ? reportYearFromMonth(requestedReport.month)
    : null
  const requestedYear = searchParams.get("year")
  const openYear = requestedReportYear
    ?? (requestedYear === "none"
      ? null
      : yearGroups.some((group) => group.year === requestedYear)
        ? requestedYear
        : latestYear)
  const openReportId = requestedReportYear === openYear
    ? requestedReport?.id ?? null
    : null

  function updateArchive(year: string | null, reportId?: string) {
    const nextParams = new URLSearchParams(searchParams.toString())

    nextParams.set("year", year ?? "none")
    if (reportId) nextParams.set("report", reportId)
    else nextParams.delete("report")

    router.push(`${pathname}?${nextParams.toString()}`, { scroll: false })
  }

  return (
    <div className="report-archive">
      {yearGroups.map((yearGroup) => {
        const isYearOpen = openYear === yearGroup.year
        const yearTriggerId = `report-year-${yearGroup.year}-trigger`
        const yearPanelId = `report-year-${yearGroup.year}-panel`

        return (
          <section
            className={`report-year-group${isYearOpen ? " is-open" : ""}`}
            aria-labelledby={yearTriggerId}
            key={yearGroup.year}
          >
            <h2>
              <button
                aria-controls={isYearOpen ? yearPanelId : undefined}
                aria-expanded={isYearOpen}
                className="report-year-trigger"
                id={yearTriggerId}
                onClick={() => updateArchive(isYearOpen ? null : yearGroup.year)}
                type="button"
              >
                <span className="report-year-title">
                  <span className="report-season-label">Season record</span>
                  <strong className="report-season-year">
                    {reportYearLabel(yearGroup.year)}
                  </strong>
                </span>
                <span className="report-year-count">
                  {yearGroup.reports.length} coach {yearGroup.reports.length === 1 ? "report" : "reports"}
                </span>
                <span className="report-archive-toggle report-year-toggle" aria-hidden="true">
                  <ChevronDown />
                </span>
              </button>
            </h2>

            <AnimatePresence initial={false}>
              {isYearOpen && (
                <motion.div
                  animate={{ opacity: 1, transform: "translateY(0px)" }}
                  aria-labelledby={yearTriggerId}
                  className="report-year-panel"
                  exit={{ opacity: 0, transform: "translateY(-4px)" }}
                  id={yearPanelId}
                  initial={reduceMotion ? false : { opacity: 0, transform: "translateY(-4px)" }}
                  role="region"
                  transition={{
                    duration: reduceMotion ? 0 : 0.18,
                    ease: "easeOut",
                  }}
                >
                  <div className="report-year-months">
                    {yearGroup.reports.map((report, reportIndex) => {
                      const isReportOpen = openReportId === report.id
                      const reportTriggerId = `${report.id}-trigger`
                      const reportPanelId = `${report.id}-panel`
                      const publishedLabel = formatDate(report.publishedAt)
                      const folio = String(
                        yearGroup.reports.length - reportIndex,
                      ).padStart(2, "0")

                      return (
                        <article
                          className={`report-month-item${isReportOpen ? " is-open" : ""}`}
                          key={report.id}
                        >
                          <h3>
                            <button
                              aria-controls={isReportOpen ? reportPanelId : undefined}
                              aria-expanded={isReportOpen}
                              className="report-month-trigger"
                              id={reportTriggerId}
                              onClick={() => updateArchive(
                                yearGroup.year,
                                isReportOpen ? undefined : report.id,
                              )}
                              type="button"
                            >
                              <span
                                aria-hidden="true"
                                className="report-month-folio"
                              >
                                {folio}
                              </span>
                              <span className="report-month-title">
                                <strong>{reportMonthName(report)}</strong>
                              </span>
                              <time
                                aria-label={`Published ${publishedLabel}`}
                                className="report-month-published"
                                dateTime={report.publishedAt}
                              >
                                {publishedLabel}
                              </time>
                              <span className="report-archive-toggle report-month-toggle" aria-hidden="true">
                                <ChevronDown />
                              </span>
                            </button>
                          </h3>

                          <AnimatePresence initial={false}>
                            {isReportOpen && (
                              <motion.div
                                animate={{ height: "auto", opacity: 1 }}
                                aria-labelledby={reportTriggerId}
                                exit={{ height: 0, opacity: 0 }}
                                id={reportPanelId}
                                initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                                role="region"
                                style={{ overflow: "hidden" }}
                                transition={{
                                  duration: reduceMotion ? 0 : 0.28,
                                  ease: "easeOut",
                                }}
                              >
                                <div className="report-accordion-content">
                                  <div className="expanded-report-panel">
                                    <div className="expanded-report-heading">
                                      <p className="expanded-report-label">Coach’s report</p>
                                      <p className="expanded-report-period">{report.monthLabel}</p>
                                    </div>
                                    <div className="expanded-report-copy">
                                      {report.reportText.split(/\n\s*\n/).map((paragraph, paragraphIndex) => (
                                        <p key={`${report.id}-paragraph-${paragraphIndex}`}>{paragraph}</p>
                                      ))}
                                      <div className="expanded-report-download">
                                        <ReportExportButton
                                          monthLabel={report.monthLabel}
                                          playerName={playerName}
                                          reportId={report.id}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </article>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )
      })}
    </div>
  )
}
