"use client"

import { ChevronDown } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef } from "react"
import type { CSSProperties } from "react"

import {
  parsePlayerAttendanceNavigation,
  playerAttendanceSearch,
} from "@/components/dashboard/player-attendance-query"
import { Reveal } from "@/components/reveal"
import { formatDateKey, formatSessionLabel, formatSessionTimeRange } from "@/lib/format"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import type { AttendanceSummary, PlayerAttendanceRecord } from "@/lib/types"

const weekdayShortLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type PlayerState = "assessment-pending" | "schedule-pending" | "active" | "paused"

type RegisterDate = {
  key: string
  day: string
  date: string
  month: string
  label: string
}

function buildRegisterDates(year: number) {
  const dates: RegisterDate[] = []
  for (
    const date = new Date(Date.UTC(year, 0, 1));
    date.getUTCFullYear() === year;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const key = date.toISOString().slice(0, 10)
    dates.push({
      key,
      day: formatDateKey(key, {
        day: undefined,
        month: undefined,
        weekday: "short",
      }),
      date: formatDateKey(key, {
        day: "numeric",
        month: "short",
        weekday: undefined,
      }),
      month: formatDateKey(key, {
        day: undefined,
        month: "long",
        weekday: undefined,
      }),
      label: formatDateKey(key, { year: "numeric" }),
    })
  }
  return dates
}

function groupDatesByMonth(dates: RegisterDate[]) {
  return dates.reduce<Array<{ label: string; count: number }>>((groups, date) => {
    const last = groups[groups.length - 1]
    if (last?.label === date.month) last.count += 1
    else groups.push({ label: date.month, count: 1 })
    return groups
  }, [])
}

