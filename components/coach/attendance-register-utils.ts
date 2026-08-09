import { formatDateKey } from "@/lib/format"

export type AttendanceRegisterDate = {
  date: string
  day: string
  key: string
  label: string
  month: string
}

export function buildAttendanceRegisterDates(year: number) {
  const dates: AttendanceRegisterDate[] = []

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

export function groupAttendanceDatesByMonth(dates: AttendanceRegisterDate[]) {
  return dates.reduce<Array<{ count: number; label: string }>>((groups, date) => {
    const last = groups[groups.length - 1]
    if (last?.label === date.month) last.count += 1
    else groups.push({ label: date.month, count: 1 })
    return groups
  }, [])
}
