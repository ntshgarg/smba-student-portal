import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import {
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_CONTENT_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  ANNOUNCEMENT_WITHDRAWAL_REASON_MAX_LENGTH,
  type AnnouncementChannel,
  type AnnouncementMutationCode,
  type AnnouncementMutationField,
  type PublishAnnouncementInput,
  type PublishAnnouncementResult,
  type SetAnnouncementPinnedInput,
  type WithdrawAnnouncementInput,
} from "@/lib/announcements/contracts"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { initializeDatabase, type SmbaDatabase } from "@/lib/db/client"
import {
  broadcastAudienceTargets,
  broadcastChannels,
  broadcasts,
  broadcastWithdrawals,
} from "@/lib/db/schema"
import { getAcademyDateKey } from "@/lib/format"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u

export class AnnouncementServiceError extends Error {
  readonly code: AnnouncementMutationCode
  readonly field?: AnnouncementMutationField

  constructor(
    code: AnnouncementMutationCode,
    message: string,
    field?: AnnouncementMutationField,
  ) {
    super(message)
    this.name = "AnnouncementServiceError"
    this.code = code
    this.field = field
  }
}

type AnnouncementServiceContext = {
  coachId: string
  createId?: () => string
  database?: SmbaDatabase
  now?: Date
}

type ValidatedPublication = {
  channels: AnnouncementChannel[]
  content: string
  expiresOn: string | null
  fingerprint: string
  pinned: boolean
  publicationKey: string
  title: string
}

function fail(
  code: AnnouncementMutationCode,
  message: string,
  field?: AnnouncementMutationField,
): never {
  throw new AnnouncementServiceError(code, message, field)
}

function normalizedContent(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\r\n?/gu, "\n").trim()
    : ""
}

function normalizedSingleLine(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : ""
}

function validDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function publicationFingerprint(input: Omit<ValidatedPublication, "fingerprint">) {
  return createHash("sha256").update(JSON.stringify({
    audience: "everyone",
    channels: input.channels,
    content: input.content,
    expiresOn: input.expiresOn,
    pinned: input.pinned,
    title: input.title,
  })).digest("hex")
}

function validatePublication(input: PublishAnnouncementInput, now: Date): ValidatedPublication {
  const title = normalizedSingleLine(input?.title)
  if (!title || title.length > ANNOUNCEMENT_TITLE_MAX_LENGTH) {
    fail(
      "INVALID_INPUT",
      `Enter a title of up to ${ANNOUNCEMENT_TITLE_MAX_LENGTH} characters.`,
      "title",
    )
  }

  const content = normalizedContent(input?.content)
  if (!content || content.length > ANNOUNCEMENT_CONTENT_MAX_LENGTH || content.includes("\u0000")) {
    fail(
      "INVALID_INPUT",
      `Enter a message of up to ${ANNOUNCEMENT_CONTENT_MAX_LENGTH.toLocaleString("en-IN")} characters.`,
      "content",
    )
  }

  if (!Array.isArray(input?.channels)) {
    fail("INVALID_INPUT", "Choose where the announcement should appear.", "channels")
  }
  const requestedChannels = input.channels as unknown[]
  const allowedChannels = new Set<string>(ANNOUNCEMENT_CHANNELS)
  if (requestedChannels.some((channel) => (
    typeof channel !== "string" || !allowedChannels.has(channel)
  ))) {
    fail("INVALID_INPUT", "Choose valid announcement locations.", "channels")
  }
  const channels = [...new Set(requestedChannels as AnnouncementChannel[])].sort()
  if (!channels.length) {
    fail("INVALID_INPUT", "Choose where the announcement should appear.", "channels")
  }

  if (input?.pinned !== undefined && typeof input.pinned !== "boolean") {
    fail("INVALID_INPUT", "Choose a valid pin setting.")
  }
  const pinned = input?.pinned ?? false
  if (input?.expiresOn !== undefined && input.expiresOn !== null
    && typeof input.expiresOn !== "string") {
    fail("INVALID_INPUT", "Choose a valid expiry date.", "expiresOn")
  }
  const expiresOn = typeof input?.expiresOn === "string" && input.expiresOn.trim()
    ? input.expiresOn.trim()
    : null
  if (expiresOn && (!validDateKey(expiresOn) || expiresOn < getAcademyDateKey(now))) {
    fail(
      "INVALID_INPUT",
      "Expiry must be today or a later academy date.",
      "expiresOn",
    )
  }

  const publicationKey = normalizedSingleLine(input?.publicationKey)
  if (!UUID_PATTERN.test(publicationKey)) {
    fail(
      "INVALID_INPUT",
      "The publication request is invalid. Please review the announcement again.",
      "publicationKey",
    )
  }

  const canonical = { channels, content, expiresOn, pinned, publicationKey, title }
  return { ...canonical, fingerprint: publicationFingerprint(canonical) }
}