export function PlayerAttendanceCard({
  attendance,
  playerState,
  record,
}: {
  attendance: AttendanceSummary | null
  playerState: PlayerState
  record: PlayerAttendanceRecord
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentYear = Number(record.referenceDate.slice(0, 4))
  const navigation = useMemo(() => parsePlayerAttendanceNavigation(
    searchParams,
    record.years,
    currentYear,
  ), [currentYear, record.years, searchParams])
  const { activeYear, isOpen } = navigation
  const registerScrollRef = useRef<HTMLDivElement>(null)
  const dates = useMemo(() => buildRegisterDates(activeYear), [activeYear])
  const monthGroups = useMemo(() => groupDatesByMonth(dates), [dates])
  const yearStart = `${activeYear}-01-01`
  const nextYearStart = `${activeYear + 1}-01-01`
  const rows = record.assignments.flatMap((assignment) => {
    const overlapsDisplayedYear = assignment.effectiveFrom < nextYearStart
      && (!assignment.effectiveTo || assignment.effectiveTo > yearStart)
    const coversReplacementInDisplayedYear = record.occurrences.some((occurrence) => (
      occurrence.status === "scheduled"
      && occurrence.occurrenceDate >= yearStart
      && occurrence.occurrenceDate < nextYearStart
      && assignmentCoversOccurrence(assignment, occurrence)
    ))
    if (!overlapsDisplayedYear && !coversReplacementInDisplayedYear) return []
    const session = record.sessions.find((item) => item.id === assignment.seriesId)
    return session ? [{ assignment, session }] : []
  }).sort((first, second) => (
    first.session.startTime.localeCompare(second.session.startTime)
    || first.assignment.id.localeCompare(second.assignment.id)
  ))
  const occurrenceBySeriesDate = new Map(
    [...record.occurrences]
      .filter((occurrence) => occurrence.occurrenceDate.startsWith(`${activeYear}-`))
      .sort((first, second) => (
        Number(first.status === "scheduled") - Number(second.status === "scheduled")
      ))
      .map((occurrence) => [`${occurrence.seriesId}:${occurrence.occurrenceDate}`, occurrence]),
  )
  const occurrenceById = new Map(record.occurrences.map((occurrence) => [occurrence.id, occurrence]))
  const choiceByOccurrence = new Map(record.records.map((item) => [item.occurrenceId, item.choice]))
  const adjustmentByOccurrence = new Map(
    record.adjustments.map((adjustment) => [adjustment.sourceOccurrenceId, adjustment]),
  )
  const todayTarget = dates.reduce(
    (latest, date) => date.key <= record.referenceDate ? date.key : latest,
    dates[0]?.key ?? "",
  )
  const hasRecord = record.assignments.length > 0 || record.records.length > 0
  const tableStyle = {
    "--player-register-width": `${190 + dates.length * 54}px`,
    "--player-register-mobile-width": `${136 + dates.length * 50}px`,
  } as CSSProperties

  useEffect(() => {
    const canonicalSearch = playerAttendanceSearch(
      searchParams.toString(),
      navigation,
      currentYear,
    )
    if (canonicalSearch === searchParams.toString()) return

    router.replace(canonicalSearch ? `${pathname}?${canonicalSearch}` : pathname, {
      scroll: false,
    })
  }, [currentYear, navigation, pathname, router, searchParams])

  const scrollRegisterToToday = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = registerScrollRef.current
      const header = container?.querySelector<HTMLElement>(`[data-player-register-date="${todayTarget}"]`)
      if (container && header) {
        container.scrollTo({ left: Math.max(0, header.offsetLeft - 170), behavior: "auto" })
      }
    })
    return frame
  }, [todayTarget])

  useEffect(() => {
    if (!isOpen || activeYear !== currentYear) return
    const frame = scrollRegisterToToday()
    return () => window.cancelAnimationFrame(frame)
  }, [activeYear, currentYear, isOpen, scrollRegisterToToday])

  function updateNavigation(next: typeof navigation) {
    const nextSearch = playerAttendanceSearch(
      searchParams.toString(),
      next,
      currentYear,
    )
    router.push(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false })
  }

  function jumpToToday() {
    if (activeYear !== currentYear) {
      updateNavigation({ isOpen: true, activeYear: currentYear })
      return
    }
    scrollRegisterToToday()
  }

  return (
    <Reveal
      className={`attendance-card dashboard-card player-attendance-card player-ticket-card player-ticket-attendance${attendance ? "" : " is-empty"}${hasRecord ? " has-record" : ""}${isOpen ? " is-open" : ""}`}
      delay={0.06}
    >
      <header className="attendance-card-header player-ticket-masthead">
        <h3 className="player-ticket-title">Attendance</h3>
        <span className="player-ticket-context">{attendance?.month ?? "Record"}</span>
      </header>
      <div className="player-ticket-attendance-primary">
        {attendance && attendance.percentage !== null ? (
          <>
            <strong className="attendance-value">{attendance.percentage}%</strong>
            <p className="attendance-summary-copy">
              {attendance.attended} of {attendance.recorded} recorded sessions attended.
              {attendance.pending
                ? ` ${attendance.pending} ${attendance.pending === 1 ? "session is" : "sessions are"} pending.`
                : ""}
            </p>
            <div
              className="attendance-track"
              role="progressbar"
              aria-label={`${attendance.percentage}% attendance in ${attendance.month}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={attendance.percentage}
            >
              <span style={{ width: `${attendance.percentage}%` }} />
            </div>
          </>
        ) : attendance?.pending ? (
          <>
            <strong className="empty-card-title">Attendance pending</strong>
            <p className="empty-card-copy">
              {attendance.pending} {attendance.pending === 1 ? "session is" : "sessions are"} waiting for the coach’s record.
            </p>
          </>
        ) : (
          <>
            <strong className="empty-card-title">
              {playerState === "active"
                ? "No sessions yet this month"
                : playerState === "paused"
                  ? "Training paused"
                  : "Not started"}
            </strong>
            <p className="empty-card-copy">
              {playerState === "active"
                ? "This month’s record begins when your first session starts."
                : playerState === "paused"
                  ? "Your existing attendance record remains available while training is paused."
                  : "Your attendance record begins when your first session starts."}
            </p>
          </>
        )}
      </div>

      {hasRecord ? (
        <button
          className="player-attendance-toggle player-ticket-action"
          type="button"
          aria-expanded={isOpen}
          aria-controls="player-attendance-register"
          onClick={() => updateNavigation({
            isOpen: !isOpen,
            activeYear,
          })}
        >
          <span>{isOpen ? "Close attendance record" : "Open attendance record"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      ) : null}

      {isOpen ? (
        <div className="player-attendance-register" id="player-attendance-register">
          <div className="player-attendance-register-heading">
            <div>
              <span>Your record</span>
              <h3>Annual attendance</h3>
            </div>
            <div className="player-attendance-register-actions">
              <div className="player-attendance-year-selector" role="group" aria-label="Choose attendance year">
                <span>Year</span>
                {record.years.map((year) => (
                  <button
                    key={year}
                    type="button"
                    className={year === activeYear ? "is-active" : undefined}
                    aria-pressed={year === activeYear}
                    onClick={() => updateNavigation({ isOpen: true, activeYear: year })}
                  >
                    {year}
                  </button>
                ))}
              </div>
              <button className="player-attendance-today" type="button" onClick={jumpToToday}>
                Jump to today
              </button>
            </div>
          </div>

          <div
            className="player-attendance-legend"
            role="group"
            aria-label="Attendance status legend"
          >
            <span><i className="is-present" aria-hidden="true" />Present</span>
            <span><i className="is-absent" aria-hidden="true" />Absent</span>
            <span><i className="is-pending" aria-hidden="true" />Pending</span>
            <span><i className="is-makeup" aria-hidden="true" />Rescheduled</span>
            <span><i className="is-unavailable" aria-hidden="true" />Not scheduled</span>
          </div>

          {!rows.length ? (
            <div className="player-attendance-empty-year">
              <p>No assigned sessions appear in {activeYear}.</p>
            </div>
          ) : (
            <div
              className="player-attendance-register-scroll"
              ref={registerScrollRef}
              tabIndex={0}
              role="region"
              aria-label={`Scrollable personal attendance register for ${activeYear}`}
            >
              <table
                className="player-attendance-register-table"
                style={tableStyle}
                aria-label={`Your attendance register for ${activeYear}`}
              >
                <thead>
                  <tr className="player-attendance-month-row">
                    <th className="player-attendance-session-column" scope="col" rowSpan={2}>Session</th>
                    {monthGroups.map((month) => (
                      <th key={month.label} scope="colgroup" colSpan={month.count}>
                        <span>{month.label}</span>
                      </th>
                    ))}
                  </tr>
                  <tr className="player-attendance-date-row">
                    {dates.map((date) => {
                      const available = rows.some(({ assignment, session }) => {
                        const occurrence = occurrenceBySeriesDate.get(`${session.id}:${date.key}`)
                        return Boolean(occurrence
                          && occurrence.status === "scheduled"
                          && playerWasEnrolledForOccurrence(record.joinedOn, occurrence)
                          && assignmentCoversOccurrence(assignment, occurrence))
                      })
                      return (
                        <th
                          key={date.key}
                          scope="col"
                          data-player-register-date={date.key}
                          className={[
                            date.key === record.referenceDate ? "is-today" : "",
                            !available ? "is-unavailable" : "",
                          ].filter(Boolean).join(" ") || undefined}
                        >
                          <span>{date.day}</span>
                          <strong>{date.date}</strong>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ assignment, session }) => {
                    const sessionLabel = formatSessionLabel(session)
                    const timeLabel = formatSessionTimeRange(session)
                    const assignedDays = assignment.weekdays
                      .map((weekday) => weekdayShortLabels[weekday])
                      .join(", ")
                    const rowAdjustments = record.adjustments.filter((adjustment) => {
                      const source = occurrenceById.get(adjustment.sourceOccurrenceId)
                      return Boolean(source
                        && source.seriesId === session.id
                        && playerWasEnrolledForOccurrence(record.joinedOn, source)
                        && assignmentCoversOccurrence(assignment, source))
                    })
                    const completionByDate = rowAdjustments.reduce<Map<string, number>>((map, adjustment) => {
                      map.set(adjustment.completedOn, (map.get(adjustment.completedOn) ?? 0) + 1)
                      return map
                    }, new Map())

                    return (
                      <tr key={assignment.id}>
                        <th className="player-attendance-session-column" scope="row" aria-label={`${sessionLabel}, assigned ${assignedDays}`}>
                          <strong>{timeLabel}</strong>
                          <small>{assignedDays}</small>
                        </th>
                        {dates.map((date) => {
                          const occurrence = occurrenceBySeriesDate.get(`${session.id}:${date.key}`)
                          const unavailable = !occurrence
                            || occurrence.status !== "scheduled"
                            || !playerWasEnrolledForOccurrence(record.joinedOn, occurrence)
                            || !assignmentCoversOccurrence(assignment, occurrence)
                          const future = occurrence
                            ? occurrenceIsUpcoming(occurrence, record.referenceInstant)
                            : false
                          const choice = occurrence ? choiceByOccurrence.get(occurrence.id) : undefined
                          const adjustment = occurrence ? adjustmentByOccurrence.get(occurrence.id) : undefined
                          const completionCount = completionByDate.get(date.key) ?? 0
                          const ordinaryState = unavailable
                            ? "not scheduled"
                            : future
                              ? "future session"
                              : choice ?? "pending"
                          const state = adjustment
                            ? "rescheduled attendance recorded"
                            : ordinaryState
                          const stateWithCompletion = completionCount
                            ? `${state}; ${completionCount} completed rescheduled ${completionCount === 1 ? "session" : "sessions"}`
                            : state

                          return (
                            <td
                              key={date.key}
                              className={date.key === record.referenceDate ? "is-today" : undefined}
                              aria-label={`${sessionLabel}, ${date.label}: ${stateWithCompletion}`}
                              title={`${date.label}: ${stateWithCompletion}`}
                            >
                              <span
                                className={[
                                  "player-attendance-cell",
                                  adjustment ? "is-makeup" : unavailable ? "is-unavailable" : future ? "is-future" : choice ? `is-${choice}` : "is-pending",
                                  completionCount ? "has-makeup-completion" : "",
                                ].filter(Boolean).join(" ")}
                                aria-hidden="true"
                              >
                                {completionCount ? <b aria-hidden="true">+{completionCount}</b> : null}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Reveal>
  )
}
