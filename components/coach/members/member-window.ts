/** The directory shows members five to a page. */
export const MEMBERS_PER_PAGE = 5

export type MemberPageState = {
  page: number
  /** A search or filter change made while editing waits until the edit ends. */
  resetAfterEditing: boolean
}

export function initialMemberPage(page = 1): MemberPageState {
  return { page: Math.max(1, Math.floor(page) || 1), resetAfterEditing: false }
}

export function memberPageAfterCriteriaChange(
  current: MemberPageState,
  isEditing: boolean,
): MemberPageState {
  return isEditing
    ? { ...current, resetAfterEditing: true }
    : initialMemberPage()
}

export function memberPageAfterEditingEnds(current: MemberPageState): MemberPageState {
  return current.resetAfterEditing ? initialMemberPage() : current
}

export function memberPageCount(totalCount: number) {
  return Math.max(1, Math.ceil(totalCount / MEMBERS_PER_PAGE))
}

/**
 * The page on screen: the one holding the open or edited member when there is
 * one (a deep link, or a filter change while a record is open), otherwise the
 * chosen page, kept within range as the list shrinks.
 */
export function shownMemberPage(totalCount: number, current: MemberPageState, pinnedIndex: number) {
  if (pinnedIndex >= 0) return Math.floor(pinnedIndex / MEMBERS_PER_PAGE) + 1
  return Math.min(current.page, memberPageCount(totalCount))
}

/** The page numbers to offer: the first, the last, and the current one with its neighbours. */
export function memberPageNumbers(page: number, pageCount: number): Array<number | "gap"> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((item) => item >= 1 && item <= pageCount))
  const sorted = [...wanted].sort((a, b) => a - b)
  return sorted.flatMap((item, index) => (
    index && item - sorted[index - 1] > 1 ? ["gap" as const, item] : [item]
  ))
}

export function memberPageSummary(page: number, totalCount: number) {
  const memberLabel = totalCount === 1 ? "member" : "members"
  if (totalCount <= MEMBERS_PER_PAGE) return `${totalCount} ${memberLabel}`
  const first = (page - 1) * MEMBERS_PER_PAGE + 1
  const last = Math.min(totalCount, page * MEMBERS_PER_PAGE)
  return `${first}–${last} of ${totalCount} ${memberLabel}`
}
