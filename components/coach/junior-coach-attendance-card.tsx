"use client"

import { Check, ChevronDown, Clock3 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

import { Reveal } from "@/components/reveal"
import { formatDateKey } from "@/lib/format"

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

type RegisterDate = {
  date: string
  day: string
  key: string
  label: string
  month: string
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
      day: formatDateKey(key, { day: undefined, month: undefined, weekday: "short" }),
      date: formatDateKey(key, { day: "numeric", month: "short", weekday: undefined }),
      month: formatDateKey(key, { day: undefined, month: "long", weekday: undefined }),
      label: formatDateKey(key, { year: "numeric" }),
    })
  }
  return dates
}

function groupDatesByMonth(dates: RegisterDate[]) {
  return dates.reduce<Array<{ count: number; label: string }>>((groups, date) => {
    const last = groups[groups.length - 1]
    if (last?.label === date.month) last.count += 1
    else groups.push({ label: date.month, count: 1 })
    return groups
  }, [])
}

export function JuniorCoachAttendanceCard({
  attendance,
}: {
  attendance: JuniorCoachAttendanceView
}) {
  const currentYear = Number(attendance.referenceDate.slice(0, 4))
  const [activeYear, setActiveYear] = useState(currentYear)
  const [isOpen, setIsOpen] = useState(false)
  const [scrollToToday, setScrollToToday] = useState(false)
  const registerScrollRef = useRef<HTMLDivElement>(null)
  const dates = useMemo(() => buildRegisterDates(activeYear), [activeYear])
  const monthGroups = useMemo(() => groupDatesByMonth(dates), [dates])
  const choices = useMemo(() => new Map(
    attendance.records
      .filter((record) => record.choice !== "cleared")
      .map((record) => [record.dateKey, record.choice]),
  ), [attendance.records])
  const tableStyle = {
    "--player-register-width": `${190 + dates.length * 54}px`,
    "--player-register-mobile-width": `${136 + dates.length * 50}px`,
  } as CSSProperties

  useEffect(() => {
    if (!isOpen || !scrollToToday || activeYear !== currentYear) return
    const frame = window.requestAnimationFrame(() => {
      const container = registerScrollRef.current
      const header = container?.querySelector<HTMLElement>(
        `[data-junior-register-date="${attendance.referenceDate}"]`,
      )
      if (container && header) {
        container.scrollTo({ left: Math.max(0, header.offsetLeft - 170), behavior: "auto" })
      }
      setScrollToToday(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeYear, attendance.referenceDate, currentYear, isOpen, scrollToToday])

  function jumpToToday() {
    if (activeYear !== currentYear) setActiveYear(currentYear)
    setScrollToToday(true)
  }

  return (
    <section id="coach-attendance" className="dashboard-section page-shell junior-coach-attendance-section">
      <Reveal
        className={`attendance-card dashboard-card player-attendance-card junior-coach-attendance-card${isOpen ? " is-open" : ""}`}
      >
        <div className="attendance-card-header">
          <div className="card-icon">
            {attendance.summary.recorded ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
          </div>
          <h2 className="card-label">Attendance · {attendance.monthLabel}</h2>
        </div>

        {attendance.summary.percentage !== null ? (
          <>
            <strong className="attendance-value">{attendance.summary.percentage}%</strong>
            <p className="attendance-summary-copy">
              {attendance.summary.present} of {attendance.summary.recorded} recorded days attended.
            </p>
            <div
              className="attendance-track"
              role="progressbar"
              aria-label={`${attendance.summary.percentage}% attendance in ${attendance.monthLabel}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={attendance.summary.percentage}
            >
              <span style={{ width: `${attendance.summary.percentage}%` }} />
            </div>
          </>
        ) : (
          <>
            <h3 className="empty-card-title">No attendance recorded yet</h3>
            <p className="empty-card-copy">
              Your record will appear after the head coach saves an attendance day.
            </p>
          </>
        )}

        <button
          className="player-attendance-toggle"
          type="button"
          aria-expanded={isOpen}
          aria-controls="junior-coach-attendance-register"
          onClick={() => setIsOpen((open) => {
            if (!open && activeYear === currentYear) setScrollToToday(true)
            return !open
          })}
        >
          <span>{isOpen ? "Close attendance record" : "View attendance record"}</span>
          <ChevronDown aria-hidden="true" />
        </button>

        {isOpen ? (
          <div className="player-attendance-register" id="junior-coach-attendance-register">
            <div className="player-attendance-register-heading">
              <div>
                <span>Your record</span>
                <h3>Annual attendance</h3>
              </div>
              <div className="player-attendance-register-actions">
                <div className="player-attendance-year-selector" role="group" aria-label="Choose attendance year">
                  <span>Year</span>
                  {attendance.years.map((year) => (
                    <button
                      key={year}
                      type="button"
                      className={year === activeYear ? "is-active" : undefined}
                      aria-pressed={year === activeYear}
                      onClick={() => setActiveYear(year)}
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

            <div className="player-attendance-legend" role="group" aria-label="Attendance status legend">
              <span><i className="is-present" aria-hidden="true" />Present</span>
              <span><i className="is-absent" aria-hidden="true" />Absent</span>
              <span><i className="is-unmarked" aria-hidden="true" />Not recorded</span>
              <span><i className="is-unavailable" aria-hidden="true" />Not available</span>
            </div>

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
                    <th className="player-attendance-session-column" scope="col" rowSpan={2}>Record</th>
                    {monthGroups.map((month) => (
                      <th key={month.label} scope="colgroup" colSpan={month.count}><span>{month.label}</span></th>
                    ))}
                  </tr>
                  <tr className="player-attendance-date-row">
                    {dates.map((date) => {
                      const unavailable = date.key < attendance.joinedOn || date.key > attendance.referenceDate
                      return (
                        <th
                          key={date.key}
                          scope="col"
                          data-junior-register-date={date.key}
                          className={[
                            date.key === attendance.referenceDate ? "is-today" : "",
                            unavailable ? "is-unavailable" : "",
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
                  <tr>
                    <th className="player-attendance-session-column" scope="row">
                      <strong>Attendance</strong>
                      <small>Recorded days only</small>
                    </th>
                    {dates.map((date) => {
                      const unavailable = date.key < attendance.joinedOn || date.key > attendance.referenceDate
                      const choice = choices.get(date.key)
                      const state = unavailable ? "not available" : choice ?? "not recorded"
                      return (
                        <td
                          key={date.key}
                          className={date.key === attendance.referenceDate ? "is-today" : undefined}
                          aria-label={`${date.label}: ${state}`}
                          title={`${date.label}: ${state}`}
                        >
                          <span
                            className={[
                              "player-attendance-cell",
                              unavailable ? "is-unavailable" : choice ? `is-${choice}` : "is-unmarked",
                            ].join(" ")}
                            aria-hidden="true"
                          />
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Reveal>
    </section>
  )
}
