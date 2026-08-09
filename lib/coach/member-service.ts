import "server-only"

import { and, asc, eq, isNull, sql } from "drizzle-orm"

import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import {
  formatAcademyId,
  identityNameParts,
  normalizeFullName,
  normalizedNameKey,
} from "@/lib/auth/identity"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import type {
  ArchiveMemberInput,
  ArchiveMemberResult,
  MemberField,
  MemberMutationResult,
  PlayerMemberRecord,
  UpdateMemberInput,
} from "@/lib/coach/types"
import type { SmbaDatabaseExecutor, SmbaDatabase } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authMethods,
  authSessions,
  playerEnrollments,
  sessionAssignments,
  sessionSeries,
} from "@/lib/db/schema"
import { readPlayerFinancialCloseoutState } from "@/lib/finance/service"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  type AcademyPlan,
  academyPlanIsValid,
} from "@/lib/training/academy-plans"

const TRAINING_LEVELS = ["Beginner", "Intermediate", "Advanced", "Adult"] as const
const TRAINING_BATCHES = ["Weekday", "Weekend"] as const
const ACADEMY_PLANS = [
  "weekday-3-day",
  "weekday-4-day",
  "weekday-5-day",
  "weekend-standard",
] as const
const CONTACT_RELATIONSHIPS = ["Parent", "Guardian", "Self", "Other"] as const
const MAX_PHONE_INPUT_LENGTH = 32

type ValidatedMemberUpdate = {
  academyPlan: AcademyPlan | null
  batch: TrainingBatch | null
  contactName: string | null
  contactPhone: string | null
  contactRelationship: string | null
  fullName: string
  joinedAt: Date
  joinedOn: string
  level: TrainingProgramme | null
}

function memberFailure(
  code: Exclude<MemberMutationResult, { ok: true }>["code"],
  message: string,
  fieldErrors?: Partial<Record<MemberField, string>>,
): MemberMutationResult {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) }
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : null
}

