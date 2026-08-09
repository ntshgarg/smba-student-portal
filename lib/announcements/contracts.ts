export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 120
export const ANNOUNCEMENT_CONTENT_MAX_LENGTH = 5_000
export const ANNOUNCEMENT_WITHDRAWAL_REASON_MAX_LENGTH = 250

export const ANNOUNCEMENT_CHANNELS = ["homepage", "player_dashboard"] as const

export type AnnouncementChannel = (typeof ANNOUNCEMENT_CHANNELS)[number]
export type AnnouncementAudience = "everyone"
export type AnnouncementStatus = "active" | "expired" | "withdrawn"

export type PublishAnnouncementInput = {
  title: string
  content: string
  channels: readonly AnnouncementChannel[]
  pinned?: boolean
  expiresOn?: string | null
  publicationKey: string
}

export type SetAnnouncementPinnedInput = {
  announcementId: string
  pinned: boolean
  expectedPresentationRevision: number
}

export type WithdrawAnnouncementInput = {
  announcementId: string
  reason: string
}

export type AnnouncementMutationCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PUBLICATION_CONFLICT"
  | "REVISION_CONFLICT"
  | "ALREADY_WITHDRAWN"

export type AnnouncementMutationField =
  | "announcementId"
  | "channels"
  | "content"
  | "expiresOn"
  | "expectedPresentationRevision"
  | "publicationKey"
  | "reason"
  | "title"

export type AnnouncementWithdrawal = {
  reason: string
  withdrawnAt: string
  withdrawnByAccountId: string
}

export type CoachAnnouncement = {
  id: string
  audience: AnnouncementAudience
  channels: AnnouncementChannel[]
  content: string
  expiresOn: string | null
  pinned: boolean
  presentationRevision: number
  publishedAt: string
  publishedByAccountId: string
  status: AnnouncementStatus
  title: string
  withdrawal: AnnouncementWithdrawal | null
}

export type CoachAnnouncementArchiveItem = Omit<CoachAnnouncement, "content"> & {
  preview: string
}

export type PublicAnnouncementSummary = {
  id: string
  title: string
  preview: string
  publishedAt: string
  expiresOn: string | null
  pinned: boolean
}

export type PublicAnnouncementDetail = Omit<PublicAnnouncementSummary, "preview"> & {
  content: string
}

export type PlayerAnnouncementSummary = PublicAnnouncementSummary & {
  isNew: boolean
}

export type PlayerAnnouncementDetail = Omit<PlayerAnnouncementSummary, "preview"> & {
  content: string
}

export type PublishAnnouncementResult = {
  announcement: CoachAnnouncement
  reusedPublication: boolean
}

export type AnnouncementActionResult =
  | {
      ok: true
      announcement: CoachAnnouncement
      message: string
      reused?: boolean
    }
  | {
      ok: false
      code: AnnouncementMutationCode
      field?: AnnouncementMutationField
      message: string
    }

export type CoachAnnouncementArchiveFilters = {
  channel?: AnnouncementChannel | "all"
  month?: string
  search?: string
  status?: AnnouncementStatus | "all"
}
