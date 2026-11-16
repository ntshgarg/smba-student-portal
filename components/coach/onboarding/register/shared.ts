import type { ActionFeedback } from "@/components/inline-notice"
import type {
  PlayerOnboardingCase,
  PlayerOnboardingStage,
  PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
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

/**
 * The queue under a stage filter. A stage that has emptied stops filtering, so
 * the list never goes blank under a pressed tile. The open record is shown
 * whatever the filter: approving, assessing or assigning moves a person to the
 * next stage, and a link can name anyone, and hiding them would unmount a form
 * mid-edit and drop focus on the page.
 */
export function filterCases(
  { cases, summary }: PlayerOnboardingWorkspace,
  stageFilter: PlayerOnboardingStage | null,
  openId: string | null,
) {
  const stage = STAGES.find((item) => item.key === stageFilter)
  const activeFilter = stage && summary[stage.summaryKey] > 0 ? stage.key : null
  return {
    activeFilter,
    shownCases: activeFilter
      ? cases.filter((item) => item.stage === activeFilter || item.id === openId)
      : cases,
  }
}

/**
 * Who opens after the open record leaves the queue: a neighbour the coach can
 * see, or, once the filtered list has nobody else, the whole queue's.
 */
export function nextCase(shownCases: PlayerOnboardingCase[], allCases: PlayerOnboardingCase[], leavingId: string) {
  const clearsFilter = shownCases.length < 2 && shownCases !== allCases
  const neighbours = clearsFilter ? allCases : shownCases
  const index = neighbours.findIndex((item) => item.id === leavingId)
  return { clearsFilter, item: neighbours[index + 1] ?? neighbours[index - 1] ?? null }
}
