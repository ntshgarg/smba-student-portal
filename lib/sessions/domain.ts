import {
  isValidDateKey,
  isValidMonthKey,
  weekdayForDateKey,
} from "@/lib/date-keys"
import { operationalActionError } from "@/lib/actions/operational-result"
import type {
  CreateSessionSeriesInput,
  SessionAssignment,
  SessionRecurrenceSlot,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"
import { occurrenceHasStarted, type ReferenceInstant } from "@/lib/sessions/occurrence-time"

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const TRAINING_PROGRAMMES = new Set(["Beginner", "Intermediate", "Advanced", "Adult"])
const TRAINING_BATCHES = new Set(["Weekday", "Weekend"])
const WEEKDAY_DAYS = new Set([1, 2, 3, 4, 5])
const WEEKEND_DAYS = new Set([0, 6])
export const MAX_SCHEDULE_TERM_DAYS = 366

export type CalendarDateWindow = {
  from: string
  to: string
}

export type InclusiveDateRange = {
  startsOn: string
  endsOn: string | null
}

/**
 * Date ranges overlap when they share at least one academy date.
 * A null end date is unbounded, so a shared boundary date overlaps while
 * a range beginning on the following date does not.
 */
export function dateRangesOverlapInclusive(
  left: InclusiveDateRange,
  right: InclusiveDateRange,
) {
  return (!right.endsOn || left.startsOn <= right.endsOn)
    && (!left.endsOn || right.startsOn <= left.endsOn)
}

function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number)
  return hours * 60 + minutes
}

function inclusiveCalendarDayCount(from: string, to: string) {
  const first = new Date(`${from}T00:00:00.000Z`).getTime()
  const last = new Date(`${to}T00:00:00.000Z`).getTime()
  return Math.floor((last - first) / (24 * 60 * 60 * 1_000)) + 1
}

function twelveHourTime(totalMinutes: number) {
  const hours24 = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  const hours12 = hours24 % 12 || 12
  return {
    label: minutes ? `${hours12}:${String(minutes).padStart(2, "0")}` : String(hours12),
    period: hours24 < 12 ? "AM" : "PM",
  }
}

export function sessionDisplayName(input: Pick<
  CreateSessionSeriesInput,
  "batch" | "durationMinutes" | "programme" | "startTime"
>) {
  const startMinutes = minutesFromTime(input.startTime)
  const start = twelveHourTime(startMinutes)
  const end = twelveHourTime(startMinutes + input.durationMinutes)
  const range = start.period === end.period
    ? `${start.label}-${end.label}_${start.period}`
    : `${start.label}_${start.period}-${end.label}_${end.period}`
  return `${input.programme}_${input.batch}_${range}`
}

export function enumerateDateKeys(from: string, to: string) {
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) {
    throw new Error("Choose a valid session date range.")
  }
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  const last = new Date(`${to}T00:00:00.000Z`)
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function calendarWindowForMonth(month: string): CalendarDateWindow {
  if (!isValidMonthKey(month)) throw new Error("Choose a valid calendar month.")
  const [year, monthNumber] = month.split("-").map(Number)
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  }
}

export function indiaLocalDateTime(dateKey: string, time: string) {
  if (!isValidDateKey(dateKey) || !TIME_PATTERN.test(time)) {
    throw new Error("Invalid India session date or time.")
  }
  return new Date(`${dateKey}T${time}:00+05:30`)
}