function validateAnnouncementId(value: unknown) {
  const announcementId = normalizedSingleLine(value)
  if (!UUID_PATTERN.test(announcementId)) {
    fail("INVALID_INPUT", "The announcement is invalid.", "announcementId")
  }
  return announcementId
}

async function loadCoachAnnouncement(
  announcementId: string,
  context: AnnouncementServiceContext,
) {
  const { getCoachAnnouncement } = await import("@/lib/announcements/queries")
  const announcement = getCoachAnnouncement(announcementId, {
    coachId: context.coachId,
    database: context.database,
    now: context.now,
  })
  if (!announcement) fail("NOT_FOUND", "The announcement could not be found.", "announcementId")
  return announcement
}

export async function publishAnnouncement(
  input: PublishAnnouncementInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: AnnouncementServiceContext,
): Promise<PublishAnnouncementResult> {
  requireHeadAdminAccess(coachId, { database })
  const validated = validatePublication(input, now)

  const publication = database.transaction((tx) => {
    requireHeadAdminAccess(coachId, { database: tx })
    const existing = tx.select({
      id: broadcasts.id,
      payloadFingerprint: broadcasts.payloadFingerprint,
    }).from(broadcasts)
      .where(eq(broadcasts.publicationKey, validated.publicationKey))
      .get()
    if (existing) {
      if (existing.payloadFingerprint !== validated.fingerprint) {
        fail(
          "PUBLICATION_CONFLICT",
          "This publication request was already used for a different announcement.",
          "publicationKey",
        )
      }
      return { announcementId: existing.id, reusedPublication: true }
    }

    const announcementId = createId()
    tx.insert(broadcasts).values({
      id: announcementId,
      title: validated.title,
      content: validated.content,
      publishedByAccountId: coachId,
      publishedAt: now,
      expiresOn: validated.expiresOn,
      publicationKey: validated.publicationKey,
      payloadFingerprint: validated.fingerprint,
      pinned: validated.pinned,
      presentationRevision: 0,
      presentationUpdatedByAccountId: coachId,
      presentationUpdatedAt: now,
    }).run()
    tx.insert(broadcastAudienceTargets).values({
      audience: "everyone",
      broadcastId: announcementId,
    }).run()
    tx.insert(broadcastChannels).values(validated.channels.map((channel) => ({
      broadcastId: announcementId,
      channel,
    }))).run()
    return { announcementId, reusedPublication: false }
  }, { behavior: "immediate" })

  const announcement = await loadCoachAnnouncement(publication.announcementId, {
    coachId,
    database,
    now,
  })
  return { announcement, reusedPublication: publication.reusedPublication }
}

