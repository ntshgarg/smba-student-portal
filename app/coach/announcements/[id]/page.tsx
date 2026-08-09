import { notFound } from "next/navigation"

import { PublishedAnnouncementDetail } from "@/components/coach/announcements/announcement-detail"
import { getCoachAnnouncement } from "@/lib/announcements/queries"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"

export const metadata = {
  title: "Published announcement",
}

type AnnouncementDetailSearchParams = {
  channel?: string | string[]
  month?: string | string[]
  published?: string | string[]
  q?: string | string[]
  status?: string | string[]
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function archiveHref(query: AnnouncementDetailSearchParams) {
  const parameters = new URLSearchParams()
  const month = firstValue(query.month)
  const search = firstValue(query.q)?.trim()
  const status = firstValue(query.status)
  const channel = firstValue(query.channel)
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) parameters.set("month", month)
  if (search) parameters.set("q", search.slice(0, 120))
  if (status === "active" || status === "expired" || status === "withdrawn") {
    parameters.set("status", status)
  }
  if (channel === "homepage" || channel === "player_dashboard") {
    parameters.set("channel", channel)
  }
  const encoded = parameters.toString()
  return `/coach/announcements${encoded ? `?${encoded}` : ""}`
}

export default async function PublishedAnnouncementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<AnnouncementDetailSearchParams>
}) {
  const [{ id }, query, { identity }] = await Promise.all([
    params,
    searchParams,
    requireHeadAdminPage(),
  ])
  const announcement = getCoachAnnouncement(id, { coachId: identity.subjectId })
  if (!announcement) notFound()

  return (
    <PublishedAnnouncementDetail
      announcement={announcement}
      backHref={archiveHref(query)}
      publishedNow={firstValue(query.published) === "1"}
    />
  )
}
