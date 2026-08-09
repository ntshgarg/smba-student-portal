import "server-only"

import { and, desc, eq, gte, isNull, or } from "drizzle-orm"

import type {
  AnnouncementChannel,
  CoachAnnouncement,
  CoachAnnouncementArchiveFilters,
  CoachAnnouncementArchiveItem,
  PlayerAnnouncementDetail,
  PlayerAnnouncementSummary,
  PublicAnnouncementDetail,
  PublicAnnouncementSummary,
} from "@/lib/announcements/contracts"
import {
  announcementPreview,
  getAnnouncementStatus,
  isAnnouncementNew,
} from "@/lib/announcements/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import {
  initializeDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  accounts,
  broadcastAudienceTargets,
  broadcastChannels,
  broadcasts,
  broadcastWithdrawals,
} from "@/lib/db/schema"
import { getAcademyDateKey, getAcademyMonthKey } from "@/lib/format"

type AnnouncementQueryOptions = {
  database?: SmbaDatabaseExecutor
  now?: Date
}

type CoachAnnouncementQueryOptions = AnnouncementQueryOptions & {
  coachId: string
}

const baseSelection = {
  content: broadcasts.content,
  expiresOn: broadcasts.expiresOn,
  id: broadcasts.id,
  pinned: broadcasts.pinned,
  presentationRevision: broadcasts.presentationRevision,
  publishedAt: broadcasts.publishedAt,
  publishedByAccountId: broadcasts.publishedByAccountId,
  title: broadcasts.title,
  withdrawalReason: broadcastWithdrawals.reason,
  withdrawnAt: broadcastWithdrawals.withdrawnAt,
  withdrawnByAccountId: broadcastWithdrawals.withdrawnByAccountId,
}

type BaseRow = {
  content: string
  expiresOn: string | null
  id: string
  pinned: boolean
  presentationRevision: number
  publishedAt: Date
  publishedByAccountId: string
  title: string
  withdrawalReason: string | null
  withdrawnAt: Date | null
  withdrawnByAccountId: string | null
}

function listChannels(database: SmbaDatabaseExecutor, announcementId: string) {
  return database.select({ channel: broadcastChannels.channel })
    .from(broadcastChannels)
    .where(eq(broadcastChannels.broadcastId, announcementId))
    .all()
    .map(({ channel }) => channel)
    .sort() as AnnouncementChannel[]
}

function coachAnnouncementFromRow(
  row: BaseRow,
  channels: AnnouncementChannel[],
  now: Date,
): CoachAnnouncement {
  return {
    id: row.id,
    audience: "everyone",
    channels,
    content: row.content,
    expiresOn: row.expiresOn,
    pinned: row.pinned,
    presentationRevision: row.presentationRevision,
    publishedAt: row.publishedAt.toISOString(),
    publishedByAccountId: row.publishedByAccountId,
    status: getAnnouncementStatus({
      expiresOn: row.expiresOn,
      withdrawnAt: row.withdrawnAt,
    }, now),
    title: row.title,
    withdrawal: row.withdrawnAt && row.withdrawalReason && row.withdrawnByAccountId
      ? {
          reason: row.withdrawalReason,
          withdrawnAt: row.withdrawnAt.toISOString(),
          withdrawnByAccountId: row.withdrawnByAccountId,
        }
      : null,
  }
}

function activeChannelRows(
  channel: AnnouncementChannel,
  database: SmbaDatabaseExecutor,
  now: Date,
) {
  const academyDate = getAcademyDateKey(now)
  return database.select({
    content: broadcasts.content,
    expiresOn: broadcasts.expiresOn,
    id: broadcasts.id,
    pinned: broadcasts.pinned,
    publishedAt: broadcasts.publishedAt,
    title: broadcasts.title,
  }).from(broadcasts)
    .innerJoin(
      broadcastAudienceTargets,
      and(
        eq(broadcastAudienceTargets.broadcastId, broadcasts.id),
        eq(broadcastAudienceTargets.audience, "everyone"),
      ),
    )
    .innerJoin(
      broadcastChannels,
      and(
        eq(broadcastChannels.broadcastId, broadcasts.id),
        eq(broadcastChannels.channel, channel),
      ),
    )
    .leftJoin(
      broadcastWithdrawals,
      eq(broadcastWithdrawals.broadcastId, broadcasts.id),
    )
    .where(and(
      isNull(broadcastWithdrawals.broadcastId),
      or(isNull(broadcasts.expiresOn), gte(broadcasts.expiresOn, academyDate)),
    ))
    .orderBy(desc(broadcasts.pinned), desc(broadcasts.publishedAt), desc(broadcasts.id))
    .all()
}

function publicSummary(row: ReturnType<typeof activeChannelRows>[number]): PublicAnnouncementSummary {
  return {
    id: row.id,
    title: row.title,
    preview: announcementPreview(row.content),
    publishedAt: row.publishedAt.toISOString(),
    expiresOn: row.expiresOn,
    pinned: row.pinned,
  }
}

