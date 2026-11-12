import { buildPlayerAttendanceCalendarDates } from "@/components/dashboard/player-attendance-calendar"
import { formatDateKey } from "@/lib/format"

export type JuniorCoachAttendanceCalendarState =
  | "present"
  | "absent"
  | "unmarked"
  | "unavailable"
  | "closed"

type JuniorCoachAttendanceCalendarSource = {
  holidays?: Array<{ dateKey: string; label: string }>
  joinedOn: string
  records: Array<{
    choice: "present" | "absent" | "cleared"
    dateKey: string
  }>
  referenceDate: string
  years: number[]
}

export type JuniorCoachAttendanceCalendarDay = {
  dayNumber: string
  inSelectedMonth: boolean
  isToday: boolean
  key: string
  label: string
  monthShort: string
  state: JuniorCoachAttendanceCalendarState
  stateLabel: string
}

const stateLabels: Record<JuniorCoachAttendanceCalendarState, string> = {
  present: "present",
  absent: "absent",
  unmarked: "not recorded",
  unavailable: "not available",
  closed: "academy closed",
}

export function buildJuniorCoachAttendanceCalendar(
  attendance: JuniorCoachAttendanceCalendarSource,
  activeYear: number,
  activeMonth: number,
) {
  const selectedMonth = `${activeYear}-${String(activeMonth).padStart(2, "0")}`
  const loadedYears = new Set(attendance.years)
  const choices = new Map<string, "present" | "absent">()
  attendance.records.forEach((record) => {
    if (record.choice !== "cleared") choices.set(record.dateKey, record.choice)
  })
  const dateKeys = buildPlayerAttendanceCalendarDates(activeYear, activeMonth)
  const holidayByDate = new Map((attendance.holidays ?? []).map(
    (holiday) => [holiday.dateKey, holiday.label],
  ))

  const days: JuniorCoachAttendanceCalendarDay[] = dateKeys.map((key) => {
    const keyYear = Number(key.slice(0, 4))
    const available = loadedYears.has(keyYear)
      && key >= attendance.joinedOn
      && key <= attendance.referenceDate
    // A closed day is closed, not "not recorded", and it leaves the count; a
    // mark saved before the closure is kept but not shown.
    const holiday = available ? holidayByDate.get(key) : undefined
    const state: JuniorCoachAttendanceCalendarState = !available
      ? "unavailable"
      : holiday ? "closed" : choices.get(key) ?? "unmarked"

    return {
      key,
      label: formatDateKey(key, { year: "numeric" }),
      dayNumber: String(Number(key.slice(8, 10))),
      monthShort: formatDateKey(key, {
        day: undefined,
        month: "short",
        weekday: undefined,
      }),
      inSelectedMonth: key.startsWith(selectedMonth),
      isToday: key === attendance.referenceDate,
      state,
      stateLabel: holiday ? `academy closed for ${holiday}` : stateLabels[state],
    }
  })

  return {
    days,
    firstCalendarDate: dateKeys[0],
    lastCalendarDate: dateKeys[dateKeys.length - 1],
  }
}
