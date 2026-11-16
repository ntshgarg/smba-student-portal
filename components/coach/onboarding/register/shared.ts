import type { ActionFeedback } from "@/components/inline-notice"
import type { PlayerOnboardingStage } from "@/lib/coach/onboarding"
import { formatAcademyDate, formatDateKey } from "@/lib/format"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
export type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

/**
 * `label` counts a stage across the queue ("New requests"); `tabLabel` names the
 * one step a person is on, in the open record's tabs and the queue row's pill.
 * Each tab label is a prefix of its `label` or names the same step, so the tab
 * buttons' aria-labels, which use `label`, still match what is painted.
 */
export const STAGES: Array<{
  key: PlayerOnboardingStage
  label: string
  tabLabel: string
  summaryKey: "newRequests" | "assessment" | "session" | "feePlan"
}> = [
  { key: "request", label: "New requests", tabLabel: "Request", summaryKey: "newRequests" },
  { key: "assessment", label: "Assessment", tabLabel: "Assessment", summaryKey: "assessment" },
  { key: "session", label: "Session", tabLabel: "Session", summaryKey: "session" },
  { key: "feePlan", label: "Fee Plan", tabLabel: "Fee plan", summaryKey: "feePlan" },
]

export function shortDate(value: string) {
  return formatDateKey(value.slice(0, 10), {
    day: "numeric",
    month: "short",
    weekday: undefined,
    year: undefined,
  })
}

/** For a moment in time (requested, rejected), read in India time; `shortDate` is for date-only keys. */
export function shortInstant(value: string) {
  return formatAcademyDate(value, { month: "short", year: undefined })
}
