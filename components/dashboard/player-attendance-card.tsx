"use client"

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"

import {
  buildPlayerAttendanceCalendar,
  playerAttendanceMonthLabels,
  playerAttendanceWeekdayLabels,
  type PlayerAttendanceCalendarDay,
  type PlayerAttendanceCalendarSessionState,
} from "@/components/dashboard/player-attendance-calendar"
import {
  parsePlayerAttendanceNavigation,
  playerAttendanceSearch,
  shiftPlayerAttendanceMonth,
} from "@/components/dashboard/player-attendance-query"
import { Reveal } from "@/components/reveal"
import { formatDateKey } from "@/lib/format"
import type { AttendanceSummary, PlayerAttendanceRecord } from "@/lib/types"

type PlayerState = "assessment-pending" | "schedule-pending" | "active" | "paused"

function visibleStateLabel(state: PlayerAttendanceCalendarSessionState) {
  if (state === "rescheduled") return "Rescheduled"
  if (state === "future") return "Scheduled"
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function calendarDayLabel(day: PlayerAttendanceCalendarDay) {
  const sessionDetails = day.sessions.length
    ? day.sessions.map((session) => (
        session.sessionLabel + ": " + session.stateLabel
      )).join("; ")
    : day.inLoadedYear
      ? "not scheduled"
      : "outside the available attendance record"
  const completionDetails = day.completionCount
    ? "; " + day.completionCount + " completed rescheduled "
      + (day.completionCount === 1 ? "session" : "sessions")
    : ""

  return day.label + ": " + sessionDetails + completionDetails
}

function monthNavigationLabel(year: number, month: number) {
  return playerAttendanceMonthLabels[month - 1] + " " + year
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
  const currentMonth = Number(record.referenceDate.slice(5, 7))
  const navigation = useMemo(() => parsePlayerAttendanceNavigation(
    searchParams,
    record.years,
    currentYear,
    currentMonth,
  ), [currentMonth, currentYear, record.years, searchParams])
  const { activeMonth, activeYear, isOpen } = navigation
  const calendar = useMemo(() => buildPlayerAttendanceCalendar(
    record,
    activeYear,
    activeMonth,
  ), [activeMonth, activeYear, record])
  const previousMonth = shiftPlayerAttendanceMonth(navigation, -1, record.years)
  const nextMonth = shiftPlayerAttendanceMonth(navigation, 1, record.years)
  const canMovePrevious = previousMonth.activeYear !== activeYear
    || previousMonth.activeMonth !== activeMonth
  const canMoveNext = nextMonth.activeYear !== activeYear
    || nextMonth.activeMonth !== activeMonth
  const hasRecord = record.assignments.length > 0 || record.records.length > 0
  const completionCount = calendar.days.reduce(
    (total, day) => total + day.completionCount,
    0,
  )

  useEffect(() => {
    const canonicalSearch = playerAttendanceSearch(
      searchParams.toString(),
      navigation,
      currentYear,
      currentMonth,
    )
    if (canonicalSearch === searchParams.toString()) return

    router.replace(canonicalSearch ? pathname + "?" + canonicalSearch : pathname, {
      scroll: false,
    })
  }, [
    currentMonth,
    currentYear,
    navigation,
    pathname,
    router,
    searchParams,
  ])

  function updateNavigation(next: typeof navigation) {
    const nextSearch = playerAttendanceSearch(
      searchParams.toString(),
      next,
      currentYear,
      currentMonth,
    )
    router.push(nextSearch ? pathname + "?" + nextSearch : pathname, { scroll: false })
  }

  function jumpToToday() {
    updateNavigation({
      isOpen: true,
      activeYear: currentYear,
      activeMonth: currentMonth,
    })
  }

  return (
    <Reveal
      className={
        "attendance-card dashboard-card player-attendance-card player-ticket-card player-ticket-attendance"
        + (attendance ? "" : " is-empty")
        + (hasRecord ? " has-record" : "")
        + (isOpen ? " is-open" : "")
      }
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
                ? " " + attendance.pending + " "
                  + (attendance.pending === 1 ? "session is" : "sessions are")
                  + " pending."
                : ""}
            </p>
            <div
              className="attendance-track"
              role="progressbar"
              aria-label={
                attendance.percentage + "% attendance in " + attendance.month
              }
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={attendance.percentage}
            >
              <span style={{ width: String(attendance.percentage) + "%" }} />
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
          aria-controls={isOpen ? "player-attendance-register" : undefined}
          onClick={() => updateNavigation({
            ...navigation,
            isOpen: !isOpen,
          })}
        >
          <span>{isOpen ? "Close attendance record" : "Open attendance record"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      ) : null}

      {isOpen ? (
        <div
          className="player-attendance-register personal-attendance-register"
          id="player-attendance-register"
        >
          <div className="player-attendance-register-heading">
            <div className="player-attendance-register-title">
              <span>Your record</span>
              <h3>Annual attendance</h3>
            </div>
            <div className="player-attendance-register-actions">
              <div
                className="player-attendance-year-selector"
                role="group"
                aria-label="Choose attendance year"
              >
                {record.years.map((year) => (
                  <button
                    key={year}
                    type="button"
                    className={year === activeYear ? "is-active" : undefined}
                    aria-pressed={year === activeYear}
                    onClick={() => updateNavigation({
                      ...navigation,
                      isOpen: true,
                      activeYear: year,
                    })}
                  >
                    {year}
                  </button>
                ))}
              </div>
              <button
                className="player-attendance-today"
                type="button"
                onClick={jumpToToday}
              >
                Jump to today
              </button>
            </div>
          </div>

          <section
            className="player-attendance-month-sheet personal-attendance-calendar"
            aria-label={
              monthNavigationLabel(activeYear, activeMonth)
              + " attendance calendar"
            }
          >
            <header className="player-attendance-month-toolbar">
              <button
                className="player-attendance-month-nav is-previous"
                type="button"
                disabled={!canMovePrevious}
                aria-label={
                  canMovePrevious
                    ? "View " + monthNavigationLabel(
                        previousMonth.activeYear,
                        previousMonth.activeMonth,
                      )
                    : "No previous attendance month available"
                }
                onClick={() => updateNavigation({
                  ...previousMonth,
                  isOpen: true,
                })}
              >
                <ChevronLeft aria-hidden="true" />
                <span>
                  {canMovePrevious
                    ? monthNavigationLabel(
                        previousMonth.activeYear,
                        previousMonth.activeMonth,
                      )
                    : "Previous"}
                </span>
              </button>

              <div
                className="player-attendance-month-current"
                aria-live="polite"
                aria-atomic="true"
              >
                <span>Attendance month</span>
                <strong>{monthNavigationLabel(activeYear, activeMonth)}</strong>
              </div>

              <button
                className="player-attendance-month-nav is-next"
                type="button"
                disabled={!canMoveNext}
                aria-label={
                  canMoveNext
                    ? "View " + monthNavigationLabel(
                        nextMonth.activeYear,
                        nextMonth.activeMonth,
                      )
                    : "No next attendance month available"
                }
                onClick={() => updateNavigation({
                  ...nextMonth,
                  isOpen: true,
                })}
              >
                <span>
                  {canMoveNext
                    ? monthNavigationLabel(
                        nextMonth.activeYear,
                        nextMonth.activeMonth,
                      )
                    : "Next"}
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </header>

            {calendar.schedules.length ? (
              <div
                className="player-attendance-calendar-schedules"
                role="list"
                aria-label="Assigned sessions in the selected month"
              >
                {calendar.schedules.map((schedule) => (
                  <div className="player-attendance-calendar-schedule" role="listitem" key={schedule.id}>
                    <div>
                      <span>Training group</span>
                      <strong>{schedule.groupLabel}</strong>
                    </div>
                    <div>
                      <span>Session</span>
                      <strong>{schedule.timeLabel || "Time pending"}</strong>
                    </div>
                    <div>
                      <span>Training days</span>
                      <strong>{schedule.assignedDays || "Days pending"}</strong>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="player-attendance-calendar-empty">
                No assigned sessions appear in {playerAttendanceMonthLabels[activeMonth - 1]} {activeYear}.
              </div>
            )}

            <div className="player-attendance-month-tools">
              <div
                className="player-attendance-legend"
                role="group"
                aria-label="Attendance status legend"
              >
                <span><i className="is-present" aria-hidden="true" />Present</span>
                <span><i className="is-absent" aria-hidden="true" />Absent</span>
                <span><i className="is-pending" aria-hidden="true" />Pending</span>
                <span><i className="is-scheduled" aria-hidden="true" />Scheduled</span>
                <span><i className="is-makeup" aria-hidden="true" />Rescheduled</span>
                <span><i className="is-unavailable" aria-hidden="true" />Not scheduled</span>
              </div>
              <p>Select the month above or use the arrows.</p>
            </div>

            <div className="player-attendance-calendar-frame">
              <div
                className="player-attendance-calendar"
                role="grid"
                aria-label={
                  "Your attendance calendar for "
                  + monthNavigationLabel(activeYear, activeMonth)
                }
                aria-colcount={7}
                aria-rowcount={6}
              >
                <div className="player-attendance-calendar-weekdays" role="row">
                  {playerAttendanceWeekdayLabels.map((weekday) => (
                    <div
                      className="player-attendance-calendar-weekday"
                      role="columnheader"
                      key={weekday}
                    >
                      <span className="player-attendance-weekday-long">{weekday}</span>
                      <span className="player-attendance-weekday-short">
                        {weekday.slice(0, 3)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="player-attendance-calendar-weeks" role="rowgroup">
                  {Array.from({ length: 6 }, (_, weekIndex) => (
                    <div
                      className="player-attendance-calendar-week"
                      role="row"
                      key={calendar.days[weekIndex * 7].key}
                    >
                      {calendar.days.slice(weekIndex * 7, weekIndex * 7 + 7)
                        .map((day) => {
                          const singleState = day.sessions.length === 1
                            ? day.sessions[0].state
                            : null
                          const className = [
                            "player-attendance-calendar-day",
                            day.inSelectedMonth ? "" : "is-outside-month",
                            day.inLoadedYear ? "" : "is-outside-record",
                            day.isToday ? "is-today" : "",
                            !day.sessions.length ? "is-not-scheduled" : "",
                            day.sessions.length > 1 ? "has-multiple-sessions" : "",
                            singleState ? "is-" + singleState : "",
                          ].filter(Boolean).join(" ")

                          return (
                            <div
                              className={className}
                              role="gridcell"
                              key={day.key}
                              aria-current={day.isToday ? "date" : undefined}
                              aria-label={calendarDayLabel(day)}
                              title={calendarDayLabel(day)}
                            >
                              <div aria-hidden="true">
                                <div className="player-attendance-calendar-date">
                                  <strong>{day.dayNumber}</strong>
                                  <span>{day.monthShort}</span>
                                </div>
                                <div className="player-attendance-calendar-session-list">
                                  {day.sessions.map((session) => (
                                    <span
                                      className={
                                        "player-attendance-calendar-session is-"
                                        + session.state
                                      }
                                      key={session.assignmentId + ":" + session.occurrenceId}
                                    >
                                      <strong>{session.timeLabel}</strong>
                                      <small>{visibleStateLabel(session.state)}</small>
                                    </span>
                                  ))}
                                </div>
                                {day.completionCount ? (
                                  <b className="player-attendance-calendar-completion">
                                    +{day.completionCount}
                                  </b>
                                ) : null}
                                {day.isToday ? (
                                  <span className="player-attendance-calendar-today">Today</span>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="player-attendance-calendar-note">
                <span>
                  Today · {formatDateKey(record.referenceDate, { year: "numeric" })}
                </span>
                {completionCount ? (
                  <span>
                    +N marks completed rescheduled sessions.
                  </span>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </Reveal>
  )
}