function playerIsEligible(database: SmbaDatabaseExecutor, playerId: string) {
  return Boolean(database.select({ id: accounts.id }).from(accounts).where(and(
    eq(accounts.id, playerId),
    eq(accounts.role, "player"),
    eq(accounts.approvalStatus, "approved"),
    isNull(accounts.archivedAt),
  )).get())
}

export function getCoachAnnouncement(
  announcementId: string,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachAnnouncementQueryOptions,
): CoachAnnouncement | null {
  requireHeadAdminAccess(coachId, { database })
  const row = database.select(baseSelection).from(broadcasts)
    .innerJoin(
      broadcastAudienceTargets,
      and(
        eq(broadcastAudienceTargets.broadcastId, broadcasts.id),
        eq(broadcastAudienceTargets.audience, "everyone"),
      ),
    )
    .leftJoin(
      broadcastWithdrawals,
      eq(broadcastWithdrawals.broadcastId, broadcasts.id),
    )
    .where(eq(broadcasts.id, announcementId))
    .get()
  if (!row) return null
  return coachAnnouncementFromRow(row, listChannels(database, row.id), now)
}

export function listCoachAnnouncements(
  filters: CoachAnnouncementArchiveFilters = {},
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachAnnouncementQueryOptions,
): CoachAnnouncementArchiveItem[] {
  requireHeadAdminAccess(coachId, { database })
  const search = filters.search?.trim().toLocaleLowerCase("en-IN") ?? ""
  const rows = database.select(baseSelection).from(broadcasts)
    .innerJoin(
      broadcastAudienceTargets,
      and(
        eq(broadcastAudienceTargets.broadcastId, broadcasts.id),
        eq(broadcastAudienceTargets.audience, "everyone"),
      ),
    )
    .leftJoin(
      broadcastWithdrawals,
      eq(broadcastWithdrawals.broadcastId, broadcasts.id),
    )
    .orderBy(desc(broadcasts.publishedAt), desc(broadcasts.id))
    .all()

  return rows.flatMap((row) => {
    const announcement = coachAnnouncementFromRow(row, listChannels(database, row.id), now)
    if (filters.month && getAcademyMonthKey(row.publishedAt) !== filters.month) return []
    if (filters.status && filters.status !== "all" && announcement.status !== filters.status) {
      return []
    }
    if (filters.channel && filters.channel !== "all"
      && !announcement.channels.includes(filters.channel)) {
      return []
    }
    if (search && !`${announcement.title}\n${announcement.content}`
      .toLocaleLowerCase("en-IN").includes(search)) {
      return []
    }
    return [{
      id: announcement.id,
      audience: announcement.audience,
      channels: announcement.channels,
      expiresOn: announcement.expiresOn,
      pinned: announcement.pinned,
      presentationRevision: announcement.presentationRevision,
      preview: announcementPreview(announcement.content),
      publishedAt: announcement.publishedAt,
      publishedByAccountId: announcement.publishedByAccountId,
      status: announcement.status,
      title: announcement.title,
      withdrawal: announcement.withdrawal,
    }]
  })
}

export function listActiveHomepageAnnouncements(
  options: AnnouncementQueryOptions = {},
): PublicAnnouncementSummary[] {
  try {
    const database = options.database ?? initializeDatabase()
    const now = options.now ?? new Date()
    return activeChannelRows("homepage", database, now).map(publicSummary)
  } catch {
    return []
  }
}

export function getActiveHomepageAnnouncement(
  announcementId: string,
  options: AnnouncementQueryOptions = {},
): PublicAnnouncementDetail | null {
  try {
    const database = options.database ?? initializeDatabase()
    const now = options.now ?? new Date()
    const row = activeChannelRows("homepage", database, now)
      .find(({ id }) => id === announcementId)
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      publishedAt: row.publishedAt.toISOString(),
      expiresOn: row.expiresOn,
      pinned: row.pinned,
    }
  } catch {
    return null
  }
}

export function listActivePlayerAnnouncements(
  playerId: string,
  options: AnnouncementQueryOptions = {},
): PlayerAnnouncementSummary[] {
  const database = options.database ?? initializeDatabase()
  const now = options.now ?? new Date()
  if (!playerIsEligible(database, playerId)) return []
  return activeChannelRows("player_dashboard", database, now).map((row) => ({
    ...publicSummary(row),
    isNew: isAnnouncementNew(row.publishedAt, now),
  }))
}

export function getActivePlayerAnnouncement(
  playerId: string,
  announcementId: string,
  options: AnnouncementQueryOptions = {},
): PlayerAnnouncementDetail | null {
  const database = options.database ?? initializeDatabase()
  const now = options.now ?? new Date()
  if (!playerIsEligible(database, playerId)) return null
  const row = activeChannelRows("player_dashboard", database, now)
    .find(({ id }) => id === announcementId)
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    publishedAt: row.publishedAt.toISOString(),
    expiresOn: row.expiresOn,
    pinned: row.pinned,
    isNew: isAnnouncementNew(row.publishedAt, now),
  }
}
