import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AnnouncementDetailView } from "@/components/announcements/announcement-detail"
import { Header } from "@/components/public/public-header"
import { announcementPreview } from "@/lib/announcements/domain"
import { getActiveHomepageAnnouncement } from "@/lib/announcements/queries"

export const dynamic = "force-dynamic"

const FALLBACK_DESCRIPTION = "A current notice from Sathiya Moorthy Badminton Academy."

// A notice gets its own title and address in search results and link previews, not
// the generic "Announcement". An expired or withdrawn notice is a 404 below, so a
// stale one drops out on its own; the fallback only covers the case where the lookup
// finds nothing, which the page itself answers with notFound().
export async function generateMetadata({
  params,
}: {
  params: Promise<{ announcementId: string }>
}): Promise<Metadata> {
  const { announcementId } = await params
  const announcement = await getActiveHomepageAnnouncement(announcementId)
  if (!announcement) return { title: "Announcement", description: FALLBACK_DESCRIPTION }

  const description = announcementPreview(announcement.content, 155) || FALLBACK_DESCRIPTION

  return {
    title: announcement.title,
    description,
    alternates: { canonical: `/announcements/${announcementId}` },
    // `openGraph` replaces the root layout's object rather than merging into it, so
    // the site name, locale and preview image are repeated here.
    openGraph: {
      type: "article",
      url: `/announcements/${announcementId}`,
      locale: "en_IN",
      siteName: "Sathiya Moorthy Badminton Academy",
      title: announcement.title,
      description,
      images: [{
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Sathiya Moorthy Badminton Academy",
      }],
    },
  }
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
