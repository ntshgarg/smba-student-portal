"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"

import {
  buildJuniorCoachAttendanceCalendar,
  type JuniorCoachAttendanceCalendarState,
} from "@/components/coach/junior-coach-attendance-calendar"
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

import styles from "./junior-coach-dashboard.module.css"

type PersonalStaffAttendanceRecord = {
  choice: "present" | "absent" | "cleared"
  dateKey: string
}

export type JuniorCoachAttendanceView = {
  /** Days the academy was closed; they are shown as closed, not "not recorded". */
  holidays: Array<{ dateKey: string; label: string }>
  joinedOn: string
  referenceDate: string
  records: PersonalStaffAttendanceRecord[]
  /** this month's totals from the attendance service */
  summary: {
    absent: number
    percentage: number | null
    present: number
    recorded: number
  }
  years: number[]
}

const legend: Array<{ label: string; state: JuniorCoachAttendanceCalendarState }> = [
  { label: "Present", state: "present" },
  { label: "Absent", state: "absent" },
  { label: "Holiday", state: "closed" },
  { label: "Not recorded", state: "unmarked" },
  { label: "Upcoming", state: "upcoming" },
  { label: "Not available", state: "unavailable" },
]

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
  const { activeMonth, activeYear } = navigation
  const isCurrentMonth = activeYear === currentYear && activeMonth === currentMonth
  const calendar = useMemo(() => buildJuniorCoachAttendanceCalendar(
    attendance,
    activeYear,
    activeMonth,
  ), [activeMonth, activeYear, attendance])
  const monthDays = calendar.days.filter((day) => day.inSelectedMonth)
  // This month's totals are the service's; an earlier month is counted from its
  // tiles by the same rule (a closed day leaves the count).
  const summary = isCurrentMonth ? attendance.summary : (() => {
    const present = monthDays.filter((day) => day.state === "present").length
    const absent = monthDays.filter((day) => day.state === "absent").length
    const recorded = present + absent
    return {
      absent,
      percentage: recorded ? Math.round((present / recorded) * 100) : null,
      present,
      recorded,
    }
  })()
  const shownStates = new Set(monthDays.map((day) => day.state))
  const activeLabel = monthNavigationLabel(activeYear, activeMonth)
  const previousMonth = shiftPlayerAttendanceMonth(navigation, -1, attendance.years)
  const nextMonth = shiftPlayerAttendanceMonth(navigation, 1, attendance.years)
  const canMovePrevious = previousMonth.activeYear !== activeYear
    || previousMonth.activeMonth !== activeMonth
  // Later months hold nothing yet, so the arrows stop at this month.
  const beforeCurrentMonth = activeYear * 12 + activeMonth < currentYear * 12 + currentMonth

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

  function showMonth(next: typeof navigation) {
    const backToToday = next.activeYear === currentYear && next.activeMonth === currentMonth
    const nextSearch = playerAttendanceSearch(
      searchParams.toString(),
      { ...next, isOpen: !backToToday },
      currentYear,
      currentMonth,
    )
    router.push(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false })
  }

  return (
    <section
      id="coach-attendance"
      className={`dashboard-section page-shell junior-coach-attendance-section ${styles.attendanceSection}`}
    >
      <Reveal
        className={`dashboard-card junior-coach-attendance-card ${styles.ledgerTicket}`}
      >
        <header className={styles.ledgerMasthead}>
          <h2>My attendance</h2>
          <span aria-live="polite" aria-atomic="true">{activeLabel}</span>
        </header>

        <div className={styles.ledgerBody}>
          <div className={styles.primaryMetric}>
            <strong data-empty={summary.percentage === null ? "" : undefined}>
              {summary.percentage === null ? "—" : `${summary.percentage}%`}
            </strong>
            <p>
              {summary.recorded
                ? `Present on ${summary.present} of ${summary.recorded} marked ${summary.recorded === 1 ? "day" : "days"}`
                : "Your record will appear after the head coach saves an attendance day."}
            </p>
            <dl className={styles.counts} aria-label={`${activeLabel} attendance totals`}>
              <div data-state="present">
                <dt>Present</dt>
                <dd>{summary.present}</dd>
              </div>
              <div data-state="absent">
                <dt>Absent</dt>
                <dd>{summary.absent}</dd>
              </div>
            </dl>
          </div>

          <div className={styles.month}>
            <div
              className={styles.calendar}
              role="grid"
              aria-label={`Your attendance calendar for ${activeLabel}`}
              aria-colcount={7}
              aria-rowcount={7}
            >
              <div className={styles.calendarRow} role="row">
                {playerAttendanceWeekdayLabels.map((weekday) => (
                  <div className={styles.weekday} role="columnheader" key={weekday}>
                    <abbr title={weekday}>{weekday.slice(0, 3)}</abbr>
                  </div>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div
                  className={styles.calendarRow}
                  role="row"
                  key={calendar.days[weekIndex * 7].key}
                >
                  {calendar.days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => (
                    day.inSelectedMonth ? (
                      <div
                        className={styles.tile}
                        data-state={day.state}
                        role="gridcell"
                        key={day.key}
                        aria-current={day.isToday ? "date" : undefined}
                        aria-label={`${day.label}: ${day.stateLabel}`}
                        title={`${day.label}: ${day.stateLabel}`}
                      >
                        <span aria-hidden="true">{day.dayNumber}</span>
                      </div>
                    ) : (
                      <div className={styles.tile} role="gridcell" key={day.key} />
                    )
                  ))}
                </div>
              ))}
            </div>

            <div className={styles.legend} role="group" aria-label="Attendance status legend">
              {legend
                .filter((item) => item.state !== "unavailable" || shownStates.has(item.state))
                .map((item) => (
                  <span key={item.state}>
                    <i className={styles.tile} data-state={item.state} aria-hidden="true" />
                    {item.label}
                  </span>
                ))}
            </div>
          </div>
        </div>

        <nav className={styles.monthNav} aria-label="Choose attendance month">
          <button
            className={styles.ledgerActionButton}
            type="button"
            disabled={!canMovePrevious}
            aria-label={canMovePrevious
              ? `Earlier months: view ${monthNavigationLabel(previousMonth.activeYear, previousMonth.activeMonth)}`
              : "No earlier attendance month available"}
            onClick={() => showMonth(previousMonth)}
          >
            <ChevronLeft aria-hidden="true" />
            <span>Earlier months</span>
          </button>
          {beforeCurrentMonth ? (
            <button
              className={styles.ledgerActionButton}
              type="button"
              aria-label={`Later month: view ${monthNavigationLabel(nextMonth.activeYear, nextMonth.activeMonth)}`}
              onClick={() => showMonth(nextMonth)}
            >
              <span>Later month</span>
              <ChevronRight aria-hidden="true" />
            </button>
          ) : null}
        </nav>
      </Reveal>
    </section>
  )
}
