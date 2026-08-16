"use client"

import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"

import { buildJuniorCoachAttendanceCalendar } from "@/components/coach/junior-coach-attendance-calendar"
import {
  playerAttendanceMonthLabels,
  playerAttendanceWeekdayLabels,
} from "@/components/dashboard/player-attendance-calendar"
import {
  parsePlayerAttendanceNavigation,
  playerAttendanceSearch,
  shiftPlayerAttendanceMonth,
} from "@/components/dashboard/player-attendance-query"
import { Reveal } from "@/components/reveal"
import { formatDateKey } from "@/lib/format"

import styles from "./junior-coach-dashboard.module.css"

type PersonalStaffAttendanceRecord = {
  choice: "present" | "absent" | "cleared"
  dateKey: string
}

export type JuniorCoachAttendanceView = {
  joinedOn: string
  monthLabel: string
  referenceDate: string
  records: PersonalStaffAttendanceRecord[]
  summary: {
    absent: number
    percentage: number | null
    present: number
    recorded: number
  }
  years: number[]
}

function monthNavigationLabel(year: number, month: number) {
  return `${playerAttendanceMonthLabels[month - 1]} ${year}`
}

export function JuniorCoachAttendanceCard({
  attendance,
}: {
  attendance: JuniorCoachAttendanceView
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentYear = Number(attendance.referenceDate.slice(0, 4))
  const currentMonth = Number(attendance.referenceDate.slice(5, 7))
  const navigation = useMemo(() => parsePlayerAttendanceNavigation(
    searchParams,
    attendance.years,
    currentYear,
    currentMonth,
  ), [attendance.years, currentMonth, currentYear, searchParams])
  const { activeMonth, activeYear, isOpen } = navigation
  const calendar = useMemo(() => buildJuniorCoachAttendanceCalendar(
    attendance,
    activeYear,
    activeMonth,
  ), [activeMonth, activeYear, attendance])
  const previousMonth = shiftPlayerAttendanceMonth(navigation, -1, attendance.years)
  const nextMonth = shiftPlayerAttendanceMonth(navigation, 1, attendance.years)
  const canMovePrevious = previousMonth.activeYear !== activeYear
    || previousMonth.activeMonth !== activeMonth
  const canMoveNext = nextMonth.activeYear !== activeYear
    || nextMonth.activeMonth !== activeMonth

  useEffect(() => {
    const canonicalSearch = playerAttendanceSearch(
      searchParams.toString(),
      navigation,
      currentYear,
      currentMonth,
    )
    if (canonicalSearch === searchParams.toString()) return

    router.replace(canonicalSearch ? `${pathname}?${canonicalSearch}` : pathname, {
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
    router.push(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false })
  }

  function jumpToToday() {
    updateNavigation({
      isOpen: true,
      activeYear: currentYear,
      activeMonth: currentMonth,
    })
  }

  const recordedValue = String(attendance.summary.recorded).padStart(2, "0")
  const presentValue = String(attendance.summary.present).padStart(2, "0")
  const absentValue = String(attendance.summary.absent).padStart(2, "0")

  return (
    <section
      id="coach-attendance"
      className={`dashboard-section page-shell junior-coach-attendance-section ${styles.attendanceSection}`}
    >
      <Reveal
        className={`dashboard-card junior-coach-attendance-card ${styles.ledgerTicket}${isOpen ? ` ${styles.ledgerTicketOpen}` : ""}`}
      >
        <header className={styles.ledgerMasthead}>
          <h2>Personal roll-call ledger</h2>
          <span>{attendance.monthLabel}</span>
        </header>

        <div className={styles.ledgerBody}>
          <div className={styles.primaryMetric}>
            <strong>
              {attendance.summary.percentage === null
                ? "—"
                : `${attendance.summary.percentage}%`}
            </strong>
            <span>Attendance</span>
          </div>

          <dl className={styles.ledgerRows} aria-label={`${attendance.monthLabel} attendance totals`}>
            <div>
              <dt>Recorded days</dt>
              <dd>{recordedValue}</dd>
            </div>
            <div>
              <dt>Present</dt>
              <dd>{presentValue}</dd>
            </div>
            <div>
              <dt>Absent</dt>
              <dd>{absentValue}</dd>
            </div>
          </dl>

          <div className={styles.ledgerAction}>
            <p>
              {attendance.summary.recorded
                ? "Review your read-only attendance calendar whenever you need it."
                : "Your record will appear after the head coach saves an attendance day."}
            </p>
            <button
              className={styles.ledgerActionButton}
              type="button"
              aria-expanded={isOpen}
              aria-controls={isOpen ? "junior-coach-attendance-register" : undefined}
              onClick={() => updateNavigation({
                ...navigation,
                isOpen: !isOpen,
              })}
            >
              <span>{isOpen ? "Close attendance record" : "Open attendance record"}</span>
              {isOpen ? <ChevronUp aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
            </button>
          </div>
        </div>

        {isOpen ? (
          <div
            className={`player-attendance-register personal-attendance-register ${styles.attendanceRegister}`}
            id="junior-coach-attendance-register"
          >
            <div className="player-attendance-register-heading">
              <div className="player-attendance-register-title">
                <span>Your record</span>
                <h3>Annual attendance</h3>
              </div>
              <div className="player-attendance-register-actions">
                <div className="player-attendance-year-selector" role="group" aria-label="Choose attendance year">
                  {attendance.years.map((year) => (
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
                <button className="player-attendance-today" type="button" onClick={jumpToToday}>
                  Jump to today
                </button>
              </div>
            </div>

            <section
              className="player-attendance-month-sheet personal-attendance-calendar"
              aria-label={`${monthNavigationLabel(activeYear, activeMonth)} attendance calendar`}
            >
              <header className="player-attendance-month-toolbar">
                <button
                  className="player-attendance-month-nav is-previous"
                  type="button"
                  disabled={!canMovePrevious}
                  aria-label={canMovePrevious
                    ? `View ${monthNavigationLabel(previousMonth.activeYear, previousMonth.activeMonth)}`
                    : "No previous attendance month available"}
                  onClick={() => updateNavigation({ ...previousMonth, isOpen: true })}
                >
                  <ChevronLeft aria-hidden="true" />
                  <span>{canMovePrevious
                    ? monthNavigationLabel(previousMonth.activeYear, previousMonth.activeMonth)
                    : "Previous"}</span>
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
                  aria-label={canMoveNext
                    ? `View ${monthNavigationLabel(nextMonth.activeYear, nextMonth.activeMonth)}`
                    : "No next attendance month available"}
                  onClick={() => updateNavigation({ ...nextMonth, isOpen: true })}
                >
                  <span>{canMoveNext
                    ? monthNavigationLabel(nextMonth.activeYear, nextMonth.activeMonth)
                    : "Next"}</span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </header>

              <div className="player-attendance-month-tools">
                <div
                  className="player-attendance-legend"
                  role="group"
                  aria-label="Attendance status legend"
                >
                  <span><i className="is-present" aria-hidden="true" />Present</span>
                  <span><i className="is-absent" aria-hidden="true" />Absent</span>
                  <span><i className="is-pending" aria-hidden="true" />Not recorded</span>
                  <span><i className="is-unavailable" aria-hidden="true" />Not available</span>
                </div>
                <p>Use the arrows to review each month.</p>
              </div>

              <div className="player-attendance-calendar-frame">
                <div
                  className="player-attendance-calendar"
                  role="grid"
                  aria-label={`Your attendance calendar for ${monthNavigationLabel(activeYear, activeMonth)}`}
                  aria-colcount={7}
                  aria-rowcount={7}
                >
                  <div className="player-attendance-calendar-weekdays" role="row">
                    {playerAttendanceWeekdayLabels.map((weekday) => (
                      <div
                        className="player-attendance-calendar-weekday"
                        role="columnheader"
                        key={weekday}
                      >
                        <span className="player-attendance-weekday-long">{weekday}</span>
                        <span className="player-attendance-weekday-short">{weekday.slice(0, 3)}</span>
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
                        {calendar.days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => {
                          const stateClass = day.state === "unmarked"
                            ? "is-pending"
                            : day.state === "unavailable"
                              ? "is-not-scheduled"
                              : `is-${day.state}`
                          const className = [
                            "player-attendance-calendar-day",
                            styles.staffCalendarDay,
                            stateClass,
                            day.inSelectedMonth ? "" : "is-outside-month",
                            day.isToday ? "is-today" : "",
                          ].filter(Boolean).join(" ")

                          return (
                            <div
                              className={className}
                              role="gridcell"
                              key={day.key}
                              aria-current={day.isToday ? "date" : undefined}
                              aria-label={`${day.label}: ${day.stateLabel}`}
                              title={`${day.label}: ${day.stateLabel}`}
                            >
                              <div aria-hidden="true">
                                <div className="player-attendance-calendar-date">
                                  <strong>{day.dayNumber}</strong>
                                  <span>{day.monthShort}</span>
                                </div>
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
                  <span>Today · {formatDateKey(attendance.referenceDate, { year: "numeric" })}</span>
                  <span>Attendance is recorded by the head coach.</span>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </Reveal>
    </section>
  )
}