function validateMemberUpdate(input: UpdateMemberInput):
  | { ok: true; value: ValidatedMemberUpdate }
  | { ok: false; result: MemberMutationResult } {
  const fieldErrors: Partial<Record<MemberField, string>> = {}

  const fullNameInput = textValue(input.profile?.fullName)
  const fullName = fullNameInput === null ? "" : normalizeFullName(fullNameInput)
  if (fullName.length < 2 || fullName.length > 80) {
    fieldErrors.fullName = "Enter a player name between 2 and 80 characters."
  }

  const joinedOn = textValue(input.profile?.joinedAt) ?? ""
  if (!isValidDateKey(joinedOn)) {
    fieldErrors.joinedAt = "Choose a valid joining date."
  }

  const rawLevel = input.training?.level as unknown
  const rawBatch = input.training?.batch as unknown
  const rawAcademyPlan = input.training?.academyPlan as unknown
  const level = rawLevel === "Assessment pending"
    ? null
    : TRAINING_LEVELS.includes(rawLevel as typeof TRAINING_LEVELS[number])
      ? rawLevel as TrainingProgramme
      : undefined
  const batch = rawBatch === "Assessment pending"
    ? null
    : TRAINING_BATCHES.includes(rawBatch as typeof TRAINING_BATCHES[number])
      ? rawBatch as TrainingBatch
      : undefined
  const academyPlan = rawAcademyPlan === null
    ? null
    : ACADEMY_PLANS.includes(rawAcademyPlan as typeof ACADEMY_PLANS[number])
      ? rawAcademyPlan as AcademyPlan
      : undefined

  if (level === undefined) fieldErrors.level = "Choose a valid training level."
  if (batch === undefined) fieldErrors.batch = "Choose Weekday or Weekend."
  if (academyPlan === undefined) fieldErrors.academyPlan = "Choose a valid Academy Plan."

  if (level !== undefined && batch !== undefined && ((level === null) !== (batch === null))) {
    fieldErrors.level = "Choose both the player’s level and batch, or leave both pending."
    fieldErrors.batch = "Choose both the player’s level and batch, or leave both pending."
  }
  if (level === null && batch === null && academyPlan !== null && academyPlan !== undefined) {
    fieldErrors.academyPlan = "Set the level and batch before choosing an Academy Plan."
  }
  if (level && batch && academyPlan !== undefined
    && !academyPlanIsValid(academyPlan, level, batch)) {
    fieldErrors.academyPlan = "Choose an Academy Plan that matches the player’s level and batch."
  }

  const primaryContact = input.profile?.primaryContact as unknown
  const contactObject = primaryContact && typeof primaryContact === "object"
    ? primaryContact as Record<string, unknown>
    : null
  const contactNameValue = textValue(contactObject?.name)
  const contactRelationshipValue = textValue(contactObject?.relationship)
  const contactPhoneValue = textValue(contactObject?.phone)
  if (primaryContact !== undefined && !contactObject) {
    fieldErrors["primaryContact.name"] = "Review the primary contact details."
  }
  const contactName = contactNameValue === null ? "" : normalizeFullName(contactNameValue)
  const contactRelationship = contactRelationshipValue ?? ""
  const contactPhone = contactPhoneValue ?? ""
  const hasContact = Boolean(contactName || contactRelationship || contactPhone)
  if (hasContact) {
    if (contactName.length < 2 || contactName.length > 80) {
      fieldErrors["primaryContact.name"] = "Enter a contact name between 2 and 80 characters."
    }
    if (!CONTACT_RELATIONSHIPS.includes(
      contactRelationship as typeof CONTACT_RELATIONSHIPS[number],
    )) {
      fieldErrors["primaryContact.relationship"] = "Choose Parent, Guardian, Self or Other."
    }
    const phoneDigits = contactPhone.replace(/\D/gu, "")
    const phoneCharactersAreValid = /^[+\d().\-\s]+$/u.test(contactPhone)
    if (contactPhone.length > MAX_PHONE_INPUT_LENGTH
      || phoneDigits.length < 10
      || phoneDigits.length > 15
      || !phoneCharactersAreValid) {
      fieldErrors["primaryContact.phone"] = "Enter a phone number containing 10 to 15 digits."
    }
  }

  if (Object.keys(fieldErrors).length) {
    return {
      ok: false,
      result: memberFailure(
        "VALIDATION",
        "Review the highlighted member details.",
        fieldErrors,
      ),
    }
  }

  return {
    ok: true,
    value: {
      academyPlan: academyPlan as AcademyPlan | null,
      batch: batch as TrainingBatch | null,
      contactName: hasContact ? contactName : null,
      contactPhone: hasContact ? contactPhone : null,
      contactRelationship: hasContact ? contactRelationship : null,
      fullName,
      joinedAt: new Date(`${joinedOn}T00:00:00.000Z`),
      joinedOn,
      level: level as TrainingProgramme | null,
    },
  }
}

