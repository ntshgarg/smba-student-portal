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

export type OperationalAcademyMember = {
  id: string
  role: "player"
  fullName: string
  initials: string
  trainingStartOn: string
}

export type AcademyMember = OperationalAcademyMember & {
  academyId: string
  requestedAt?: string
  approvedAt?: string | null
  trainingStartConfirmedAt?: string | null
  activatedAt?: string | null
  onboardingCompletedAt?: string | null
  primaryContact: {
    name: string
    relationship: string
    phone: string
  }
}

/*
 * Coaching staff are a separate shape from `AcademyMember` on purpose. A member
 * is a player: `isAcademyMember` demands a `trainingStartOn` and a primary
 * contact, and the Member Directory throws if any row fails that guard, which
 * is the check standing between a partial read and a roster that silently drops
 * people. Widening it to admit rows with neither field would retire that guard
 * for players in order to display coaches. The directory renders both instead.
 */
export type AcademyStaffAccessLevel = "head_admin" | "junior_coach"

export type AcademyStaffMember = {
  id: string
  role: "coach"
  accessLevel: AcademyStaffAccessLevel
  academyId: string
  fullName: string
  initials: string
  joinedOn: string
  approvedAt: string | null
  activatedAt: string | null
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
  /** Every open place (assignment with no end), finished terms included. */
  activeSessionIds: string[]
  recordRevision: number
  /**
   * "finished" when every open place is on a schedule whose last day has
   * passed (lib/sessions/term.ts). Nothing changes by itself at term end, so
   * the player still holds those places until the head coach moves them on.
   */
  status: import("@/lib/sessions/term").PlayerTrainingStatus
  /** The last day of the finished term while status is "finished"; otherwise null. */
  termFinishedOn: string | null
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
  "fullName" | "primaryContact"
> & {
  /** Legacy callers may send this value; generic member edits never persist it. */
  trainingStartOn?: string
}

export type PlayerTrainingUpdate = Pick<
  PlayerTrainingProfile,
  "academyPlan" | "batch" | "level"
>

export type MemberField =
  | "fullName"
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

export type ArchiveCoachInput = {
  coachAccountId: string
}

export type ArchiveCoachResult =
  | { ok: true; coachAccountId: string }
  | {
      ok: false
      code: "HEAD_COACH" | "NOT_FOUND" | "SELF"
      message: string
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
      code: "STALE_RECORD" | "ACTIVE_ASSIGNMENTS" | "FEES_NOT_ISSUED" | "NOT_FOUND"
      message: string
    }
