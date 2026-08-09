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

export function announcementStatusLabel(status: AnnouncementStatus) {
  if (status === "withdrawn") return "Withdrawn"
  if (status === "expired") return "Expired"
  return "Active"
}
