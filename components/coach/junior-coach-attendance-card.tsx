"use client"

import { ArrowUpRight, ChevronUp } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

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
                ? "Review your read-only annual attendance register whenever you need it."
                : "Your record will appear after the head coach saves an attendance day."}
            </p>
            <button
              className={styles.ledgerActionButton}
              type="button"
              aria-expanded={isOpen}
              aria-controls="junior-coach-attendance-register"
              onClick={() => setIsOpen((open) => {
                if (!open && activeYear === currentYear) setScrollToToday(true)
                return !open
              })}
            >
              <span>{isOpen ? "Close attendance record" : "Open attendance record"}</span>
              {isOpen ? <ChevronUp aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
            </button>
          </div>
        </div>

        {isOpen ? (
          <div
            className={`player-attendance-register ${styles.attendanceRegister}`}
            id="junior-coach-attendance-register"
          >
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
