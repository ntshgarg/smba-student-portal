import type {
  DraftErrors,
  MemberDraft,
} from "@/components/coach/members/directory/member-draft"
import type { ActionFeedback } from "@/components/inline-notice"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import { formatDateKey } from "@/lib/format"

/**
 * Saving edits and archiving share one notice, so `retryAction` names which of
 * the two controls should offer the retry: cancelling an edit leaves the notice
 * in place while swapping which control is on screen.
 */
export type MemberFeedback = ActionFeedback & {
  memberId: string
  offerRetry?: boolean
  recoveryHref?: string
  retryAction?: "archive" | "save"
}

/**
 * The nine edit controls only ever travel together, and every one of them is
 * meaningless for a row that is not the one being edited — `MemberDetailRow`
 * forwards the bundle without reading it. Naming them once is what keeps that
 * row at thirteen props instead of twenty-one. `draft` is not a member of it:
 * it is the one value the detail row has to narrow to non-null before it can
 * render the form at all, so it stays a prop of its own.
 */
export type MemberEditor = {
  errors: DraftErrors
  formRef: React.RefObject<HTMLFormElement | null>
  isDirty: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: (player: PlayerMemberRecord) => void
  onSelectBatch: (batch: MemberDraft["batch"]) => void
  onSelectLevel: (level: MemberDraft["level"]) => void
  onUpdateField: <Key extends keyof MemberDraft>(
    field: Key,
    value: MemberDraft[Key],
  ) => void
}

export function formatJoinedDate(value: string) {
  return formatDateKey(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: undefined,
  })
}
