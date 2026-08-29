import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

export const memberDirectoryLevels: TrainingProgramme[] = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Adult",
  "Elite",
]
export const memberDirectoryBatches: TrainingBatch[] = ["Weekday", "Weekend"]
const memberDirectoryStatuses = ["all", "unassigned", "active", "paused"] as const
export const memberDirectoryRoles = ["everyone", "players", "staff"] as const

export type MemberDirectoryLevel = TrainingProgramme | "All levels"
export type MemberDirectoryBatch = TrainingBatch | "All batches"
export type MemberDirectoryStatus = typeof memberDirectoryStatuses[number]
export type MemberDirectoryRole = typeof memberDirectoryRoles[number]

export type MemberDirectoryCriteria = {
  query: string
  level: MemberDirectoryLevel
  batch: MemberDirectoryBatch
  role: MemberDirectoryRole
  status: MemberDirectoryStatus
}

const defaults: MemberDirectoryCriteria = {
  query: "",
  level: "All levels",
  batch: "All batches",
  role: "everyone",
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

function isRole(value: string | null): value is MemberDirectoryRole {
  return memberDirectoryRoles.includes(value as MemberDirectoryRole)
}

export function parseMemberDirectoryCriteria(
  searchParams: Pick<URLSearchParams, "get">,
): MemberDirectoryCriteria {
  const rawQuery = searchParams.get("query") ?? ""
  const query = rawQuery.trim() ? rawQuery : ""
  const requestedLevel = searchParams.get("level")
  const requestedBatch = searchParams.get("batch")
  const requestedStatus = searchParams.get("status")
  const requestedRole = searchParams.get("role")

  return {
    query,
    level: isLevel(requestedLevel) ? requestedLevel : defaults.level,
    batch: isBatch(requestedBatch) ? requestedBatch : defaults.batch,
    role: isRole(requestedRole) ? requestedRole : defaults.role,
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
  parameters.delete("role")

  if (criteria.query.trim()) parameters.set("query", criteria.query)
  if (criteria.level !== defaults.level) parameters.set("level", criteria.level)
  if (criteria.batch !== defaults.batch) parameters.set("batch", criteria.batch)
  if (criteria.status !== defaults.status) parameters.set("status", criteria.status)
  if (criteria.role !== defaults.role) parameters.set("role", criteria.role)

  return parameters.toString()
}

export function memberDirectoryCriteriaKey(criteria: MemberDirectoryCriteria) {
  return [criteria.query, criteria.level, criteria.batch, criteria.role, criteria.status].join("\u0000")
}

export function memberDirectoryHref(pathname: string, search: string) {
  return search ? `${pathname}?${search}` : pathname
}
