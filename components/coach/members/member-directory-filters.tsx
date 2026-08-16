"use client"

import { ChevronDown, Search } from "lucide-react"

import {
  memberDirectoryBatches,
  memberDirectoryLevels,
  type MemberDirectoryBatch,
  type MemberDirectoryCriteria,
  type MemberDirectoryLevel,
  type MemberDirectoryStatus,
} from "@/components/coach/members/member-directory-query"

export function MemberDirectoryFilters({
  activeFilterCount,
  criteria,
  onChange,
  onToggle,
  open,
}: {
  activeFilterCount: number
  criteria: MemberDirectoryCriteria
  onChange: (criteria: MemberDirectoryCriteria, mode: "push" | "replace") => void
  onToggle: () => void
  open: boolean
}) {
  return (
    <div className={`coach-member-directory-controls${open ? " is-filters-open" : ""}`}>
      <label className="coach-member-search">
        <span className="sr-only">Search members or primary contacts</span>
        <Search aria-hidden="true" />
        <input
          autoComplete="off"
          name="q"
          type="search"
          value={criteria.query}
          placeholder="Search members"
          onChange={(event) => onChange({
            ...criteria,
            query: event.target.value,
          }, "replace")}
        />
      </label>

      <button
        className="coach-member-filter-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="coach-member-filters"
        onClick={onToggle}
      >
        <span>
          <strong>Filters</strong>
          <small>{activeFilterCount ? `${activeFilterCount} active` : "Optional"}</small>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>

      <div id="coach-member-filters" className="coach-member-filters">
        <label className="coach-member-filter">
          <span>Level</span>
          <select
            name="level"
            value={criteria.level}
            onChange={(event) => onChange({
              ...criteria,
              level: event.target.value as MemberDirectoryLevel,
            }, "push")}
          >
            <option>All levels</option>
            {memberDirectoryLevels.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>

        <label className="coach-member-filter">
          <span>Status</span>
          <select
            name="status"
            value={criteria.status}
            onChange={(event) => onChange({
              ...criteria,
              status: event.target.value as MemberDirectoryStatus,
            }, "push")}
          >
            <option value="all">All members</option>
            <option value="unassigned">Unassigned</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>

        <label className="coach-member-filter">
          <span>Batch</span>
          <select
            name="batch"
            value={criteria.batch}
            onChange={(event) => onChange({
              ...criteria,
              batch: event.target.value as MemberDirectoryBatch,
            }, "push")}
          >
            <option>All batches</option>
            {memberDirectoryBatches.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
