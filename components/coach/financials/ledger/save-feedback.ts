import type { ActionFeedback } from "@/components/inline-notice"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
export type SaveFeedback = ActionFeedback & { offerRetry?: boolean }
