export type AnnouncementSummary = {
  id: string
  title: string
  preview: string
  publishedAt: string
  expiresOn: string | null
  pinned: boolean
}
export type AnnouncementDetail = Omit<AnnouncementSummary, "preview"> & {
  content: string
}
