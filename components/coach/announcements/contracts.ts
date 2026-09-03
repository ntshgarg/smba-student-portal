import type {
  AnnouncementChannel,
  AnnouncementStatus,
  CoachAnnouncement,
  CoachAnnouncementArchiveItem,
} from "@/lib/announcements/contracts"

export type {
  AnnouncementChannel,
  AnnouncementStatus,
}

export type CoachAnnouncementSummary = CoachAnnouncementArchiveItem

export type CoachAnnouncementDetail = CoachAnnouncement

export function announcementChannelLabel(channel: AnnouncementChannel) {
  return channel === "homepage" ? "Homepage" : "Player Dashboard"
}

/**
 * Who can actually read a channel, in the words a coach needs before they send.
 *
 * "Homepage" reads like the academy's own page -- somewhere families go. It is
 * the public internet: the endpoint behind it takes no session, and anything
 * published there can be fetched, cached and indexed by anyone. A coach
 * deciding whether a child's name belongs in a message is deciding that against
 * this, so it has to be on screen rather than in a docs page.
 */
export function announcementChannelAudience(channel: AnnouncementChannel) {
  return channel === "homepage"
    ? "Anyone on the internet"
    : "Signed-in families only"
}

export function announcementChannelIsPublic(channel: AnnouncementChannel) {
  return channel === "homepage"
}

export function announcementStatusLabel(status: AnnouncementStatus) {
  if (status === "withdrawn") return "Withdrawn"
  if (status === "expired") return "Expired"
  return "Active"
}