export function validateSeriesInput(input: CreateSessionSeriesInput) {
  if (!TRAINING_PROGRAMMES.has(input.programme)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid training programme.",
      "programme",
    )
  }
  if (!TRAINING_BATCHES.has(input.batch)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid Weekday or Weekend batch.",
      "batch",
    )
  }
  if (input.venue.trim().length < 2 || input.venue.trim().length > 120) {
    operationalActionError("INVALID_INPUT", "Enter a valid venue or court.", "venue")
  }
  if (!isValidDateKey(input.startsOn)) {
    operationalActionError("INVALID_INPUT", "Choose a valid schedule start date.", "startsOn")
  }
  if (!isValidDateKey(input.endsOn)) {
    operationalActionError("INVALID_INPUT", "Choose a valid schedule end date.", "endsOn")
  }
  if (input.endsOn < input.startsOn) {
    operationalActionError(
      "INVALID_INPUT",
      "The schedule end date cannot precede its start date.",
      "endsOn",
    )
  }
  if (inclusiveCalendarDayCount(input.startsOn, input.endsOn) > MAX_SCHEDULE_TERM_DAYS) {
    operationalActionError(
      "INVALID_INPUT",
      `A recurring schedule can cover at most ${MAX_SCHEDULE_TERM_DAYS} days.`,
      "endsOn",
    )
  }
  if (!input.weekdays.length) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose at least one weekly training day.",
      "weekdays",
    )
  }
  if (!TIME_PATTERN.test(input.startTime)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid session start time.",
      "startTime",
    )
  }
  if (!Number.isInteger(input.durationMinutes)
    || input.durationMinutes < 30
    || input.durationMinutes > 300) {
    operationalActionError(
      "INVALID_INPUT",
      "Session duration must be between 30 and 300 minutes.",
      "durationMinutes",
    )
  }
  if (minutesFromTime(input.startTime) + input.durationMinutes >= 24 * 60) {
    operationalActionError(
      "INVALID_INPUT",
      "A recurring session cannot cross midnight.",
      "durationMinutes",
    )
  }
  const allowedDays = input.batch === "Weekday" ? WEEKDAY_DAYS : WEEKEND_DAYS
  const weekdays = new Set<number>()
  input.weekdays.forEach((weekday) => {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      operationalActionError("INVALID_INPUT", "Invalid training weekday.", "weekdays")
    }
    if (!allowedDays.has(weekday)) {
      operationalActionError(
        "INVALID_INPUT",
        `Choose only ${input.batch.toLowerCase()} training days.`,
        "weekdays",
      )
    }
    if (weekdays.has(weekday)) {
      operationalActionError(
        "INVALID_INPUT",
        "Choose each training day only once.",
        "weekdays",
      )
    }
    weekdays.add(weekday)
  })
}

export function sessionSlotsOverlap(
  first: Pick<TrainingSessionSeries, "slots">,
  second: Pick<TrainingSessionSeries, "slots">,
) {
  return first.slots.some((firstSlot) => second.slots.some((secondSlot) => {
    if (firstSlot.weekday !== secondSlot.weekday) return false
    const firstStart = minutesFromTime(firstSlot.startTime)
    const secondStart = minutesFromTime(secondSlot.startTime)
    return firstStart < secondStart + secondSlot.durationMinutes
      && secondStart < firstStart + firstSlot.durationMinutes
  }))
}

export function compareSessionSlots(first: SessionRecurrenceSlot, second: SessionRecurrenceSlot) {
  const weekdayOrder = (weekday: number) => weekday === 0 ? 7 : weekday
  return weekdayOrder(first.weekday) - weekdayOrder(second.weekday)
    || first.startTime.localeCompare(second.startTime)
    || first.durationMinutes - second.durationMinutes
    || first.id.localeCompare(second.id)
}

export function compareSessionSeries(first: TrainingSessionSeries, second: TrainingSessionSeries) {
  const firstSlot = [...first.slots].sort(compareSessionSlots)[0]
  const secondSlot = [...second.slots].sort(compareSessionSlots)[0]
  return compareSessionSlots(
    firstSlot ?? { id: first.id, weekday: 7, startTime: "", durationMinutes: 0 },
    secondSlot ?? { id: second.id, weekday: 7, startTime: "", durationMinutes: 0 },
  )
    || first.id.localeCompare(second.id)
}

