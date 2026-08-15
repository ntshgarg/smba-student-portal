import { formatDateKey, formatSessionTimeRange } from "@/lib/format"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import type { PlayerAttendanceRecord } from "@/lib/types"

const weekdayShortLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const playerAttendanceMonthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export const playerAttendanceWeekdayLabels = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]

export type PlayerAttendanceCalendarSessionState =
  | "present"
  | "absent"
  | "pending"
  | "future"
  | "rescheduled"

export type PlayerAttendanceCalendarSession = {
  assignmentId: string
  occurrenceId: string
  sessionLabel: string
  timeLabel: string
  state: PlayerAttendanceCalendarSessionState
  stateLabel: string
}

export type PlayerAttendanceCalendarDay = {
  key: string
  label: string
  dayNumber: string
  monthShort: string
  inSelectedMonth: boolean
  inLoadedYear: boolean
  isToday: boolean
  sessions: PlayerAttendanceCalendarSession[]
  completionCount: number
}

export type PlayerAttendanceCalendarSchedule = {
  id: string
  groupLabel: string
  timeLabel: string
  assignedDays: string
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function monthStart(year: number, month: number) {
  return dateKey(new Date(Date.UTC(year, month - 1, 1)))
}

function nextMonthStart(year: number, month: number) {
  return dateKey(new Date(Date.UTC(year, month, 1)))
}

export function buildPlayerAttendanceCalendarDates(
  year: number,
  month: number,
) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const mondayFirstOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(first)
  start.setUTCDate(start.getUTCDate() - mondayFirstOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return dateKey(date)
  })
}

function scheduledOccurrenceForDate({
  assignment,
  date,
  occurrences,
  record,
}: {
  assignment: PlayerAttendanceRecord["assignments"][number]
  date: string
  occurrences: PlayerAttendanceRecord["occurrences"]
  record: PlayerAttendanceRecord
}) {
  return occurrences
    .filter((occurrence) => (
      occurrence.occurrenceDate === date
      && occurrence.status === "scheduled"
      && playerWasEnrolledForOccurrence(record.joinedOn, occurrence)
      && assignmentCoversOccurrence(assignment, occurrence)
    ))
    .sort((first, second) => first.startsAt.localeCompare(second.startsAt))[0]
}

export function buildPlayerAttendanceCalendar(
  record: PlayerAttendanceRecord,
  activeYear: number,
  activeMonth: number,
) {
  const selectedMonthStart = monthStart(activeYear, activeMonth)
  const selectedNextMonthStart = nextMonthStart(activeYear, activeMonth)
  const calendarDateKeys = buildPlayerAttendanceCalendarDates(activeYear, activeMonth)
  const firstCalendarDate = calendarDateKeys[0]
  const lastCalendarDate = calendarDateKeys[calendarDateKeys.length - 1]
  const loadedYears = new Set(record.years)
  const sessionsById = new Map(record.sessions.map((session) => [session.id, session]))
  const occurrencesBySeries = record.occurrences.reduce<Map<string, PlayerAttendanceRecord["occurrences"]>>(
    (map, occurrence) => {
      const current = map.get(occurrence.seriesId) ?? []
      current.push(occurrence)
      map.set(occurrence.seriesId, current)
      return map
    },
    new Map(),
  )
  const choiceByOccurrence = new Map(
    record.records.map((attendanceRecord) => [
      attendanceRecord.occurrenceId,
      attendanceRecord.choice,
    ]),
  )
  const adjustmentByOccurrence = new Map(
    record.adjustments.map((adjustment) => [
      adjustment.sourceOccurrenceId,
      adjustment,
    ]),
  )
  const completionsByDate = record.adjustments.reduce<Map<string, number>>((map, adjustment) => {
    map.set(adjustment.completedOn, (map.get(adjustment.completedOn) ?? 0) + 1)
    return map
  }, new Map())

  const assignmentSessions = record.assignments.flatMap((assignment) => {
    const session = sessionsById.get(assignment.seriesId)
    return session ? [{ assignment, session }] : []
  }).sort((first, second) => (
    first.session.startTime.localeCompare(second.session.startTime)
    || first.assignment.id.localeCompare(second.assignment.id)
  ))

  const schedules = assignmentSessions.flatMap(({ assignment, session }) => {
    const overlapsSelectedMonth = assignment.effectiveFrom < selectedNextMonthStart
      && (!assignment.effectiveTo || assignment.effectiveTo > selectedMonthStart)
    const coversReplacementInSelectedMonth = (
      occurrencesBySeries.get(session.id) ?? []
    ).some((occurrence) => (
      occurrence.status === "scheduled"
      && occurrence.occurrenceDate >= selectedMonthStart
      && occurrence.occurrenceDate < selectedNextMonthStart
      && assignmentCoversOccurrence(assignment, occurrence)
    ))

    if (!overlapsSelectedMonth && !coversReplacementInSelectedMonth) return []

    return [{
      id: assignment.id,
      groupLabel: session.programme + " · " + session.batch,
      timeLabel: formatSessionTimeRange(session),
      assignedDays: assignment.weekdays
        .map((weekday) => weekdayShortLabels[weekday])
        .join(", "),
    }]
  })

  const days: PlayerAttendanceCalendarDay[] = calendarDateKeys.map((key) => {
    const sessions = assignmentSessions.flatMap(({ assignment, session }) => {
      const occurrence = scheduledOccurrenceForDate({
        assignment,
        date: key,
        occurrences: occurrencesBySeries.get(session.id) ?? [],
        record,
      })
      if (!occurrence) return []

      const adjustment = adjustmentByOccurrence.get(occurrence.id)
      const choice = choiceByOccurrence.get(occurrence.id)
      const state: PlayerAttendanceCalendarSessionState = adjustment
        ? "rescheduled"
        : occurrenceIsUpcoming(occurrence, record.referenceInstant)
          ? "future"
          : choice ?? "pending"
      const stateLabel = state === "rescheduled"
        ? "rescheduled attendance recorded"
        : state === "future"
          ? "future session"
          : state
      const timeLabel = formatSessionTimeRange(session)
      const groupLabel = session.programme + " · " + session.batch

      return [{
        assignmentId: assignment.id,
        occurrenceId: occurrence.id,
        sessionLabel: timeLabel ? groupLabel + " · " + timeLabel : groupLabel,
        timeLabel,
        state,
        stateLabel,
      }]
    })

    const keyYear = Number(key.slice(0, 4))
    return {
      key,
      label: formatDateKey(key, { year: "numeric" }),
      dayNumber: String(Number(key.slice(8, 10))),
      monthShort: formatDateKey(key, {
        day: undefined,
        month: "short",
        weekday: undefined,
      }),
      inSelectedMonth: key >= selectedMonthStart && key < selectedNextMonthStart,
      inLoadedYear: loadedYears.has(keyYear),
      isToday: key === record.referenceDate,
      sessions,
      completionCount: completionsByDate.get(key) ?? 0,
    }
  })

  return {
    days,
    schedules,
    firstCalendarDate,
    lastCalendarDate,
    selectedMonthStart,
    selectedNextMonthStart,
  }
}
