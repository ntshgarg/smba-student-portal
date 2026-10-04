import "server-only"

import { randomUUID } from "node:crypto"

import { and, eq, isNull } from "drizzle-orm"

import {
  ASSESSMENT_TEXT_MAX_LENGTH,
  countRated,
  validateAssessmentRatings,
} from "@/lib/assessments/rubric"
import type {
  AssessmentErrorCode,
  AssessmentField,
  DiscardAssessmentInput,
  SaveAssessmentInput,
} from "@/lib/assessments/contracts"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabase } from "@/lib/db/client"
import { initializeDatabase } from "@/lib/db/client"
import { accounts, playerAssessments, playerEnrollments } from "@/lib/db/schema"
import { getAcademyDateKey } from "@/lib/format"

const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u

export class AssessmentServiceError extends Error {
  readonly code: AssessmentErrorCode
  readonly field?: AssessmentField

  constructor(code: AssessmentErrorCode, message: string, field?: AssessmentField) {
    super(message)
    this.name = "AssessmentServiceError"
    this.code = code
    this.field = field
  }
}

type Transaction = Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0]

type AssessmentServiceContext = {
  coachId: string
  createId?: () => string
  database?: SmbaDatabase
  now?: Date
}

function isRealDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Checks everything the form promises, in the order the coach meets it. The
 * rating check is strict on purpose: the form can only ever send whole numbers
 * from 1 to 5 against known skills, so anything else is a request the form did
 * not make and is refused, not trimmed.
 */
function validate(input: SaveAssessmentInput, now: Date, { publishing }: { publishing: boolean }) {
  if (typeof input.playerId !== "string" || !input.playerId.trim()) {
    throw new AssessmentServiceError("INVALID_INPUT", "Choose a player.", "playerId")
  }
  if (typeof input.assessedOn !== "string" || !isRealDateKey(input.assessedOn)) {
    throw new AssessmentServiceError("INVALID_INPUT", "Choose a valid assessment date.", "assessedOn")
  }
  if (input.assessedOn > getAcademyDateKey(now)) {
    throw new AssessmentServiceError(
      "INVALID_INPUT",
      "An assessment cannot be dated in the future.",
      "assessedOn",
    )
  }
  const ratings = validateAssessmentRatings(input.ratings)
  if (!ratings.ok) throw new AssessmentServiceError("INVALID_INPUT", ratings.message, "ratings")
  if (publishing && countRated(ratings.ratings) === 0) {
    throw new AssessmentServiceError(
      "INVALID_INPUT",
      "Rate at least one skill before publishing.",
      "ratings",
    )
  }
  for (const field of ["strengths", "improvements", "comments"] as const) {
    const value = input[field]
    if (typeof value !== "string") {
      throw new AssessmentServiceError("INVALID_INPUT", "The feedback could not be read.", field)
    }
    if (value.length > ASSESSMENT_TEXT_MAX_LENGTH) {
      throw new AssessmentServiceError(
        "INVALID_INPUT",
        `Each feedback box is limited to ${ASSESSMENT_TEXT_MAX_LENGTH.toLocaleString("en-IN")} characters.`,
        field,
      )
    }
  }
  return ratings.ratings
}

function requireActivePlayer(tx: Transaction, playerId: string) {
  const player = tx.select({ id: accounts.id })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(
      eq(accounts.id, playerId),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
      eq(playerEnrollments.status, "active"),
    ))
    .get()
  if (!player) {
    throw new AssessmentServiceError(
      "PLAYER_UNAVAILABLE",
      "Assessments are available only for active players.",
      "playerId",
    )
  }
}

function loadExisting(tx: Transaction, assessmentId: string, playerId: string) {
  const existing = tx.select().from(playerAssessments)
    .where(eq(playerAssessments.id, assessmentId))
    .get()
  if (!existing) {
    throw new AssessmentServiceError("NOT_FOUND", "This assessment no longer exists.")
  }
  if (existing.playerAccountId !== playerId) {
    throw new AssessmentServiceError("INVALID_INPUT", "This assessment belongs to a different player.", "playerId")
  }
  return existing
}

function save(
  input: SaveAssessmentInput,
  { publishing }: { publishing: boolean },
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: AssessmentServiceContext,
) {
  requireHeadAdminAccess(coachId, { database })
  const ratings = validate(input, now, { publishing })
  const content = {
    assessedOn: input.assessedOn,
    comments: input.comments.trim(),
    improvements: input.improvements.trim(),
    ratings: JSON.stringify(ratings),
    strengths: input.strengths.trim(),
    updatedAt: now,
    updatedByAccountId: coachId,
  }

  return database.transaction((tx) => {
    requireActivePlayer(tx, input.playerId)

    if (input.assessmentId) {
      const existing = loadExisting(tx, input.assessmentId, input.playerId)
      if (existing.status === "published" && !publishing) {
        // A published assessment is changed by publishing the change, so the
        // player never sees a half-edited version and a "save" cannot quietly
        // pull a published page back to draft.
        throw new AssessmentServiceError(
          "CONFLICT",
          "This assessment is already published. Publish your changes to update it.",
        )
      }
      tx.update(playerAssessments).set(publishing
        ? {
          ...content,
          publishedAt: existing.publishedAt ?? now,
          publishedByAccountId: coachId,
          revision: existing.revision + 1,
          status: "published" as const,
        }
        : content)
        .where(eq(playerAssessments.id, existing.id))
        .run()
      return existing.id
    }

    if (!publishing) {
      const draft = tx.select({ id: playerAssessments.id }).from(playerAssessments)
        .where(and(
          eq(playerAssessments.playerAccountId, input.playerId),
          eq(playerAssessments.status, "draft"),
        ))
        .get()
      if (draft) {
        throw new AssessmentServiceError(
          "CONFLICT",
          "This player already has a draft. Continue that one instead.",
        )
      }
    }

    const id = createId()
    tx.insert(playerAssessments).values({
      ...content,
      createdAt: now,
      createdByAccountId: coachId,
      id,
      playerAccountId: input.playerId,
      ...(publishing
        ? {
          publishedAt: now,
          publishedByAccountId: coachId,
          revision: 1,
          status: "published" as const,
        }
        : {}),
    }).run()
    return id
  }, { behavior: "immediate" })
}

export function saveAssessmentDraft(input: SaveAssessmentInput, context: AssessmentServiceContext) {
  return { assessmentId: save(input, { publishing: false }, context) }
}

export function publishAssessment(input: SaveAssessmentInput, context: AssessmentServiceContext) {
  return { assessmentId: save(input, { publishing: true }, context) }
}

/** Only a draft can be discarded; anything the player has seen stays on the record. */
export function discardAssessmentDraft(
  input: DiscardAssessmentInput,
  { coachId, database = initializeDatabase() }: AssessmentServiceContext,
) {
  requireHeadAdminAccess(coachId, { database })
  if (typeof input.assessmentId !== "string" || !input.assessmentId.trim()) {
    throw new AssessmentServiceError("NOT_FOUND", "This draft no longer exists.")
  }
  return database.transaction((tx) => {
    const deleted = tx.delete(playerAssessments)
      .where(and(
        eq(playerAssessments.id, input.assessmentId),
        eq(playerAssessments.status, "draft"),
      ))
      .returning({ id: playerAssessments.id })
      .get()
    if (!deleted) {
      throw new AssessmentServiceError(
        "NOT_FOUND",
        "This draft no longer exists, or it has already been published.",
      )
    }
    return { assessmentId: deleted.id }
  }, { behavior: "immediate" })
}
