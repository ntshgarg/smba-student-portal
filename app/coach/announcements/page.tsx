import { PublishedAnnouncementArchive } from "@/components/coach/announcements/announcement-archive"
import type {
  AnnouncementChannel,
  AnnouncementStatus,
} from "@/lib/announcements/contracts"
import { listCoachAnnouncements } from "@/lib/announcements/queries"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getAcademyMonthKey } from "@/lib/format"

export const metadata = {
  title: "Published announcements",
}

type AnnouncementSearchParams = {
  channel?: string | string[]
  month?: string | string[]
  published?: string | string[]
  q?: string | string[]
  status?: string | string[]
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function normalizedStatus(value: string | undefined): AnnouncementStatus | "all" {
  return value === "active" || value === "expired" || value === "withdrawn"
    ? value
    : "all"
}

function normalizedChannel(value: string | undefined): AnnouncementChannel | "all" {
  return value === "homepage" || value === "player_dashboard" ? value : "all"
}

export default async function PublishedAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<AnnouncementSearchParams>
}) {
  const [query, { identity }] = await Promise.all([
    searchParams,
    requireHeadAdminPage(),
  ])
  const currentMonth = getAcademyMonthKey()
  const requestedMonth = firstValue(query.month)
  const month = requestedMonth && MONTH_PATTERN.test(requestedMonth)
    ? requestedMonth
    : currentMonth
  const search = (firstValue(query.q) ?? "").trim().slice(0, 120)
  const status = normalizedStatus(firstValue(query.status))
  const channel = normalizedChannel(firstValue(query.channel))
  const context = { coachId: identity.subjectId }
  const announcements = listCoachAnnouncements({
    channel,
    month,
    search,
    status,
  }, context)
  const hasPublishedAnnouncements = listCoachAnnouncements({}, context).length > 0

  return (
    <PublishedAnnouncementArchive
      announcements={announcements}
      currentMonth={currentMonth}
      hasPublishedAnnouncements={hasPublishedAnnouncements}
      query={{ channel, month, query: search, status }}
    />
  )
}
