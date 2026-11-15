"use client"

import { useRouter } from "next/navigation"
import { useMemo, useRef } from "react"
import type { CSSProperties } from "react"

import {
  RegisterBand,
  RegisterFilterPill,
  RegisterLegend,
  RegisterMonthBar,
  RegisterPercent,
  RegisterToolbar,
  TileMark,
  registerStyles as styles,
  scrollRegisterToday,
  useRegisterHref,
  useScrollRegisterTodayOnOpen,
} from "@/components/coach/attendance-register-chrome"
import {
  attendanceRegisterPercent,
  buildAttendanceRegisterMonthDates,
  formatAttendanceRegisterMonth,
} from "@/components/coach/attendance-register-utils"
import { attendanceRegisterMonthParam } from "@/lib/attendance/register-workspace"

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
  holidays,
  initialRecords,
  juniorCoaches,
  month: activeMonth,
  referenceDate,
  year: activeYear,
  yearOptions,
}: {
  /** Days the academy was closed: nobody is marked on them. */
  holidays: Array<{ dateKey: string; label: string }>
  initialRecords: StaffRecord[]
  juniorCoaches: StaffRow[]
  /** 1-12: one month of `year` at a time. */
  month: number
  referenceDate: string
  year: number
  yearOptions: number[]
}) {
  const router = useRouter()
  const hrefFor = useRegisterHref()
  const gridRef = useRef<HTMLDivElement>(null)
  const currentYear = Number(referenceDate.slice(0, 4))
  const currentMonth = Number(referenceDate.slice(5, 7))
  const dates = useMemo(
    () => buildAttendanceRegisterMonthDates(activeYear, activeMonth),
    [activeMonth, activeYear],
  )
  const monthLabel = formatAttendanceRegisterMonth(activeYear, activeMonth, "long")
  const storedByCell = useMemo(() => new Map(
    initialRecords.map((record) => [cellKey(record.coachAccountId, record.dateKey), record.choice]),
  ), [initialRecords])
  const holidayByDate = useMemo(
    () => new Map(holidays.map((holiday) => [holiday.dateKey, holiday.label])),
    [holidays],
  )
  const tableStyle = { "--register-columns": dates.length } as CSSProperties

  const rows = juniorCoaches.map((coach) => {
    const cells = dates.map((date) => {
      const unavailable = date.key < coach.joinedOn
        || date.key > referenceDate
        || Boolean(coach.archivedOn && date.key > coach.archivedOn)
      const stored = storedByCell.get(cellKey(coach.accountId, date.key))
      const choice = stored === "cleared" ? undefined : stored
      // A closed day reads as closed, never as "not recorded": there was
      // nothing to record. A mark saved before the closure is kept but not
      // counted, so it is not shown either.
      const holiday = unavailable ? undefined : holidayByDate.get(date.key)
      const state = unavailable
        ? "not available"
        : holiday
          ? `academy closed for ${holiday}`
          : choice ?? "not recorded"
      return { choice, date, holiday, state, unavailable }
    })
    // Staff have no make-ups, so their % stays present ÷ (present + absent);
    // players' % comes from `calculateMonthlyAttendance` instead.
    const marked = cells.filter((cell) => !cell.unavailable && !cell.holiday && cell.choice)
    return {
      cells,
      coach,
      percent: attendanceRegisterPercent(
        marked.filter((cell) => cell.choice === "present").length,
        marked.length,
      ),
    }
  })

  const showsToday = activeYear === currentYear && activeMonth === currentMonth
  useScrollRegisterTodayOnOpen(gridRef, showsToday)

  function jumpToToday() {
    if (!showsToday) {
      router.replace(
        hrefFor({ month: attendanceRegisterMonthParam(currentMonth), year: String(currentYear) }),
        { scroll: false },
      )
      return
    }
    scrollRegisterToday(gridRef.current)
  }

  return (
    <div className={styles.register}>
      <RegisterToolbar people="staff" onJumpToToday={jumpToToday}>
        <RegisterFilterPill
          label="Year"
          options={yearOptions}
          value={activeYear}
          onChange={(year) => router.replace(hrefFor({ month: null, year }), { scroll: false })}
        />
      </RegisterToolbar>

      <RegisterMonthBar month={activeMonth} year={activeYear} />

      <div className={styles.card}>
        <RegisterBand
          heading={<h2>Assistant coaches</h2>}
          month={activeMonth}
          subtitle={`${monthLabel} · daily record`}
          year={activeYear}
          yearOptions={yearOptions}
        />

        {!juniorCoaches.length ? (
          <div className={styles.empty}>
            <h3>No assistant coaches yet.</h3>
            <p>Provisioned assistant coaches will appear here for daily attendance.</p>
          </div>
        ) : (
          <>
            <RegisterLegend items={["present", "absent", "holiday", "unmarked"]} />
            <div
              className={styles.grid}
              ref={gridRef}
              tabIndex={0}
              role="region"
              aria-label={`Assistant coach attendance, ${monthLabel}`}
            >
              <table
                className={styles.table}
                style={tableStyle}
                aria-label={`Assistant coach attendance register for ${monthLabel}`}
              >
                <thead>
                  <tr>
                    <th className={styles.name} scope="col">Coach</th>
                    {dates.map((date) => {
                      const holiday = holidayByDate.get(date.key)
                      return (
                        <th
                          key={date.key}
                          scope="col"
                          data-staff-register-date={date.key}
                          data-register-today={date.key === referenceDate || undefined}
                          data-unavailable={date.key > referenceDate || holiday ? true : undefined}
                          title={holiday ? `${date.label}: closed for ${holiday}` : undefined}
                        >
                          <span>{date.day}</span>
                          <strong>{date.date}</strong>
                          {holiday ? <span className="sr-only">Closed for {holiday}</span> : null}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ cells, coach, percent }) => (
                    <tr key={coach.accountId}>
                      <th
                        className={styles.name}
                        scope="row"
                        aria-label={`${coach.fullName}, assistant coach${percent === null ? "" : `, ${percent}% attended in ${monthLabel}`}`}
                      >
                        <span className={styles.who}>
                          <strong>{coach.fullName}</strong>
                          <RegisterPercent value={percent} />
                        </span>
                        <small>Assistant coach</small>
                      </th>
                      {cells.map((cell) => (
                        <td key={cell.date.key}>
                          <span
                            className={`${styles.tile} ${styles[
                              cell.unavailable ? "none" : cell.holiday ? "holiday" : cell.choice ?? "unmarked"
                            ]}`}
                            role="img"
                            aria-label={`${coach.fullName}, ${cell.date.label}: ${cell.state}.`}
                            title={`${cell.date.label}: ${cell.state}`}
                          >
                            <TileMark kind={cell.unavailable ? "none" : cell.holiday ? "holiday" : cell.choice ?? "none"} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
