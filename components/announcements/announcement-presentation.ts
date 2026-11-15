import { formatAcademyDate, getAcademyDateKey } from "@/lib/format"

import type { AnnouncementSummary } from "@/components/announcements/types"

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000

function dateKeyMilliseconds(value: string) {
  return Date.parse(`${value}T00:00:00.000Z`)
}

export function announcementDate(value: string) {
  return formatAcademyDate(value, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

// Always three letters: the academy's en-IN format would write September as "Sept"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/** The day a notice went out on the academy's calendar: the day of the month as two digits, and the month
 * in three letters. */
export function announcementDay(value: string) {
  const key = getAcademyDateKey(value)
  return { day: key.slice(8), month: MONTHS[Number(key.slice(5, 7)) - 1] }
}

export function announcementIsNew(publishedAt: string, referenceDate = new Date()) {
  const publishedDate = dateKeyMilliseconds(getAcademyDateKey(publishedAt))
  const currentDate = dateKeyMilliseconds(getAcademyDateKey(referenceDate))
  const elapsedDays = Math.floor((currentDate - publishedDate) / DAY_MILLISECONDS)

  return elapsedDays >= 0 && elapsedDays < 7
}

export function announcementParagraphs(content: string) {
  return content.trim().split(/\n\s*\n/u)
}

export function sortAnnouncements<T extends Pick<AnnouncementSummary, "pinned" | "publishedAt">>(
  announcements: readonly T[],
) {
  return [...announcements].sort((left, right) => (
    Number(right.pinned) - Number(left.pinned)
    || Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
  ))
}
