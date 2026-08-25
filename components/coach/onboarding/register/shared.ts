import type { ActionFeedback } from "@/components/inline-notice"
import type { PlayerOnboardingStage } from "@/lib/coach/onboarding"
import { formatDateKey } from "@/lib/format"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
export type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

export const STAGES: Array<{
  key: PlayerOnboardingStage
  label: string
  summaryKey: "newRequests" | "assessment" | "session" | "feePlan"
}> = [
  { key: "request", label: "New requests", summaryKey: "newRequests" },
  { key: "assessment", label: "Assessment", summaryKey: "assessment" },
  { key: "session", label: "Session", summaryKey: "session" },
  { key: "feePlan", label: "Fee Plan", summaryKey: "feePlan" },
]

export function folio(index: number) {
  return String(index + 1).padStart(2, "0")
}

export function shortDate(value: string) {
  return formatDateKey(value.slice(0, 10), {
    day: "numeric",
    month: "short",
    weekday: undefined,
    year: undefined,
  })
}
