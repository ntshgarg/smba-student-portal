import type { AttendanceBreakdown } from "@/lib/attendance/domain"
import type {
  SessionAssignment,
  SessionAttendanceChange,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

export type {
  SessionAssignment,
  SessionAttendanceChange,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
}

export type CoachProfile = {
  id: string
  firstName: string
  fullName: string
  initials: string
}

export type CoachReportTask = {
  id: string
  playerId: string
  playerName: string
  playerInitials: string
  playerContext: string
  monthLabel: string
  status: "due" | "draft"
  activityLabel: string
}

export type CoachReportPublishedSnapshot = {
  reportText: string
  nextPriorities: string
  publishedAt: string
  updatedAt: string
  revision: number
}

export type CoachMonthlyReportRecord = {
  id: string
  playerId: string
  month: string
  reportText: string
  nextPriorities: string
  updatedAt: string
  published: CoachReportPublishedSnapshot | null
}

export type CoachReportResumePoint = {
  month: string
  playerId: string
}

export type CoachReportAttendance = AttendanceBreakdown

export type OperationalAcademyMember = {
  id: string
  role: "player"
  fullName: string
  initials: string
  joinedAt: string
}

export type AcademyMember = OperationalAcademyMember & {
  academyId: string
  primaryContact: {
    name: string
    relationship: string
    phone: string
  }
}

export type PendingRegistration = {
  id: string
  fullName: string
  requestedRole: "player" | "coach"
  createdAt: string
}

export type PlayerTrainingProfile = {
  memberId: string
  ageGroup: string
  level: import("@/lib/sessions/types").TrainingProgramme | "Assessment pending"
  batch: "Weekday" | "Weekend" | "Assessment pending"
  academyPlan: import("@/lib/training/academy-plans").AcademyPlan | null
  activeSessionIds: string[]
  recordRevision: number
  status: "unassigned" | "active" | "paused"
}

export type PlayerMemberRecord = {
  member: AcademyMember
  training: PlayerTrainingProfile
}

export type OperationalPlayerMemberRecord = {
  member: OperationalAcademyMember
  training: PlayerTrainingProfile
}

export type MemberProfileUpdate = Pick<
  AcademyMember,
  "fullName" | "joinedAt" | "primaryContact"
>

export type PlayerTrainingUpdate = Pick<
  PlayerTrainingProfile,
  "academyPlan" | "batch" | "level"
>

export type MemberField =
  | "fullName"
  | "joinedAt"
  | "primaryContact.name"
  | "primaryContact.relationship"
  | "primaryContact.phone"
  | "level"
  | "batch"
  | "academyPlan"

export type UpdateMemberInput = {
  memberId: string
  expectedRevision: number
  profile: MemberProfileUpdate
  training: PlayerTrainingUpdate
}

export type MemberMutationResult =
  | { ok: true; record: PlayerMemberRecord }
  | {
      ok: false
      code: "VALIDATION" | "STALE_RECORD" | "ACTIVE_ASSIGNMENTS" | "NOT_FOUND"
      message: string
      fieldErrors?: Partial<Record<MemberField, string>>
    }

export type ArchiveMemberInput = {
  memberId: string
  expectedRevision: number
}

export type ArchiveMemberResult =
  | { ok: true; memberId: string }
  | {
      ok: false
      code: "FINANCIAL_CLOSEOUT_REQUIRED"
      hasOpenFeePlan: boolean
      hasOutstandingBalance: boolean
      outstandingPaise: number
    }
  | {
      ok: false
      code: "STALE_RECORD" | "ACTIVE_ASSIGNMENTS" | "NOT_FOUND"
      message: string
    }
