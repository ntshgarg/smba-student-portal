import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AnnouncementDetailView } from "@/components/announcements/announcement-detail"
import { Header } from "@/components/public/public-header"
import { getActiveHomepageAnnouncement } from "@/lib/announcements/queries"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Announcement",
  description: "A current notice from Sathiya Moorthy Badminton Academy.",
}

export default async function PublicAnnouncementPage({
  params,
}: {
  params: Promise<{ announcementId: string }>
}) {
  const { announcementId } = await params
  const announcement = await getActiveHomepageAnnouncement(announcementId)
  if (!announcement) notFound()

  return (
    <div className="public-home">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header homePath="/" />
      <main id="main-content" tabIndex={-1}>
        <AnnouncementDetailView
          announcement={announcement}
          backHref="/"
          backLabel="Back to academy"
          publicView
        />
      </main>
    </div>
  )
}