export async function setAnnouncementPinned(
  input: SetAnnouncementPinnedInput,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: AnnouncementServiceContext,
) {
  requireHeadAdminAccess(coachId, { database })
  const announcementId = validateAnnouncementId(input?.announcementId)
  if (typeof input?.pinned !== "boolean") {
    fail("INVALID_INPUT", "Choose a valid pin setting.")
  }
  if (!Number.isSafeInteger(input?.expectedPresentationRevision)
    || input.expectedPresentationRevision < 0) {
    fail(
      "INVALID_INPUT",
      "The announcement version is invalid. Refresh and try again.",
      "expectedPresentationRevision",
    )
  }

  const result = database.transaction((tx) => {
    requireHeadAdminAccess(coachId, { database: tx })
    const current = tx.select({
      pinned: broadcasts.pinned,
      presentationRevision: broadcasts.presentationRevision,
      withdrawnAt: broadcastWithdrawals.withdrawnAt,
    }).from(broadcasts)
      .leftJoin(
        broadcastWithdrawals,
        eq(broadcastWithdrawals.broadcastId, broadcasts.id),
      )
      .where(eq(broadcasts.id, announcementId))
      .get()
    if (!current) fail("NOT_FOUND", "The announcement could not be found.", "announcementId")
    if (current.withdrawnAt) {
      fail("ALREADY_WITHDRAWN", "A withdrawn announcement cannot be pinned.", "announcementId")
    }
    if (current.pinned === input.pinned) return { reused: true }
    if (current.presentationRevision !== input.expectedPresentationRevision) {
      fail(
        "REVISION_CONFLICT",
        "This announcement changed in another window. Refresh and try again.",
        "expectedPresentationRevision",
      )
    }

    const updated = tx.update(broadcasts).set({
      pinned: input.pinned,
      presentationRevision: current.presentationRevision + 1,
      presentationUpdatedByAccountId: coachId,
      presentationUpdatedAt: now,
    }).where(and(
      eq(broadcasts.id, announcementId),
      eq(broadcasts.presentationRevision, current.presentationRevision),
    )).run()
    if (updated.changes !== 1) {
      fail(
        "REVISION_CONFLICT",
        "This announcement changed in another window. Refresh and try again.",
        "expectedPresentationRevision",
      )
    }
    return { reused: false }
  }, { behavior: "immediate" })

  return {
    announcement: await loadCoachAnnouncement(announcementId, { coachId, database, now }),
    reused: result.reused,
  }
}

export async function withdrawAnnouncement(
  input: WithdrawAnnouncementInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: AnnouncementServiceContext,
) {
  requireHeadAdminAccess(coachId, { database })
  const announcementId = validateAnnouncementId(input?.announcementId)
  const reason = normalizedSingleLine(input?.reason)
  if (!reason || reason.length > ANNOUNCEMENT_WITHDRAWAL_REASON_MAX_LENGTH) {
    fail(
      "INVALID_INPUT",
      `Enter a withdrawal reason of up to ${ANNOUNCEMENT_WITHDRAWAL_REASON_MAX_LENGTH} characters.`,
      "reason",
    )
  }

  const result = database.transaction((tx) => {
    requireHeadAdminAccess(coachId, { database: tx })
    const announcement = tx.select({ id: broadcasts.id }).from(broadcasts)
      .where(eq(broadcasts.id, announcementId)).get()
    if (!announcement) fail("NOT_FOUND", "The announcement could not be found.", "announcementId")

    const existing = tx.select({ reason: broadcastWithdrawals.reason })
      .from(broadcastWithdrawals)
      .where(eq(broadcastWithdrawals.broadcastId, announcementId))
      .get()
    if (existing) {
      if (existing.reason === reason) return { reused: true }
      fail(
        "ALREADY_WITHDRAWN",
        "This announcement has already been withdrawn.",
        "announcementId",
      )
    }

    tx.insert(broadcastWithdrawals).values({
      id: createId(),
      broadcastId: announcementId,
      reason,
      withdrawnByAccountId: coachId,
      withdrawnAt: now,
    }).run()
    return { reused: false }
  }, { behavior: "immediate" })

  return {
    announcement: await loadCoachAnnouncement(announcementId, { coachId, database, now }),
    reused: result.reused,
  }
}
