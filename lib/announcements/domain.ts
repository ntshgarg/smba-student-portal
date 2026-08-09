import { getAcademyDateKey } from "@/lib/format"
import type { AnnouncementStatus } from "@/lib/announcements/contracts"

const DAY_IN_MILLISECONDS = 86_400_000

function dateKeyDayNumber(dateKey: string) {
  return Date.parse(`${dateKey}T00:00:00.000Z`) / DAY_IN_MILLISECONDS
}

export function announcementPreview(content: string, maximumLength = 180) {
  const compact = content.replace(/\s+/gu, " ").trim()
  if (compact.length <= maximumLength) return compact

  const shortened = compact.slice(0, Math.max(1, maximumLength - 1)).trimEnd()
  const wordBoundary = shortened.lastIndexOf(" ")
  const preview = wordBoundary >= Math.floor(maximumLength * 0.6)
    ? shortened.slice(0, wordBoundary)
    : shortened
  return `${preview}…`
}

export function getAnnouncementStatus(
  input: { expiresOn: string | null; withdrawnAt: Date | null },
  now = new Date(),
): AnnouncementStatus {
  if (input.withdrawnAt) return "withdrawn"
  if (input.expiresOn && input.expiresOn < getAcademyDateKey(now)) return "expired"
  return "active"
}

export function isAnnouncementNew(publishedAt: Date, now = new Date()) {
  const ageInAcademyDays = dateKeyDayNumber(getAcademyDateKey(now))
    - dateKeyDayNumber(getAcademyDateKey(publishedAt))
  return ageInAcademyDays >= 0 && ageInAcademyDays < 7
}
