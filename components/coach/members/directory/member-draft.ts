import type { PlayerMemberRecord } from "@/lib/coach/types"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanIsValid,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

export type MemberDraft = {
  fullName: string
  contactName: string
  relationship: string
  phone: string
  level: TrainingProgramme | "Assessment pending"
  batch: "Weekday" | "Weekend" | "Assessment pending"
  academyPlan: AcademyPlan | null
}

export type DraftErrors = Partial<Record<keyof MemberDraft, string>>

export const relationships = ["Parent", "Guardian", "Self", "Other"]

export function draftFromPlayer(player: PlayerMemberRecord): MemberDraft {
  return {
    fullName: player.member.fullName,
    contactName: player.member.primaryContact.name,
    relationship: player.member.primaryContact.relationship,
    phone: player.member.primaryContact.phone,
    level: player.training.level,
    batch: player.training.batch,
    academyPlan: player.training.academyPlan,
  }
}

export function validateDraft(draft: MemberDraft) {
  const errors: DraftErrors = {}
  const fullName = draft.fullName.trim().replace(/\s+/gu, " ")
  const contactName = draft.contactName.trim().replace(/\s+/gu, " ")
  const relationship = draft.relationship.trim()
  const phone = draft.phone.trim()
  const phoneDigits = draft.phone.replace(/\D/gu, "")

  if (fullName.length < 2 || fullName.length > 80) {
    errors.fullName = "Enter a player name between 2 and 80 characters."
  }
  const hasContact = Boolean(contactName || relationship || phone)
  if (hasContact) {
    if (contactName.length < 2 || contactName.length > 80) {
      errors.contactName = "Enter a contact name between 2 and 80 characters."
    }
    if (!relationships.includes(relationship)) {
      errors.relationship = "Choose Parent, Guardian, Self or Other."
    }
    if (phone.length > 32
      || phoneDigits.length < 10
      || phoneDigits.length > 15
      || !/^[+\d().\-\s]+$/u.test(phone)) {
      errors.phone = "Enter a phone number containing 10 to 15 digits."
    }
  }
  const levelPending = draft.level === "Assessment pending"
  const batchPending = draft.batch === "Assessment pending"
  if (levelPending !== batchPending) {
    errors.level = "Choose both the player’s level and batch, or leave both pending."
    errors.batch = "Choose both the player’s level and batch, or leave both pending."
  } else if (!levelPending && !academyPlanIsValid(
    draft.academyPlan,
    draft.level as TrainingProgramme,
    draft.batch as TrainingBatch,
  )) {
    errors.academyPlan = "Choose the Academy Plan this player enrolled in."
  }

  return errors
}
