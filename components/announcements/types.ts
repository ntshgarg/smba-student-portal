export type AnnouncementSummary = {
  id: string
  title: string
  preview: string
  publishedAt: string
  expiresOn: string | null
  pinned: boolean
  /** Server's academy-clock answer; the badge prefers it over the device clock. */
  isNew?: boolean
}
export type AnnouncementDetail = Omit<AnnouncementSummary, "preview"> & {
  content: string
}