export function distinctAssignmentWeekdays(weekdayGroups: number[][]) {
  return [...new Set(weekdayGroups.flat())].sort((first, second) => first - second)
}

export function buildOccurrenceDrafts({
  from,
  series,
  slots,
  to,
}: {
  from: string
  series: Pick<TrainingSessionSeries, "id" | "startsOn" | "endsOn" | "venue">
  slots: SessionRecurrenceSlot[]
  to: string
}) {
  const firstDate = from > series.startsOn ? from : series.startsOn
  const lastDate = series.endsOn && series.endsOn < to ? series.endsOn : to
  if (firstDate > lastDate) return []
  const slotByWeekday = new Map(slots.map((slot) => [slot.weekday, slot]))

  return enumerateDateKeys(firstDate, lastDate).flatMap((occurrenceDate) => {
    const weekday = new Date(`${occurrenceDate}T00:00:00.000Z`).getUTCDay()
    const slot = slotByWeekday.get(weekday)
    if (!slot) return []
    return [{
      seriesId: series.id,
      occurrenceDate,
      startsAt: indiaLocalDateTime(occurrenceDate, slot.startTime),
      durationMinutes: slot.durationMinutes,
      venue: series.venue,
    }]
  })
}

export function assignmentCoversOccurrence<
  TAssignment extends Pick<SessionAssignment, "effectiveFrom" | "effectiveTo" | "seriesId" | "weekdays">,
  TOccurrence extends Pick<TrainingSessionOccurrence, "eligibilityDate" | "seriesId">,
>(
  assignment: TAssignment,
  occurrence: TOccurrence,
) {
  return assignment.seriesId === occurrence.seriesId
    && occurrence.eligibilityDate >= assignment.effectiveFrom
    && (!assignment.effectiveTo || occurrence.eligibilityDate < assignment.effectiveTo)
    && assignment.weekdays.includes(weekdayForDateKey(occurrence.eligibilityDate))
}

export function playerWasEnrolledForOccurrence<
  TOccurrence extends Pick<TrainingSessionOccurrence, "eligibilityDate">,
>(
  joinedOn: string,
  occurrence: TOccurrence,
) {
  return occurrence.eligibilityDate >= joinedOn
}

export function resolveNextAssignedOccurrence({
  assignments,
  occurrences,
  referenceInstant,
}: {
  assignments: SessionAssignment[]
  occurrences: TrainingSessionOccurrence[]
  referenceInstant: ReferenceInstant
}) {
  return resolveNextScheduledOccurrence({
    occurrences: occurrences.filter((occurrence) => assignments.some(
      (assignment) => assignmentCoversOccurrence(assignment, occurrence),
    )),
    referenceInstant,
  })
}

export function resolveNextScheduledOccurrence({
  occurrences,
  referenceInstant,
}: {
  occurrences: TrainingSessionOccurrence[]
  referenceInstant: ReferenceInstant
}) {
  const referenceTime = referenceInstant instanceof Date
    ? referenceInstant.getTime()
    : new Date(referenceInstant).getTime()
  if (!Number.isFinite(referenceTime)) throw new Error("Invalid reference time.")

  return occurrences
    .filter((occurrence) => (
      occurrence.status === "scheduled"
      && new Date(occurrence.startsAt).getTime() >= referenceTime
    ))
    .sort((first, second) => (
      new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime()
      || first.id.localeCompare(second.id)
    ))[0] ?? null
}

export function sessionIsEligible({
  assignment,
  joinedOn,
  occurrence,
  referenceInstant,
}: {
  assignment: SessionAssignment
  joinedOn: string
  occurrence: TrainingSessionOccurrence
  referenceInstant: ReferenceInstant
}) {
  return occurrence.status === "scheduled"
    && playerWasEnrolledForOccurrence(joinedOn, occurrence)
    && occurrenceHasStarted(occurrence, referenceInstant)
    && assignmentCoversOccurrence(assignment, occurrence)
}

export function calendarWindowForYear(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}
