export type AnnouncementSummary = {
  id: string
  title: string
  preview: string
  publishedAt: string
  expiresOn: string | null
  pinned: boolean
  /**
   * Worked out by the server against the academy clock, for players. When it
   * is present the badge uses it rather than recomputing against this device's
   * clock, so the server and the screen cannot disagree about "New".
   */
  isNew?: boolean
}
export type AnnouncementDetail = Omit<AnnouncementSummary, "preview"> & {
  content: string
}