export function readCanonicalPlayerRecord(
  database: SmbaDatabaseExecutor,
  memberId: string,
): PlayerMemberRecord | null {
  const row = database.select({
    academyIdSerial: academyIdAllocations.serial,
    academyPlan: playerEnrollments.academyPlan,
    ageGroup: playerEnrollments.ageGroup,
    batch: playerEnrollments.batch,
    contactName: playerEnrollments.primaryContactName,
    contactPhone: playerEnrollments.primaryContactPhone,
    contactRelationship: playerEnrollments.primaryContactRelationship,
    fullName: accounts.fullName,
    id: accounts.id,
    joinedAt: playerEnrollments.joinedAt,
    level: playerEnrollments.level,
    recordRevision: playerEnrollments.recordRevision,
    status: playerEnrollments.status,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(accounts.id, memberId),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
  if (!row) return null

  const activeSessionIds = database.select({ seriesId: sessionAssignments.seriesId })
    .from(sessionAssignments)
    .where(and(
      eq(sessionAssignments.accountId, memberId),
      isNull(sessionAssignments.effectiveTo),
    ))
    .all()
    .map((assignment) => assignment.seriesId)
  const status = activeSessionIds.length
    ? "active" as const
    : row.status === "unassigned" ? "unassigned" as const : "paused" as const

  return {
    member: {
      id: row.id,
      role: "player",
      academyId: formatAcademyId(row.academyIdSerial),
      fullName: row.fullName,
      initials: identityNameParts(row.fullName).initials,
      joinedAt: getIndiaDateKey(row.joinedAt),
      primaryContact: {
        name: row.contactName ?? "",
        relationship: row.contactRelationship ?? "",
        phone: row.contactPhone ?? "",
      },
    },
    training: {
      memberId: row.id,
      ageGroup: row.ageGroup ?? "Not recorded",
      level: row.level ?? "Assessment pending",
      batch: row.batch ?? "Assessment pending",
      academyPlan: row.academyPlan,
      activeSessionIds,
      recordRevision: row.recordRevision,
      status,
    },
  }
}

export function updateMemberRecord({
  coachId,
  database,
  input,
  now = new Date(),
}: {
  coachId: string
  database: SmbaDatabase
  input: UpdateMemberInput
  now?: Date
}): MemberMutationResult {
  requireHeadAdminAccess(coachId, { database })
  if (!input || typeof input !== "object") {
    return memberFailure("VALIDATION", "The member update is invalid.")
  }
  if (typeof input.memberId !== "string" || !input.memberId.trim()) {
    return memberFailure("NOT_FOUND", "Player account was not found.")
  }
  const validated = validateMemberUpdate(input)
  if (!validated.ok) return validated.result

  return database.transaction((tx) => {
    const current = tx.select({
      academyPlan: playerEnrollments.academyPlan,
      batch: playerEnrollments.batch,
      level: playerEnrollments.level,
      recordRevision: playerEnrollments.recordRevision,
    }).from(accounts)
      .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
      .where(and(
        eq(accounts.id, input.memberId),
        eq(accounts.role, "player"),
        eq(accounts.approvalStatus, "approved"),
        isNull(accounts.archivedAt),
      ))
      .get()
    if (!current) return memberFailure("NOT_FOUND", "Player account was not found.")
    if (!Number.isInteger(input.expectedRevision)
      || input.expectedRevision < 0
      || current.recordRevision !== input.expectedRevision) {
      return memberFailure(
        "STALE_RECORD",
        "This member changed elsewhere. Close and reopen the record before saving again.",
      )
    }

    const activeAssignments = tx.select({
      series: {
        batch: sessionSeries.batch,
        programme: sessionSeries.programme,
      },
    }).from(sessionAssignments)
      .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
      .where(and(
        eq(sessionAssignments.accountId, input.memberId),
        isNull(sessionAssignments.effectiveTo),
      ))
      .all()
    if (activeAssignments.length && (
      validated.value.level !== current.level
      || validated.value.batch !== current.batch
      || validated.value.academyPlan !== current.academyPlan
    )) {
      return memberFailure(
        "ACTIVE_ASSIGNMENTS",
        "End the player’s active sessions before changing their training classification.",
      )
    }
    if (activeAssignments.some(({ series }) => (
      series.programme !== validated.value.level
      || series.batch !== validated.value.batch
    ))) {
      return memberFailure(
        "ACTIVE_ASSIGNMENTS",
        "The player’s active sessions must match their level and batch.",
      )
    }

    const earliestAssignment = tx.select({ effectiveFrom: sessionAssignments.effectiveFrom })
      .from(sessionAssignments)
      .where(eq(sessionAssignments.accountId, input.memberId))
      .orderBy(asc(sessionAssignments.effectiveFrom))
      .get()
    if (earliestAssignment && validated.value.joinedOn > earliestAssignment.effectiveFrom) {
      return memberFailure(
        "VALIDATION",
        "The joining date cannot be later than the player’s first session assignment.",
        { joinedAt: "Choose a date on or before the first session assignment." },
      )
    }

    const enrollmentUpdate = tx.update(playerEnrollments).set({
      academyPlan: validated.value.academyPlan,
      batch: validated.value.batch,
      joinedAt: validated.value.joinedAt,
      level: validated.value.level,
      primaryContactName: validated.value.contactName,
      primaryContactPhone: validated.value.contactPhone,
      primaryContactRelationship: validated.value.contactRelationship,
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(playerEnrollments.accountId, input.memberId),
      eq(playerEnrollments.recordRevision, input.expectedRevision),
    )).run()
    if (enrollmentUpdate.changes !== 1) {
      return memberFailure(
        "STALE_RECORD",
        "This member changed elsewhere. Close and reopen the record before saving again.",
      )
    }
    const accountUpdate = tx.update(accounts).set({
      fullName: validated.value.fullName,
      normalizedName: normalizedNameKey(validated.value.fullName),
      updatedAt: now,
    }).where(eq(accounts.id, input.memberId)).run()
    if (accountUpdate.changes !== 1) {
      throw new Error("Member account changed during an immediate transaction.")
    }

    const record = readCanonicalPlayerRecord(tx, input.memberId)
    if (!record) return memberFailure("NOT_FOUND", "Player account was not found.")
    return { ok: true, record }
  }, { behavior: "immediate" })
}

export function archiveMemberRecord({
  coachId,
  database,
  input,
  now = new Date(),
}: {
  coachId: string
  database: SmbaDatabase
  input: ArchiveMemberInput
  now?: Date
}): ArchiveMemberResult {
  requireHeadAdminAccess(coachId, { database })
  if (!input || typeof input !== "object"
    || typeof input.memberId !== "string"
    || !input.memberId.trim()) {
    return { ok: false, code: "NOT_FOUND", message: "Player account was not found." }
  }
  return database.transaction((tx) => {
    const current = tx.select({ recordRevision: playerEnrollments.recordRevision })
      .from(accounts)
      .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
      .where(and(
        eq(accounts.id, input.memberId),
        eq(accounts.role, "player"),
        eq(accounts.approvalStatus, "approved"),
        isNull(accounts.archivedAt),
      ))
      .get()
    if (!current) return { ok: false, code: "NOT_FOUND", message: "Player account was not found." }
    if (!Number.isInteger(input.expectedRevision)
      || input.expectedRevision < 0
      || current.recordRevision !== input.expectedRevision) {
      return {
        ok: false,
        code: "STALE_RECORD",
        message: "This member changed elsewhere. Close and reopen the record before archiving.",
      }
    }

    const activeAssignment = tx.select({ id: sessionAssignments.id })
      .from(sessionAssignments)
      .where(and(
        eq(sessionAssignments.accountId, input.memberId),
        isNull(sessionAssignments.effectiveTo),
      ))
      .get()
    if (activeAssignment) {
      return {
        ok: false,
        code: "ACTIVE_ASSIGNMENTS",
        message: "End the player’s active sessions before archiving their membership.",
      }
    }

    const financialCloseout = readPlayerFinancialCloseoutState(tx, input.memberId, now)
    if (financialCloseout.hasOpenFeePlan || financialCloseout.hasOutstandingBalance) {
      return {
        ok: false,
        code: "FINANCIAL_CLOSEOUT_REQUIRED",
        ...financialCloseout,
      }
    }

    const accountUpdate = tx.update(accounts).set({
      archivedAt: now,
      archivedByAccountId: coachId,
      updatedAt: now,
    }).where(and(eq(accounts.id, input.memberId), isNull(accounts.archivedAt))).run()
    const enrollmentUpdate = tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(playerEnrollments.accountId, input.memberId),
      eq(playerEnrollments.recordRevision, input.expectedRevision),
    )).run()
    if (accountUpdate.changes !== 1 || enrollmentUpdate.changes !== 1) {
      throw new Error("Member changed during an immediate archive transaction.")
    }
    tx.update(authMethods).set({ revokedAt: now }).where(and(
      eq(authMethods.accountId, input.memberId),
      isNull(authMethods.revokedAt),
    )).run()
    tx.delete(authSessions).where(eq(authSessions.accountId, input.memberId)).run()

    return { ok: true, memberId: input.memberId }
  }, { behavior: "immediate" })
}
