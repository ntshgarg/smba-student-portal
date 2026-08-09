import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

export const memberDirectoryLevels: TrainingProgramme[] = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Adult",
]
export const memberDirectoryBatches: TrainingBatch[] = ["Weekday", "Weekend"]
export const memberDirectoryStatuses = ["all", "unassigned", "active", "paused"] as const

export type MemberDirectoryLevel = TrainingProgramme | "All levels"
export type MemberDirectoryBatch = TrainingBatch | "All batches"
export type MemberDirectoryStatus = typeof memberDirectoryStatuses[number]

export type MemberDirectoryCriteria = {
  query: string
  level: MemberDirectoryLevel
  batch: MemberDirectoryBatch
  status: MemberDirectoryStatus
}

const defaults: MemberDirectoryCriteria = {
  query: "",
  level: "All levels",
  batch: "All batches",
  status: "all",
}

function isLevel(value: string | null): value is TrainingProgramme {
  return memberDirectoryLevels.includes(value as TrainingProgramme)
}

function isBatch(value: string | null): value is TrainingBatch {
  return memberDirectoryBatches.includes(value as TrainingBatch)
}

function isStatus(value: string | null): value is MemberDirectoryStatus {
  return memberDirectoryStatuses.includes(value as MemberDirectoryStatus)
}

export function parseMemberDirectoryCriteria(
  searchParams: Pick<URLSearchParams, "get">,
): MemberDirectoryCriteria {
  const rawQuery = searchParams.get("query") ?? ""
  const query = rawQuery.trim() ? rawQuery : ""
  const requestedLevel = searchParams.get("level")
  const requestedBatch = searchParams.get("batch")
  const requestedStatus = searchParams.get("status")

  return {
    query,
    level: isLevel(requestedLevel) ? requestedLevel : defaults.level,
    batch: isBatch(requestedBatch) ? requestedBatch : defaults.batch,
    status: isStatus(requestedStatus) ? requestedStatus : defaults.status,
  }
}

export function memberDirectorySearch(
  currentSearch: string | URLSearchParams,
  criteria: MemberDirectoryCriteria,
) {
  const parameters = new URLSearchParams(currentSearch)
  parameters.delete("query")
  parameters.delete("level")
  parameters.delete("batch")
  parameters.delete("status")

  if (criteria.query.trim()) parameters.set("query", criteria.query)
  if (criteria.level !== defaults.level) parameters.set("level", criteria.level)
  if (criteria.batch !== defaults.batch) parameters.set("batch", criteria.batch)
  if (criteria.status !== defaults.status) parameters.set("status", criteria.status)

  return parameters.toString()
}

export function memberDirectoryCriteriaKey(criteria: MemberDirectoryCriteria) {
  return [criteria.query, criteria.level, criteria.batch, criteria.status].join("\u0000")
}

export function memberDirectoryHref(pathname: string, search: string) {
  return search ? `${pathname}?${search}` : pathname
}
