import { isValidDateKey } from "@/lib/date-keys"
import type {
  TrainingBatch,
  TrainingProgramme,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

export const attendanceRegisterProgrammes: readonly TrainingProgramme[] = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Adult",
  "Elite",
]
export const attendanceRegisterBatches: readonly TrainingBatch[] = ["Weekday", "Weekend"]

export type AttendanceRegisterQuery = {
  batch?: string | string[]
  level?: string | string[]
  year?: string | string[]
}

export type AttendanceRegisterSelection = {
  batch: TrainingBatch
  programme: TrainingProgramme
  year: number
}

export function buildAttendanceRegisterYearOptions({
  persistedDateKeys = [],
  today,
}: {
  persistedDateKeys?: readonly string[]
  today: string
}) {
  const currentYear = Number(today.slice(0, 4))
  const persistedYears = persistedDateKeys
    .filter(isValidDateKey)
    .map((dateKey) => Number(dateKey.slice(0, 4)))
  const firstYear = Math.min(currentYear - 1, ...persistedYears)
  const lastYear = Math.max(currentYear + 2, ...persistedYears)
  return Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => firstYear + index,
  )
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isProgramme(value: string | undefined): value is TrainingProgramme {
  return attendanceRegisterProgrammes.includes(value as TrainingProgramme)
}

function isBatch(value: string | undefined): value is TrainingBatch {
  return attendanceRegisterBatches.includes(value as TrainingBatch)
}

export function resolveAttendanceRegisterSelection({
  occurrences,
  query,
  series,
  supportedYears,
  today,
}: {
  occurrences: TrainingSessionOccurrence[]
  query: AttendanceRegisterQuery
  series: TrainingSessionSeries[]
  supportedYears?: readonly number[]
  today: string
}): AttendanceRegisterSelection {
  const currentYear = Number(today.slice(0, 4))
  const selectableYears = new Set(supportedYears?.length
    ? supportedYears
    : buildAttendanceRegisterYearOptions({ today }))
  const requestedYear = Number(firstQueryValue(query.year))
  const firstTodayOccurrence = [...occurrences]
    .filter((occurrence) => (
      occurrence.occurrenceDate === today && occurrence.status === "scheduled"
    ))
    .sort((first, second) => (
      first.startsAt.localeCompare(second.startsAt) || first.id.localeCompare(second.id)
    ))[0]
  const defaultSeries = series.find((item) => item.id === firstTodayOccurrence?.seriesId)
    ?? series[0]
  const requestedProgramme = firstQueryValue(query.level)
  const requestedBatch = firstQueryValue(query.batch)

  return {
    batch: isBatch(requestedBatch) ? requestedBatch : defaultSeries?.batch ?? "Weekday",
    programme: isProgramme(requestedProgramme)
      ? requestedProgramme
      : defaultSeries?.programme ?? "Beginner",
    year: selectableYears.has(requestedYear) ? requestedYear : currentYear,
  }
}
