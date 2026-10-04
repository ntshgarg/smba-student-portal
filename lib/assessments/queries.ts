import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import {
  countRated,
  overallRating,
  parseStoredRatings,
} from "@/lib/assessments/rubric"
import type { AssessmentRecord } from "@/lib/assessments/contracts"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { identityNameParts } from "@/lib/auth/identity"
import {
  initializeDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import { accounts, playerAssessments, playerEnrollments } from "@/lib/db/schema"

type AssessmentRow = typeof playerAssessments.$inferSelect

type QueryContext = {
  database?: SmbaDatabaseExecutor
}

export type AssessmentPlayer = {
  group: string | null
  initials: string
  name: string
  playerId: string
}

export type AssessmentHomePlayer = AssessmentPlayer & {
  draft: { id: string; rated: number; updatedAt: string } | null
  lastAssessedOn: string | null
  lastOverall: number | null
}

/** The most recent published assessment before another, for "last time" and for change. */
export type PreviousAssessment = {
  assessedOn: string
  overall: number | null
  ratings: Record<string, number>
}

function toRecord(row: AssessmentRow, playerName: string): AssessmentRecord {
  const ratings = parseStoredRatings(row.ratings)
  return {
    assessedOn: row.assessedOn,
    comments: row.comments,
    id: row.id,
    improvements: row.improvements,
    overall: overallRating(ratings),
    playerId: row.playerAccountId,
    playerName,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    ratings: { ...ratings },
    revision: row.revision,
    status: row.status,
    strengths: row.strengths,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toPrevious(row: AssessmentRow): PreviousAssessment {
  const ratings = parseStoredRatings(row.ratings)
  return {
    assessedOn: row.assessedOn,
    overall: overallRating(ratings),
    ratings: { ...ratings },
  }
}

function groupLabel(level: string | null, batch: string | null) {
  const parts = [level, batch].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(" · ") : null
}

function activePlayerRows(database: SmbaDatabaseExecutor) {
  return database.select({
    batch: playerEnrollments.batch,
    fullName: accounts.fullName,
    level: playerEnrollments.level,
    playerId: accounts.id,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
      eq(playerEnrollments.status, "active"),
    ))
    .all()
}

function toPlayer(row: ReturnType<typeof activePlayerRows>[number]): AssessmentPlayer {
  return {
    group: groupLabel(row.level, row.batch),
    initials: identityNameParts(row.fullName).initials,
    name: row.fullName,
    playerId: row.playerId,
  }
}

/**
 * The coach's starting screen: every active player, with when they were last
 * assessed. Players who have never been assessed come first, then whoever has
 * waited longest, because the coach chooses the rhythm and the list's job is to
 * show who has been left.
 */
export function listAssessmentHome(
  coachId: string,
  { database = initializeDatabase() }: QueryContext = {},
) {
  requireHeadAdminAccess(coachId, { database })
  const players = activePlayerRows(database)
  if (players.length === 0) return { drafts: 0, players: [] as AssessmentHomePlayer[] }

  const rows = database.select().from(playerAssessments)
    .where(inArray(playerAssessments.playerAccountId, players.map((player) => player.playerId)))
    .orderBy(desc(playerAssessments.assessedOn), desc(playerAssessments.createdAt))
    .all()

  const home = players.map((player): AssessmentHomePlayer => {
    const own = rows.filter((row) => row.playerAccountId === player.playerId)
    const latest = own.find((row) => row.status === "published")
    const draft = own.find((row) => row.status === "draft")
    return {
      ...toPlayer(player),
      draft: draft
        ? {
          id: draft.id,
          rated: countRated(parseStoredRatings(draft.ratings)),
          updatedAt: draft.updatedAt.toISOString(),
        }
        : null,
      lastAssessedOn: latest?.assessedOn ?? null,
      lastOverall: latest ? overallRating(parseStoredRatings(latest.ratings)) : null,
    }
  }).sort((a, b) => {
    if (a.lastAssessedOn === b.lastAssessedOn) return a.name.localeCompare(b.name, "en-IN")
    if (a.lastAssessedOn === null) return -1
    if (b.lastAssessedOn === null) return 1
    return a.lastAssessedOn.localeCompare(b.lastAssessedOn)
  })

  return { drafts: home.filter((player) => player.draft).length, players: home }
}

function previousPublished(
  database: SmbaDatabaseExecutor,
  playerId: string,
  { before, excludeId }: { before?: string; excludeId?: string },
) {
  return database.select().from(playerAssessments)
    .where(and(
      eq(playerAssessments.playerAccountId, playerId),
      eq(playerAssessments.status, "published"),
    ))
    .orderBy(desc(playerAssessments.assessedOn), desc(playerAssessments.createdAt))
    .all()
    .find((row) => row.id !== excludeId && (before === undefined || row.assessedOn <= before))
}

/** What the "new assessment" screen needs: the player, their open draft if any, and last time's scores. */
export function getAssessmentStart(
  playerId: string,
  coachId: string,
  { database = initializeDatabase() }: QueryContext = {},
) {
  requireHeadAdminAccess(coachId, { database })
  const row = activePlayerRows(database).find((player) => player.playerId === playerId)
  if (!row) return null
  const draft = database.select({ id: playerAssessments.id }).from(playerAssessments)
    .where(and(
      eq(playerAssessments.playerAccountId, playerId),
      eq(playerAssessments.status, "draft"),
    ))
    .get()
  const previous = previousPublished(database, playerId, {})
  return {
    draftId: draft?.id ?? null,
    player: toPlayer(row),
    previous: previous ? toPrevious(previous) : null,
  }
}

export function getCoachAssessment(
  assessmentId: string,
  coachId: string,
  { database = initializeDatabase() }: QueryContext = {},
) {
  requireHeadAdminAccess(coachId, { database })
  const row = database.select().from(playerAssessments)
    .where(eq(playerAssessments.id, assessmentId))
    .get()
  if (!row) return null
  const player = database.select({ fullName: accounts.fullName })
    .from(accounts)
    .where(eq(accounts.id, row.playerAccountId))
    .get()
  if (!player) return null
  const enrollment = database.select({
    batch: playerEnrollments.batch,
    level: playerEnrollments.level,
  }).from(playerEnrollments)
    .where(eq(playerEnrollments.accountId, row.playerAccountId))
    .get()
  const previous = previousPublished(database, row.playerAccountId, {
    before: row.assessedOn,
    excludeId: row.id,
  })
  return {
    assessment: toRecord(row, player.fullName),
    group: groupLabel(enrollment?.level ?? null, enrollment?.batch ?? null),
    previous: previous ? toPrevious(previous) : null,
  }
}

/** Every assessment for one player, drafts included, newest first. For the coach's history page. */
export function listPlayerAssessmentHistory(
  playerId: string,
  coachId: string,
  { database = initializeDatabase() }: QueryContext = {},
) {
  requireHeadAdminAccess(coachId, { database })
  const player = database.select({ fullName: accounts.fullName })
    .from(accounts)
    .where(and(eq(accounts.id, playerId), eq(accounts.role, "player")))
    .get()
  if (!player) return null
  return {
    assessments: database.select().from(playerAssessments)
      .where(eq(playerAssessments.playerAccountId, playerId))
      .orderBy(desc(playerAssessments.assessedOn), desc(playerAssessments.createdAt))
      .all()
      .map((row) => toRecord(row, player.fullName)),
    playerName: player.fullName,
  }
}

/** The player's own list: published assessments only, newest first. */
export function listPublishedAssessmentsForPlayer(
  playerId: string,
  { database = initializeDatabase() }: QueryContext = {},
) {
  const player = database.select({ fullName: accounts.fullName })
    .from(accounts)
    .where(eq(accounts.id, playerId))
    .get()
  if (!player) return []
  return database.select().from(playerAssessments)
    .where(and(
      eq(playerAssessments.playerAccountId, playerId),
      eq(playerAssessments.status, "published"),
    ))
    .orderBy(desc(playerAssessments.assessedOn), desc(playerAssessments.createdAt))
    .all()
    .map((row) => toRecord(row, player.fullName))
}

/** One published assessment for the player it belongs to, with the one before it for change. */
export function getPublishedAssessmentForPlayer(
  playerId: string,
  assessmentId: string,
  { database = initializeDatabase() }: QueryContext = {},
) {
  const row = database.select().from(playerAssessments)
    .where(and(
      eq(playerAssessments.id, assessmentId),
      eq(playerAssessments.playerAccountId, playerId),
      eq(playerAssessments.status, "published"),
    ))
    .get()
  if (!row) return null
  const player = database.select({ fullName: accounts.fullName })
    .from(accounts)
    .where(eq(accounts.id, playerId))
    .get()
  if (!player) return null
  const previous = previousPublished(database, playerId, {
    before: row.assessedOn,
    excludeId: row.id,
  })
  return {
    assessment: toRecord(row, player.fullName),
    previous: previous ? toPrevious(previous) : null,
  }
}
