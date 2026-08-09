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
  today,
}: {
  occurrences: TrainingSessionOccurrence[]
  query: AttendanceRegisterQuery
  series: TrainingSessionSeries[]
  today: string
}): AttendanceRegisterSelection {
  const currentYear = Number(today.slice(0, 4))
  const supportedYears = new Set([
    currentYear - 1,
    currentYear,
    currentYear + 1,
    currentYear + 2,
  ])
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
    year: supportedYears.has(requestedYear) ? requestedYear : currentYear,
  }
}
