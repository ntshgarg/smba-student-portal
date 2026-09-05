import type { ActionFeedback } from "@/components/inline-notice"
import type { PlayerOnboardingStage } from "@/lib/coach/onboarding"
import { formatDateKey } from "@/lib/format"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
export type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

/**
 * `railLabel` exists because the step rail is the one place these names are given
 * a quarter of the screen each. At 320px that track is 55px, and "ASSESSMENT" at
 * the rail's 9px sets 63.5px of unbreakable single word -- it crossed into the
 * step beside it. "NEW REQUESTS" fits only by wrapping to two lines, and that wrap
 * is what pulled the four markers onto three different heights below 393px.
 *
 * Shortening the rail alone rather than `label` everywhere: the same strings are
 * the queue's stage stamps and the stage-count captions, where they have room and
 * where "New requests" reads better than "Request".
 */
export const STAGES: Array<{
  key: PlayerOnboardingStage
  label: string
  railLabel: string
  summaryKey: "newRequests" | "assessment" | "session" | "feePlan"
}> = [
  { key: "request", label: "New requests", railLabel: "Request", summaryKey: "newRequests" },
  { key: "assessment", label: "Assessment", railLabel: "Assess", summaryKey: "assessment" },
  { key: "session", label: "Session", railLabel: "Session", summaryKey: "session" },
  { key: "feePlan", label: "Fee Plan", railLabel: "Fee plan", summaryKey: "feePlan" },
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
