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

export type MonthlyReport = {
  id: string
  month: string
  monthLabel: string
  publishedAt: string
  coachName: string
  reportText: string
  attendance: AttendanceSummary
  development: DevelopmentMarker[]
}

export type LatestReportSummary = {
  monthLabel: string
}

export type PlayerReportArchiveItem = {
  id: string
  month: string
  monthLabel: string
  publishedAt: string
  reportText: string
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
  latestReport: LatestReportSummary | null
  attendance: AttendanceSummary | null
  attendanceRecord: PlayerAttendanceRecord
  nextSession: TrainingSession | null
  announcements: Announcement[]
}
