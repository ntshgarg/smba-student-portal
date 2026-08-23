"use client"

import { ArrowLeft, CircleAlert, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"

import {
  buildAttendanceRegisterDates,
  groupAttendanceDatesByMonth,
} from "@/components/coach/attendance-register-utils"
import {
  useAttendancePortal,
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import { useAttendanceRegisterWindow } from "@/components/coach/use-attendance-register-window"
import {
  attendanceRegisterBatches,
  attendanceRegisterProgrammes,
  type AttendanceRegisterSelection,
} from "@/lib/attendance/register-workspace"
import { formatSessionLabel, formatSessionTimeRange } from "@/lib/format"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
const weekdayShortLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function PlayerAttendanceRegister({
  referenceDate,
  referenceInstant: initialReferenceInstant,
  selection,
  yearOptions,
}: {
  referenceDate: string
  referenceInstant: number
  selection: AttendanceRegisterSelection
  yearOptions: number[]
}) {
  const { players } = useMemberPortal()
  const {
    attendanceAdjustments,
    attendanceRecords,
  } = useAttendancePortal()
  const {
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useSessionPortal()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const todayKey = referenceDate
  const currentYear = Number(todayKey.slice(0, 4))
  const activeYear = selection.year
  const selectedProgramme = selection.programme
  const selectedBatch = selection.batch
  const [referenceInstant, setReferenceInstant] = useState(initialReferenceInstant)

  const dates = useMemo(() => buildAttendanceRegisterDates(activeYear), [activeYear])
  const scrollTargetIndex = dates.reduce(
    (latest, date, index) => date.key <= todayKey ? index : latest,
    0,
  )
  const initialWindowIndex = activeYear === currentYear ? scrollTargetIndex : 0
  const {
    containerRef: registerScrollRef,
    onScroll: handleRegisterScroll,
    scrollToIndex,
    visibleWindow,
  } = useAttendanceRegisterWindow({
    dateCount: dates.length,
    initialIndex: initialWindowIndex,
    resetKey: `${activeYear}:${selectedBatch}:${selectedProgramme}`,
    scrollOnReset: activeYear === currentYear,
  })
  const visibleDates = useMemo(
    () => dates.slice(visibleWindow.start, visibleWindow.end),
    [dates, visibleWindow.end, visibleWindow.start],
  )
  const visibleMonthGroups = useMemo(
    () => groupAttendanceDatesByMonth(visibleDates),
    [visibleDates],
  )
  const leadingDateCount = visibleWindow.start
  const trailingDateCount = dates.length - visibleWindow.end
  const categorySeries = sessionSeries.filter((series) => (
    series.programme === selectedProgramme && series.batch === selectedBatch
  ))
  const categorySeriesIds = new Set(categorySeries.map((series) => series.id))
  const categoryOccurrences = sessionOccurrences.filter((occurrence) => categorySeriesIds.has(occurrence.seriesId))
  const occurrenceBySeriesDate = new Map(
    [...categoryOccurrences]
      .sort((first, second) => Number(first.status === "scheduled") - Number(second.status === "scheduled"))
      .map((occurrence) => [`${occurrence.seriesId}:${occurrence.occurrenceDate}`, occurrence]),
  )
  const occurrenceById = new Map(sessionOccurrences.map((occurrence) => [occurrence.id, occurrence]))
  const yearStart = `${activeYear}-01-01`
  const nextYearStart = `${activeYear + 1}-01-01`
  const playerById = new Map(players.map((player) => [player.member.id, player]))
  const seriesById = new Map(categorySeries.map((series) => [series.id, series]))
  const seriesOrder = new Map(sessionSeries.map((series, index) => [series.id, index]))
  const registerRows = sessionAssignments.flatMap((assignment) => {
    if (!categorySeriesIds.has(assignment.seriesId)) return []
    const overlapsDisplayedYear = assignment.effectiveFrom < nextYearStart
      && (!assignment.effectiveTo || assignment.effectiveTo > yearStart)
    const coversReplacementInDisplayedYear = categoryOccurrences.some((occurrence) => (
      occurrence.status === "scheduled"
      && occurrence.occurrenceDate >= yearStart
      && occurrence.occurrenceDate < nextYearStart
      && assignmentCoversOccurrence(assignment, occurrence)
    ))
    if (!overlapsDisplayedYear && !coversReplacementInDisplayedYear) return []
    const player = playerById.get(assignment.playerId)
    const series = seriesById.get(assignment.seriesId)
    return player && series ? [{ assignment, player, series }] : []
  }).sort((first, second) => (
    first.player.member.fullName.localeCompare(second.player.member.fullName)
    || (seriesOrder.get(first.series.id) ?? 0) - (seriesOrder.get(second.series.id) ?? 0)
    || first.assignment.id.localeCompare(second.assignment.id)
  ))
  const activeAdjustments = attendanceAdjustments.filter((adjustment) => !adjustment.voidedAt)
  const sourceAdjustmentByCell = new Map(activeAdjustments.map((adjustment) => (
    [`${adjustment.playerId}:${adjustment.sourceOccurrenceId}`, adjustment]
  )))
  const categoryAdjustmentsByPlayer = activeAdjustments.reduce<Map<string, typeof activeAdjustments>>(
    (map, adjustment) => {
      const source = occurrenceById.get(adjustment.sourceOccurrenceId)
      if (!source || !categorySeriesIds.has(source.seriesId)) return map
      const current = map.get(adjustment.playerId) ?? []
      current.push(adjustment)
      map.set(adjustment.playerId, current)
      return map
    },
    new Map(),
  )
  const tableStyle = {
    "--register-width": `${250 + dates.length * 58}px`,
    "--register-mobile-width": `${148 + dates.length * 54}px`,
  } as CSSProperties

  useEffect(() => {
    const timer = window.setInterval(() => setReferenceInstant(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  function replaceFilters(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(changes).forEach(([key, value]) => next.set(key, value))
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  function jumpToToday() {
    if (activeYear !== currentYear) {
      replaceFilters({ year: String(currentYear) })
      return
    }
    scrollToIndex(scrollTargetIndex, "smooth")
  }

  return (
    <div className="coach-calendar coach-attendance-workspace page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Player attendance navigation">
        <Link href="/coach#attendance"><ArrowLeft aria-hidden="true" /> Back to Attendance</Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Attendance register</span>
          <h1 id="player-attendance-register-title">Player attendance</h1>
        </div>
      </header>

      <article className="coach-attendance-card is-workspace">
        <div className="coach-attendance-register" id="attendance-register">
          {!sessionSeries.length ? (
            <div className="coach-register-empty-schedule">
              <h2>No sessions scheduled.</h2>
              <p>Create a recurring schedule and assign players before attendance can be recorded.</p>
              <Link href="/coach/schedules/new">Create schedule</Link>
            </div>
          ) : (
            <>
              <div className="coach-register-controls">
                <div className="coach-year-selector" role="group" aria-label="Choose attendance year">
                  {yearOptions.map((year) => (
                    <button
                      key={year}
                      type="button"
                      className={year === activeYear ? "is-active" : undefined}
                      aria-pressed={year === activeYear}
                      onClick={() => replaceFilters({ year: String(year) })}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </div>

              <div className="coach-register-category-picker">
                <div className="coach-session-picker" role="group" aria-label="Choose attendance batch">
                  {attendanceRegisterBatches.map((batch) => (
                    <button
                      key={batch}
                      type="button"
                      aria-pressed={batch === selectedBatch}
                      className={batch === selectedBatch ? "is-active" : undefined}
                      onClick={() => replaceFilters({ batch })}
                    >
                      <strong>{batch}</strong>
                    </button>
                  ))}
                </div>
                <div className="coach-session-picker" role="group" aria-label="Choose attendance level">
                  {attendanceRegisterProgrammes.map((programme) => (
                    <button
                      key={programme}
                      type="button"
                      aria-pressed={programme === selectedProgramme}
                      className={programme === selectedProgramme ? "is-active" : undefined}
                      onClick={() => replaceFilters({ level: programme })}
                    >
                      <strong>{programme}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className="coach-register-heading">
                <div>
                  <span>Level &amp; batch</span>
                  <h2>{selectedProgramme} · {selectedBatch}</h2>
                </div>
                <div className="coach-register-period">
                  <span>Annual register</span>
                  <button type="button" onClick={jumpToToday}>Jump to today</button>
                </div>
              </div>

              <div className="player-attendance-legend staff-attendance-legend" role="group" aria-label="Attendance status legend">
                <span><i className="is-present" aria-hidden="true" />Present</span>
                <span><i className="is-absent" aria-hidden="true" />Absent</span>
                <span><i className="is-unmarked" aria-hidden="true" />Not recorded</span>
                <span><i className="is-unavailable" aria-hidden="true" />Not available</span>
              </div>

              {!categorySeries.length ? (
                <div className="coach-register-empty-category">
                  <h2>No {selectedProgramme} · {selectedBatch} sessions.</h2>
                  <p>Create a matching recurring schedule before recording attendance.</p>
                  <Link href="/coach/schedules/new">Create schedule</Link>
                </div>
              ) : !registerRows.length ? (
                <div className="coach-register-empty-category">
                  <h2>No players assigned yet.</h2>
                  <p>Matching players appear here after they are added to a roster.</p>
                  <Link href="/coach/schedules">Open Schedules &amp; Rosters</Link>
                </div>
              ) : (
                <div
                  className="coach-register-scroll"
                  ref={registerScrollRef}
                  onScroll={handleRegisterScroll}
                  tabIndex={0}
                  role="region"
                  aria-label="Scrollable annual player attendance register"
                >
                  <table
                    className="coach-register-table"
                    style={tableStyle}
                    aria-label={`${selectedProgramme} ${selectedBatch} attendance register for ${activeYear}`}
                    aria-colcount={dates.length + 1}
                  >
                    <colgroup>
                      <col className="coach-register-name-col" />
                      {leadingDateCount ? (
                        <col className="coach-register-date-col" span={leadingDateCount} />
                      ) : null}
                      {visibleDates.map((date) => (
                        <col key={date.key} className="coach-register-date-col" />
                      ))}
                      {trailingDateCount ? (
                        <col className="coach-register-date-col" span={trailingDateCount} />
                      ) : null}
                    </colgroup>
                    <thead>
                      <tr className="coach-register-month-row">
                        <th className="coach-register-name-column" scope="col" rowSpan={2} aria-colindex={1}>Player name</th>
                        {leadingDateCount ? (
                          <th
                            className="coach-register-spacer-cell"
                            colSpan={leadingDateCount}
                            aria-hidden="true"
                          />
                        ) : null}
                        {visibleMonthGroups.map((month) => (
                          <th key={month.label} scope="colgroup" colSpan={month.count}><span>{month.label}</span></th>
                        ))}
                        {trailingDateCount ? (
                          <th
                            className="coach-register-spacer-cell"
                            colSpan={trailingDateCount}
                            aria-hidden="true"
                          />
                        ) : null}
                      </tr>
                      <tr className="coach-register-date-row">
                        {leadingDateCount ? (
                          <th
                            className="coach-register-spacer-cell"
                            colSpan={leadingDateCount}
                            aria-hidden="true"
                          />
                        ) : null}
                        {visibleDates.map((date, visibleIndex) => {
                          const available = categorySeries.some((series) => (
                            occurrenceBySeriesDate.get(`${series.id}:${date.key}`)?.status === "scheduled"
                          ))
                          return (
                            <th
                              key={date.key}
                              scope="col"
                              data-register-date={date.key}
                              aria-colindex={visibleWindow.start + visibleIndex + 2}
                              className={[
                                date.key === todayKey ? "is-today" : "",
                                !available ? "is-unavailable" : "",
                              ].filter(Boolean).join(" ") || undefined}
                            >
                              <span>{date.day}</span>
                              <strong>{date.date}</strong>
                            </th>
                          )
                        })}
                        {trailingDateCount ? (
                          <th
                            className="coach-register-spacer-cell"
                            colSpan={trailingDateCount}
                            aria-hidden="true"
                          />
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {registerRows.map((row, rowIndex) => {
                        const firstPlayerRow = rowIndex === 0
                          || registerRows[rowIndex - 1]?.player.member.id !== row.player.member.id
                        const playerAdjustments = categoryAdjustmentsByPlayer.get(row.player.member.id) ?? []
                        const rowAdjustments = playerAdjustments.filter((adjustment) => {
                          const source = occurrenceById.get(adjustment.sourceOccurrenceId)
                          return Boolean(source
                            && source.seriesId === row.series.id
                            && playerWasEnrolledForOccurrence(row.player.member.joinedAt, source)
                            && assignmentCoversOccurrence(row.assignment, source))
                        })
                        const rowYearAdjustments = rowAdjustments.filter((adjustment) => (
                          adjustment.completedOn >= yearStart && adjustment.completedOn < nextYearStart
                        ))
                        const completionAdjustmentsByDate = rowYearAdjustments.reduce<Map<string, typeof rowYearAdjustments>>(
                          (map, adjustment) => {
                            const current = map.get(adjustment.completedOn) ?? []
                            current.push(adjustment)
                            map.set(adjustment.completedOn, current)
                            return map
                          },
                          new Map(),
                        )
                        const slot = row.series.slots[0]
                        const sessionLabel = formatSessionLabel({
                          programme: row.series.programme,
                          batch: row.series.batch,
                          startTime: slot?.startTime ?? "",
                          durationMinutes: slot?.durationMinutes ?? 0,
                        })
                        const sessionTimeLabel = formatSessionTimeRange({
                          startTime: slot?.startTime ?? "",
                          durationMinutes: slot?.durationMinutes ?? 0,
                        })
                        const assignedDaysLabel = row.assignment.weekdays
                          .map((weekday) => weekdayShortLabels[weekday])
                          .join(", ")

                        return (
                          <tr key={row.assignment.id} className={firstPlayerRow ? undefined : "is-session-continuation"}>
                            <th
                              className="coach-register-name-column"
                              scope="row"
                              aria-colindex={1}
                              aria-label={`${row.player.member.fullName}, ${sessionLabel}, assigned ${assignedDaysLabel}`}
                            >
                              {firstPlayerRow ? <strong>{row.player.member.fullName}</strong> : null}
                              <small>{[sessionTimeLabel, assignedDaysLabel].filter(Boolean).join(" · ")}</small>
                            </th>
                            {leadingDateCount ? (
                              <td
                                className="coach-register-spacer-cell"
                                colSpan={leadingDateCount}
                                aria-hidden="true"
                              />
                            ) : null}
                            {visibleDates.map((date, visibleIndex) => {
                              const occurrence = occurrenceBySeriesDate.get(`${row.series.id}:${date.key}`)
                              const unavailable = !occurrence
                                || occurrence.status !== "scheduled"
                                || !playerWasEnrolledForOccurrence(row.player.member.joinedAt, occurrence)
                                || !assignmentCoversOccurrence(row.assignment, occurrence)
                              const future = occurrence ? occurrenceIsUpcoming(occurrence, referenceInstant) : false
                              const choice = occurrence ? attendanceRecords[occurrence.id]?.[row.player.member.id] : undefined
                              const adjustment = occurrence
                                ? sourceAdjustmentByCell.get(`${row.player.member.id}:${occurrence.id}`)
                                : undefined
                              const completionAdjustments = completionAdjustmentsByDate.get(date.key) ?? []
                              const completionAdjustment = completionAdjustments[0]
                              const completionCount = completionAdjustments.length
                              const completionRequiresReview = completionAdjustments.some((item) => item.reviewRequiredAt)
                              const ordinaryState = unavailable
                                ? "not eligible for a scheduled session"
                                : future ? "future session" : choice ?? "not recorded"
                              const adjustmentState = adjustment?.reviewRequiredAt
                                ? "missed session reconciled, requires review"
                                : adjustment ? "missed session reconciled" : null
                              const completionState = completionCount
                                ? `${completionCount} completed rescheduled ${completionCount === 1 ? "session" : "sessions"}${completionRequiresReview ? ", requires review" : ""}`
                                : null
                              const state = [adjustmentState ?? ordinaryState, completionState]
                                .filter(Boolean)
                                .join("; ")
                              const cellLabel = `${row.player.member.fullName}, ${sessionLabel}, ${date.label}: ${state}.`

                              return (
                                <td
                                  key={date.key}
                                  aria-colindex={visibleWindow.start + visibleIndex + 2}
                                  className={[
                                    date.key === todayKey ? "is-today" : "",
                                    unavailable ? "is-unavailable" : "",
                                  ].filter(Boolean).join(" ") || undefined}
                                >
                                  {adjustment ? (
                                    <Link
                                      className={`coach-register-cell-control is-makeup${adjustment.reviewRequiredAt ? " requires-review" : ""}`}
                                      href={`/coach/attendance/adjustments?adjustment=${encodeURIComponent(adjustment.id)}&player=${encodeURIComponent(row.player.member.id)}`}
                                      aria-label={`${cellLabel} Open adjustment details.`}
                                      title={`${sessionLabel} · ${date.label}: ${state}`}
                                    >
                                      {completionCount ? <span className="coach-register-makeup-count" aria-hidden="true">+{completionCount}</span> : null}
                                      {adjustment.reviewRequiredAt ? <CircleAlert aria-hidden="true" /> : null}
                                    </Link>
                                  ) : completionAdjustment && unavailable ? (
                                    <Link
                                      className={`coach-register-cell-control is-makeup-completion${completionRequiresReview ? " requires-review" : ""}`}
                                      href={`/coach/attendance/adjustments?adjustment=${encodeURIComponent(completionAdjustment.id)}&player=${encodeURIComponent(row.player.member.id)}`}
                                      aria-label={`${cellLabel} Open adjustment details.`}
                                      title={`${sessionLabel} · ${date.label}: ${state}`}
                                    >
                                      +{completionCount}
                                      {completionRequiresReview ? <CircleAlert aria-hidden="true" /> : null}
                                    </Link>
                                  ) : (
                                    <span
                                      className={`coach-register-cell-status${choice ? ` is-${choice}` : ""}${completionCount ? " has-makeup-completion" : ""}${completionRequiresReview ? " requires-review" : ""}`}
                                      role="img"
                                      aria-label={cellLabel}
                                      title={`${sessionLabel} · ${date.label}: ${state}`}
                                    >
                                      {unavailable ? <X aria-hidden="true" /> : choice || completionCount ? null : <span aria-hidden="true">—</span>}
                                      {completionCount ? <span className="coach-register-makeup-count" aria-hidden="true">+{completionCount}</span> : null}
                                      {completionRequiresReview ? <CircleAlert aria-hidden="true" /> : null}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                            {trailingDateCount ? (
                              <td
                                className="coach-register-spacer-cell"
                                colSpan={trailingDateCount}
                                aria-hidden="true"
                              />
                            ) : null}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </article>
    </div>
  )
}
