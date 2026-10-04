import type { AssessmentSection } from "@/lib/assessments/rubric"
import { formatDateKey } from "@/lib/format"

/** "9 Aug 2026" for a YYYY-MM-DD key. */
export function formatAssessmentDate(dateKey: string) {
  return formatDateKey(dateKey, {
    day: "numeric",
    month: "short",
    weekday: undefined,
    year: "numeric",
  })
}

export function daysBetween(fromKey: string, toKey: string) {
  const from = Date.parse(`${fromKey}T00:00:00Z`)
  const to = Date.parse(`${toKey}T00:00:00Z`)
  return Math.round((to - from) / 86_400_000)
}

export function describeDaysAgo(dateKey: string, todayKey: string) {
  const days = daysBetween(dateKey, todayKey)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}

/**
 * Each section's accent, taken from the portal's own palette rather than new
 * colours, so the coach can tell sections apart at a glance without the form
 * looking like another site.
 */
const SECTION_TONES: Readonly<Record<string, string>> = {
  discipline: "var(--makeup-dark)",
  game: "var(--red)",
  movement: "var(--green)",
  overall: "var(--steel)",
  technical: "var(--navy)",
}

export function sectionTone(section: Pick<AssessmentSection, "id">) {
  return SECTION_TONES[section.id] ?? "var(--navy)"
}

export function formatChange(change: number) {
  if (Math.abs(change) < 0.05) return "No change"
  return `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}`
}
