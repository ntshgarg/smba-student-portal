"use client"

import { SearchX } from "lucide-react"

export function MemberDirectoryEmptyState({
  hasDirectoryCriteria,
  onResetFilters,
  playerCount,
}: {
  hasDirectoryCriteria: boolean
  onResetFilters: () => void
  playerCount: number
}) {
  return (
    <div className="coach-member-empty-state">
      <SearchX aria-hidden="true" />
      <h3>{playerCount ? "No matching members" : "No players yet"}</h3>
      <p>{playerCount
        ? "Try another name or clear the current search and filters"
        : "Approved players will appear here once their academy record is ready"}</p>
      {playerCount && hasDirectoryCriteria ? (
        <button type="button" onClick={onResetFilters}>Clear search and filters</button>
      ) : null}
    </div>
  )
}
