import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { AnnouncementDetailView } from "@/components/announcements/announcement-detail"
import { getActivePlayerAnnouncement } from "@/lib/announcements/queries"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata: Metadata = {
  title: "Announcement",
}
export default async function PlayerAnnouncementPage({
  params,
}: {
  params: Promise<{ announcementId: string }>
}) {
  const [student, { announcementId }] = await Promise.all([
    getCurrentStudent(),
    params,
  ])
  if (!student) redirect("/login")

  const announcement = await getActivePlayerAnnouncement(
    student.identity.playerId,
    announcementId,
  )
  if (!announcement) notFound()

  return (
    <AnnouncementDetailView
      announcement={announcement}
      backHref="/player/announcements"
      backLabel="Back to announcements"
    />
  )
}
