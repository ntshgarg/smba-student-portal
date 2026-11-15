import { formatDateKey } from "@/lib/format"

export type AttendanceRegisterDate = {
  /** Day of the month, "13". */
  date: string
  /** Short weekday, "Mon". */
  day: string
  key: string
  /** Full date for accessible names, "Monday, 13 July 2026". */
  label: string
  weekday: number
}

export function buildAttendanceRegisterMonthDates(year: number, month: number) {
  const dates: AttendanceRegisterDate[] = []

  for (
    const date = new Date(Date.UTC(year, month - 1, 1));
    date.getUTCMonth() === month - 1;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const key = date.toISOString().slice(0, 10)
    dates.push({
      key,
      day: formatDateKey(key, { day: undefined, month: undefined, weekday: "short" }),
      date: String(date.getUTCDate()),
      label: formatDateKey(key, { year: "numeric" }),
      weekday: date.getUTCDay(),
    })
  }

  return dates
}

export function formatAttendanceRegisterMonth(year: number, month: number, style: "long" | "short") {
  const key = `${year}-${String(month).padStart(2, "0")}-01`
  return formatDateKey(key, {
    day: undefined,
    month: style,
    weekday: undefined,
    year: style === "long" ? "numeric" : undefined,
  })
}

/** Present over marked (present + absent), rounded; null when nothing is marked. */
export function attendanceRegisterPercent(present: number, marked: number) {
  return marked ? Math.round((present / marked) * 100) : null
}

export const ATTENDANCE_REGISTER_LOW_PERCENT = 80
