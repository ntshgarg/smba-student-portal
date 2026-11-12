import type { AttendanceBreakdown } from "@/lib/attendance/domain"

export type PlayerProfile = {
  id: string
  firstName: string
  fullName: string
  initials: string
  ageGroup: string
  level: string
  academyPlan: string
  memberSince: string
  currentFocus: string
  status: "unassigned" | "active" | "paused"
  /**
   * The last day of the player's term when every place they still hold is on
   * a schedule that has run out (lib/sessions/term.ts); otherwise null.
   */
  termFinishedOn: string | null
  /** The 1st a move booked in Members takes a term-finished player onto their next schedule. */
  nextScheduleStartsOn: string | null
}

export type CoachMessage = {
  coachName: string
  message: string
}

export type AttendanceSummary = AttendanceBreakdown & {
  month: string
}

export type PlayerAttendanceRecord = {
  referenceDate: string
  referenceInstant: string
  joinedOn: string
  years: number[]
  /*
   * Days the academy was closed. Carried alongside the occurrences rather than
   * derived from them, because a closure removes every scheduled row for that
   * date -- so by the time the calendar sees it there is nothing left to infer
   * a holiday from, and the day would render exactly like a Sunday.
   */
  holidays: Array<{ dateKey: string; label: string }>
  sessions: Array<{
    id: string
    programme: string
    batch: string
    startTime: string
    durationMinutes: number
  }>
  assignments: Array<{
    id: string
    seriesId: string
    effectiveFrom: string
    effectiveTo: string | null
    weekdays: number[]
  }>
  occurrences: Array<{
    id: string
    seriesId: string
    occurrenceDate: string
    eligibilityDate: string
    startsAt: string
    durationMinutes: number
    status: "scheduled" | "cancelled"
  }>
  records: Array<{
    occurrenceId: string
    choice: "present" | "absent"
  }>
  adjustments: Array<{
    sourceOccurrenceId: string
    completedOn: string
  }>
}

export type TrainingSession = {
  id: string
  startsAt: string
  durationMinutes: number
  title: string
  trainingFocus: string
  batch: string
  venue: string
  arrivalNote: string
}

export type Announcement = {
  id: string
  date: string
  title: string
  body: string
  category: "Training" | "Academy" | "Reminder"
}

export type DevelopmentMarker = {
  label: string
  value: number
  stage: string
  note: string
}

export type LatestAssessmentSummary = {
  dateLabel: string
}

export type ProgressMilestone = {
  id: string
  date: string
  title: string
  description: string
  category: "Assessment" | "Technique" | "Movement" | "Match play"
}

export type ProgressJourney = {
  summary: string
  currentBlock: string
  development: DevelopmentMarker[]
  milestones: ProgressMilestone[]
}

export type DashboardSnapshot = {
  player: PlayerProfile
  coachMessage: CoachMessage
  latestAssessment: LatestAssessmentSummary | null
  attendance: AttendanceSummary | null
  attendanceRecord: PlayerAttendanceRecord
  nextSession: TrainingSession | null
  announcements: Announcement[]
}
