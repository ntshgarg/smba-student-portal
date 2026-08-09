export const MEMBERS_INCREMENT = 12

export type MemberWindowState = {
  resetAfterEditing: boolean
  visibleLimit: number
}

export function initialMemberWindow(): MemberWindowState {
  return {
    resetAfterEditing: false,
    visibleLimit: MEMBERS_INCREMENT,
  }
}

export function memberWindowAfterCriteriaChange(
  current: MemberWindowState,
  isEditing: boolean,
): MemberWindowState {
  return isEditing
    ? { ...current, resetAfterEditing: true }
    : initialMemberWindow()
}

export function memberWindowAfterEditingEnds(
  current: MemberWindowState,
): MemberWindowState {
  return current.resetAfterEditing ? initialMemberWindow() : current
}

export function visibleMemberCount(
  totalCount: number,
  current: MemberWindowState,
  editingIndex: number,
) {
  const editingLimit = editingIndex >= 0 ? editingIndex + 1 : 0
  return Math.min(totalCount, Math.max(current.visibleLimit, editingLimit))
}

export function memberWindowAfterReveal(
  current: MemberWindowState,
  currentlyVisible: number,
  totalCount: number,
): MemberWindowState {
  return {
    ...current,
    visibleLimit: Math.min(
      totalCount,
      Math.max(current.visibleLimit, currentlyVisible) + MEMBERS_INCREMENT,
    ),
  }
}

export function memberWindowSummary(visibleCount: number, totalCount: number) {
  const memberLabel = totalCount === 1 ? "member" : "members"
  return visibleCount < totalCount
    ? `Showing ${visibleCount} of ${totalCount} ${memberLabel}`
    : `${totalCount} ${memberLabel}`
}
