import type {
  AcademyMember,
  OperationalAcademyMember,
  PlayerTrainingProfile,
} from "@/lib/coach/types"
import { academyPlanIsValid } from "@/lib/training/academy-plans"
import type { AcademyPlan } from "@/lib/training/academy-plans"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

const trainingLevels = new Set<TrainingProgramme>(["Beginner", "Intermediate", "Advanced", "Adult", "Elite"])

export function memberInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/u).filter(Boolean)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""

  return `${first}${last}`.toLocaleUpperCase()
}

export function joinPlayerMembers<Member extends OperationalAcademyMember>(
  members: Member[],
  trainingProfiles: PlayerTrainingProfile[],
) {
  const trainingByMember = new Map(
    trainingProfiles.map((profile) => [profile.memberId, profile]),
  )

  return members.reduce<Array<{ member: Member; training: PlayerTrainingProfile }>>((records, member) => {
    const training = trainingByMember.get(member.id)
    if (member.role === "player" && training) records.push({ member, training })
    return records
  }, [])
}

export function isAcademyMember(value: unknown): value is AcademyMember {
  if (!value || typeof value !== "object") return false
  const member = value as Partial<AcademyMember>
  const contact = member.primaryContact as Partial<AcademyMember["primaryContact"]> | undefined

  return member.role === "player"
    && typeof member.id === "string"
    && typeof member.academyId === "string"
    && typeof member.fullName === "string"
    && typeof member.initials === "string"
    && typeof member.trainingStartOn === "string"
    && typeof contact?.name === "string"
    && typeof contact.relationship === "string"
    && typeof contact.phone === "string"
}

export function isPlayerTrainingProfile(value: unknown): value is PlayerTrainingProfile {
  if (!value || typeof value !== "object") return false
  const profile = value as Partial<PlayerTrainingProfile>

  return typeof profile.memberId === "string"
    && typeof profile.ageGroup === "string"
    && (profile.level === "Assessment pending" || trainingLevels.has(profile.level as TrainingProgramme))
    && (profile.batch === "Weekday" || profile.batch === "Weekend" || profile.batch === "Assessment pending")
    && (profile.academyPlan === null || (
      profile.batch !== "Assessment pending"
      && profile.level !== "Assessment pending"
      && academyPlanIsValid(
        profile.academyPlan as AcademyPlan,
        profile.level as TrainingProgramme,
        profile.batch as TrainingBatch,
      )
    ))
    && Array.isArray(profile.activeSessionIds)
    && profile.activeSessionIds.every((id) => typeof id === "string")
    && Number.isInteger(profile.recordRevision)
    && (profile.recordRevision ?? -1) >= 0
    && (profile.status === "unassigned" || profile.status === "active" || profile.status === "paused")
}
