"use client"

import { ArrowLeft, Check, CircleMinus, X } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import type { CSSProperties } from "react"

import {
  buildAttendanceRegisterDates,
  groupAttendanceDatesByMonth,
} from "@/components/coach/attendance-register-utils"
import { useAttendanceRegisterWindow } from "@/components/coach/use-attendance-register-window"

type StaffRow = {
  accountId: string
  archivedOn: string | null
  fullName: string
  joinedOn: string
}

type StaffRecord = {
  choice: "present" | "absent" | "cleared"
  coachAccountId: string
  dateKey: string
}

function cellKey(coachAccountId: string, dateKey: string) {
  return `${coachAccountId}:${dateKey}`
}

export function StaffAttendanceRegister({
  initialRecords,
  juniorCoaches,
  referenceDate,
  yearOptions,
}: {
  initialRecords: StaffRecord[]
  juniorCoaches: StaffRow[]
  referenceDate: string
  yearOptions: number[]
}) {
  const currentYear = Number(referenceDate.slice(0, 4))
  const [activeYear, setActiveYear] = useState(currentYear)
  const dates = useMemo(() => buildAttendanceRegisterDates(activeYear), [activeYear])
  const todayIndex = dates.findIndex((date) => date.key === referenceDate)
  const {
    containerRef: registerScrollRef,
    onScroll: handleRegisterScroll,
    scrollToIndex,
    visibleWindow,
  } = useAttendanceRegisterWindow({
    dateCount: dates.length,
    initialIndex: 0,
    resetKey: String(activeYear),
    scrollOnReset: false,
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
  const storedByCell = useMemo(() => new Map(
    initialRecords.map((record) => [cellKey(record.coachAccountId, record.dateKey), record.choice]),
  ), [initialRecords])
  const tableStyle = {
    "--staff-register-width": `${240 + dates.length * 54}px`,
    "--register-mobile-width": `${148 + dates.length * 54}px`,
  } as CSSProperties

  function resolvedChoice(coachAccountId: string, dateKey: string) {
    return storedByCell.get(cellKey(coachAccountId, dateKey))
  }

  function changeYear(year: number) {
    if (year === activeYear) return
    setActiveYear(year)
  }

  function jumpToToday() {
    if (activeYear !== currentYear) {
      changeYear(currentYear)
      return
    }
    if (todayIndex >= 0) scrollToIndex(todayIndex, "smooth")
  }

  return (
    <div className="coach-calendar coach-attendance-workspace page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Staff attendance navigation">
        <Link href="/coach#attendance"><ArrowLeft aria-hidden="true" /> Back to Attendance</Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Attendance register</span>
          <h1 id="staff-attendance-title">Staff attendance</h1>
        </div>
      </header>

      <article className="coach-attendance-card is-workspace">
        <div className="coach-attendance-register staff-attendance-register">
          <div className="coach-register-controls">
            <div className="coach-year-selector" role="group" aria-label="Choose attendance year">
              {yearOptions.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={year === activeYear ? "is-active" : undefined}
                  aria-pressed={year === activeYear}
                  onClick={() => changeYear(year)}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>

          <div className="coach-register-heading staff-attendance-heading">
            <div>
              <span>Staff</span>
              <h2>Daily record</h2>
            </div>
            <div className="coach-register-period">
              <span>Annual register</span>
              <button type="button" onClick={jumpToToday}>Jump to today</button>
            </div>
          </div>

          <div className="player-attendance-legend staff-attendance-legend" role="group" aria-label="Attendance status legend">
            <span><i className="is-present" aria-hidden="true"><Check /></i>Present</span>
            <span><i className="is-absent" aria-hidden="true"><CircleMinus /></i>Absent</span>
            <span><i className="is-unmarked" aria-hidden="true" />Not recorded</span>
            <span><i className="is-unavailable" aria-hidden="true" />Not available</span>
          </div>

          {!juniorCoaches.length ? (
            <div className="coach-register-empty-category">
              <h2>No assistant coaches yet.</h2>
              <p>Provisioned assistant coaches will appear here for daily attendance.</p>
            </div>
          ) : (
            <div
              className="coach-register-scroll staff-register-scroll"
              ref={registerScrollRef}
              onScroll={handleRegisterScroll}
              tabIndex={0}
              role="region"
              aria-label={`Scrollable assistant coach attendance register for ${activeYear}`}
            >
              <table
                className="coach-register-table staff-register-table"
                style={tableStyle}
                aria-label={`Assistant coach attendance register for ${activeYear}`}
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
                    <th className="coach-register-name-column" scope="col" rowSpan={2} aria-colindex={1}>Coach name</th>
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
                    {visibleDates.map((date, visibleIndex) => (
                      <th
                        key={date.key}
                        scope="col"
                        data-staff-register-date={date.key}
                        aria-colindex={visibleWindow.start + visibleIndex + 2}
                        className={[
                          date.key === referenceDate ? "is-today" : "",
                          date.key > referenceDate ? "is-unavailable" : "",
                        ].filter(Boolean).join(" ") || undefined}
                      >
                        <span>{date.day}</span>
                        <strong>{date.date}</strong>
                      </th>
                    ))}
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
                  {juniorCoaches.map((coach) => (
                    <tr key={coach.accountId}>
                      <th className="coach-register-name-column" scope="row" aria-colindex={1}>
                        <strong>{coach.fullName}</strong>
                        <small>Assistant coach</small>
                      </th>
                      {leadingDateCount ? (
                        <td
                          className="coach-register-spacer-cell"
                          colSpan={leadingDateCount}
                          aria-hidden="true"
                        />
                      ) : null}
                      {visibleDates.map((date, visibleIndex) => {
                        const unavailable = date.key < coach.joinedOn
                          || date.key > referenceDate
                          || Boolean(coach.archivedOn && date.key > coach.archivedOn)
                        const choice = resolvedChoice(coach.accountId, date.key)
                        const state = unavailable ? "not available" : choice === "cleared" || !choice ? "not recorded" : choice
                        return (
                          <td
                            key={date.key}
                            aria-colindex={visibleWindow.start + visibleIndex + 2}
                            className={[
                              date.key === referenceDate ? "is-today" : "",
                              unavailable ? "is-unavailable" : "",
                            ].filter(Boolean).join(" ") || undefined}
                          >
                            <span
                              className={`coach-register-cell-status${choice && choice !== "cleared" ? ` is-${choice}` : ""}`}
                              role="img"
                              aria-label={`${coach.fullName}, ${date.label}: ${state}.`}
                              title={`${date.label}: ${state}`}
                            >
                              {/* Same pairing as the player register: --green and --red measure
                                  1.047:1 against each other, and X is already "not available". */}
                              {unavailable ? <X aria-hidden="true" /> : choice === "present" ? <Check aria-hidden="true" /> : choice === "absent" ? <CircleMinus aria-hidden="true" /> : <span aria-hidden="true">—</span>}
                            </span>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </article>
    </div>
  )
}
