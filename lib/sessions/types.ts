export type TrainingProgramme = "Beginner" | "Intermediate" | "Advanced" | "Adult"
export type TrainingBatch = "Weekday" | "Weekend"

export type SessionRecurrenceSlot = {
  id: string
  weekday: number
  startTime: string
  durationMinutes: number
}

export type TrainingSessionSeries = {
  id: string
  title: string
  programme: TrainingProgramme
  batch: TrainingBatch
  venue: string
  startsOn: string
  endsOn: string | null
  status: "active" | "ended"
  slots: SessionRecurrenceSlot[]
}

export type TrainingSessionOccurrence = {
  id: string
  seriesId: string
  occurrenceDate: string
  eligibilityDate: string
  startsAt: string
  durationMinutes: number
  venue: string
  status: "scheduled" | "cancelled"
  replacementForOccurrenceId: string | null
}

export type SessionAssignment = {
  id: string
  playerId: string
  seriesId: string
  effectiveFrom: string
  effectiveTo: string | null
  weekdays: number[]
}

export type SessionAttendanceChoice = "present" | "absent"

export type SessionAttendanceChange = {
  playerId: string
  occurrenceId: string
  choice: SessionAttendanceChoice | "cleared"
}

export type SessionAttendanceRecords = Record<
  string,
  Record<string, SessionAttendanceChoice>
>

export type CreateSessionSeriesInput = {
  programme: TrainingProgramme
  batch: TrainingBatch
  venue: string
  startsOn: string
  endsOn: string
  weekdays: number[]
  startTime: string
  durationMinutes: number
}
