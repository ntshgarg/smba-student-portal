"use client"

import { CalendarOff, ChevronDown, CircleAlert, RefreshCw, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef } from "react"
import type { ReactNode } from "react"

import {
  ATTENDANCE_REGISTER_LOW_PERCENT,
  formatAttendanceRegisterMonth,
} from "@/components/coach/attendance-register-utils"
import {
  attendanceRegisterMonthParam,
  shiftAttendanceRegisterMonth,
} from "@/lib/attendance/register-workspace"

import styles from "./attendance-register.module.css"

export { styles as registerStyles }

const REGISTER_PATHS = {
  players: "/coach/attendance/players/register",
  staff: "/coach/attendance/staff/register",
} as const

/** The current address with some query values changed (null removes one). */
export function useRegisterHref() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return useCallback((changes: Record<string, string | null>, path = pathname) => {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(changes).forEach(([key, value]) => (
      value === null ? next.delete(key) : next.set(key, value)
    ))
    const query = next.toString()
    return query ? `${path}?${query}` : path
  }, [pathname, searchParams])
}

export function RegisterToolbar({
  children,
  onJumpToToday,
  people,
}: {
  children: ReactNode
  onJumpToToday: () => void
  people: keyof typeof REGISTER_PATHS
}) {
  const hrefFor = useRegisterHref()
  return (
    <div className={styles.toolbar}>
      <nav className={styles.switch} aria-label="Register">
        {(["players", "staff"] as const).map((item) => (
          <Link
            key={item}
            aria-current={item === people ? "page" : undefined}
            href={hrefFor({}, REGISTER_PATHS[item])}
          >
            {item === "players" ? "Players" : "Staff"}
          </Link>
        ))}
      </nav>
      {children}
      <button className={styles.today} type="button" onClick={onJumpToToday}>
        Jump to today
      </button>
    </div>
  )
}

export function RegisterFilterPill({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: readonly (string | number)[]
  value: string | number
}) {
  return (
    <label className={styles.pill}>
      <span>{label}</span>
      <select aria-label={label} name={label.toLowerCase()} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  )
}

function monthHref(
  hrefFor: ReturnType<typeof useRegisterHref>,
  { month, year }: { month: number; year: number },
) {
  return hrefFor({ month: attendanceRegisterMonthParam(month), year: String(year) })
}

export function RegisterMonthBar({ month, year }: { month: number; year: number }) {
  const hrefFor = useRegisterHref()
  const barRef = useRef<HTMLElement>(null)
  // On a phone the bar scrolls sideways: keep the chosen month in view
  // without moving the page itself.
  useEffect(() => {
    const bar = barRef.current
    const active = bar?.querySelector<HTMLElement>("[aria-current]")
    if (!bar || !active || bar.scrollWidth <= bar.clientWidth) return
    bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2
  }, [month, year])
  return (
    <nav className={styles.months} aria-label="Choose month" ref={barRef}>
      {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
        <Link
          key={item}
          aria-current={item === month ? "page" : undefined}
          aria-label={formatAttendanceRegisterMonth(year, item, "long")}
          href={monthHref(hrefFor, { month: item, year })}
          replace
          scroll={false}
        >
          {formatAttendanceRegisterMonth(year, item, "short")}
        </Link>
      ))}
    </nav>
  )
}

export function RegisterBand({
  heading,
  month,
  subtitle,
  year,
  yearOptions,
}: {
  heading: ReactNode
  month: number
  subtitle: string
  year: number
  yearOptions: readonly number[]
}) {
  const hrefFor = useRegisterHref()
  const previous = shiftAttendanceRegisterMonth({ month, year }, -1, yearOptions)
  const next = shiftAttendanceRegisterMonth({ month, year }, 1, yearOptions)
  return (
    <div className={styles.band}>
      <div>
        {heading}
        <p>{subtitle}</p>
      </div>
      <nav className={styles.step} aria-label="Previous and next month">
        {previous ? (
          <Link href={monthHref(hrefFor, previous)} replace scroll={false}>
            ‹ {formatAttendanceRegisterMonth(previous.year, previous.month, "long")}
          </Link>
        ) : null}
        {next ? (
          <Link href={monthHref(hrefFor, next)} replace scroll={false}>
            {formatAttendanceRegisterMonth(next.year, next.month, "long")} ›
          </Link>
        ) : null}
      </nav>
    </div>
  )
}

const LEGEND_LABELS = {
  present: "Present",
  absent: "Absent",
  makeup: "Made up",
  holiday: "Holiday",
  unmarked: "Not recorded",
  upcoming: "Upcoming",
  review: "Needs review",
} as const

export function RegisterLegend({ items }: { items: Array<keyof typeof LEGEND_LABELS> }) {
  return (
    <div className={styles.legend} role="group" aria-label="Attendance status legend">
      {items.map((item) => (
        <span key={item}>
          <i className={`${styles.tile} ${styles[item]}`} aria-hidden="true">
            <TileMark kind={item} />
          </i>
          {LEGEND_LABELS[item]}
        </span>
      ))}
    </div>
  )
}

/**
 * Colour is never the only cue (WCAG 1.4.1): absent and made-up tiles carry a
 * corner ✕ / ↻, a holiday its calendar mark, needs-review its alert, and "not
 * recorded" is hatched rather than tinted.
 */
export function TileMark({ kind }: { kind: string }) {
  if (kind === "absent") return <X aria-hidden="true" className={styles.corner} />
  if (kind === "makeup") return <RefreshCw aria-hidden="true" className={styles.corner} />
  if (kind === "review") return <CircleAlert aria-hidden="true" className={styles.flag} />
  if (kind === "holiday") return <CalendarOff aria-hidden="true" />
  return null
}

export function RegisterPercent({ value }: { value: number | null }) {
  if (value === null) return null
  return (
    <span className={`${styles.percent}${value < ATTENDANCE_REGISTER_LOW_PERCENT ? ` ${styles.low}` : ""}`}>
      {value}%
    </span>
  )
}

/** Brings today's column into view inside the sideways-scrolling grid (phones). */
export function scrollRegisterToday(grid: HTMLElement | null) {
  grid?.querySelector<HTMLElement>("[data-register-today]")
    ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
}
