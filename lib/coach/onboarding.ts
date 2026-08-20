import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanIsValid,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

export type PlayerOnboardingSummary = {
  assessment: number
  feePlan: number
  newRequests: number
  session: number
  total: number
}

export type PlayerOnboardingStage = "request" | "assessment" | "session" | "feePlan"

export type OnboardingPendingRequest = {
  createdAt: string
  fullName: string
  id: string
  requestedRole: "player" | "coach"
}

export type OnboardingWorkspacePlayer = OnboardingPlayer & {
  academyId: string
  fullName: string
  joinedAt: string
  primaryContact: {
    name: string
    phone: string
    relationship: string
  }
  recordRevision: number
}

export type PlayerOnboardingCase = {
  academyId: string | null
  academyPlan: AcademyPlan | null
  batch: TrainingBatch | null
  feePlanRecorded: boolean
  fullName: string
  id: string
  joinedAt: string | null
  level: TrainingProgramme | null
  primaryContact: OnboardingWorkspacePlayer["primaryContact"] | null
  recordRevision: number | null
  requestedRole: "player" | "coach"
  requestedAt: string | null
  stage: PlayerOnboardingStage
}

export type PlayerOnboardingWorkspace = {
  cases: PlayerOnboardingCase[]
  summary: PlayerOnboardingSummary
}

export type OnboardingPlayer = {
  academyPlan: AcademyPlan | null
  batch: TrainingBatch | null
  id: string
  level: TrainingProgramme | null
}

export type OnboardingAssignment = {
  batch: TrainingBatch
  effectiveFrom: string
  effectiveTo: string | null
  playerId: string
  programme: TrainingProgramme
  seriesEndsOn: string | null
  seriesStartsOn: string
  seriesStatus: "active" | "ended"
}

export type OnboardingFeePlan = {
  academyPlan: AcademyPlan
  batch: TrainingBatch
  effectiveFrom: string
  effectiveTo: string | null
  level: TrainingProgramme
  playerId: string
}

type OnboardingSummaryInput = {
  assignments: OnboardingAssignment[]
  feePlans: OnboardingFeePlan[]
  newRequestCount: number
  players: OnboardingPlayer[]
  referenceDate: string
}

type OnboardingWorkspaceInput = Omit<OnboardingSummaryInput, "newRequestCount" | "players"> & {
  pendingRequests: OnboardingPendingRequest[]
  players: OnboardingWorkspacePlayer[]
}

function groupByPlayer<T extends { playerId: string }>(items: T[]) {
  return items.reduce<Map<string, T[]>>((groups, item) => {
    const group = groups.get(item.playerId) ?? []
    group.push(item)
    groups.set(item.playerId, group)
    return groups
  }, new Map())
}

function latestDate(...values: string[]) {
  return values.reduce((latest, value) => value > latest ? value : latest)
}

function earliestDate(...values: Array<string | null>) {
  const dates = values.filter((value): value is string => value !== null)
  return dates.length
    ? dates.reduce((earliest, value) => value < earliest ? value : earliest)
    : null
}

function assignmentRange(assignment: OnboardingAssignment) {
  const start = latestDate(assignment.effectiveFrom, assignment.seriesStartsOn)
  const end = earliestDate(assignment.effectiveTo, assignment.seriesEndsOn)
  return end !== null && end < start ? null : { end, start }
}

function rangesOverlap(
  left: { end: string | null; start: string },
  right: { end: string | null; start: string },
) {
  return (left.end === null || right.start <= left.end)
    && (right.end === null || left.start <= right.end)
}

function completedOnboarding(
  assignments: OnboardingAssignment[],
  feePlans: OnboardingFeePlan[],
) {
  return assignments.some((assignment) => {
    const range = assignmentRange(assignment)
    if (!range) return false

    return feePlans.some((feePlan) => (
      feePlan.level === assignment.programme
      && feePlan.batch === assignment.batch
      && academyPlanIsValid(feePlan.academyPlan, feePlan.level, feePlan.batch)
      && rangesOverlap(range, {
        end: feePlan.effectiveTo,
        start: feePlan.effectiveFrom,
      })
    ))
  })
}

function classificationIsComplete(player: OnboardingPlayer) {
  return player.level !== null
    && player.batch !== null
    && player.academyPlan !== null
    && academyPlanIsValid(player.academyPlan, player.level, player.batch)
}

function hasCurrentOrFutureAssignment(
  assignments: OnboardingAssignment[],
  player: OnboardingPlayer,
  referenceDate: string,
) {
  if (!player.level || !player.batch) return false

  return assignments.some((assignment) => {
    const range = assignmentRange(assignment)
    return range !== null
      && assignment.programme === player.level
      && assignment.batch === player.batch
      && assignment.seriesStatus === "active"
      && (range.end === null || range.end >= referenceDate)
  })
}

function onboardingStage(
  assignments: OnboardingAssignment[],
  feePlans: OnboardingFeePlan[],
  player: OnboardingPlayer,
  referenceDate: string,
): Exclude<PlayerOnboardingStage, "request"> | null {
  if (completedOnboarding(assignments, feePlans)) return null
  if (!classificationIsComplete(player)) return "assessment"
  if (!hasCurrentOrFutureAssignment(assignments, player, referenceDate)) return "session"
  return "feePlan"
}

export function derivePlayerOnboardingSummary({
  assignments,
  feePlans,
  newRequestCount,
  players,
  referenceDate,
}: OnboardingSummaryInput): PlayerOnboardingSummary {
  const summary: PlayerOnboardingSummary = {
    assessment: 0,
    feePlan: 0,
    newRequests: newRequestCount,
    session: 0,
    total: newRequestCount,
  }
  const assignmentsByPlayer = groupByPlayer(assignments)
  const feePlansByPlayer = groupByPlayer(feePlans)

  players.forEach((player) => {
    const playerAssignments = assignmentsByPlayer.get(player.id) ?? []
    const playerFeePlans = feePlansByPlayer.get(player.id) ?? []
    const stage = onboardingStage(
      playerAssignments,
      playerFeePlans,
      player,
      referenceDate,
    )
    if (!stage) return

    summary[stage] += 1
    summary.total += 1
  })

  return summary
}

const STAGE_ORDER: Record<PlayerOnboardingStage, number> = {
  request: 0,
  assessment: 1,
  session: 2,
  feePlan: 3,
}

export function derivePlayerOnboardingWorkspace({
  assignments,
  feePlans,
  pendingRequests,
  players,
  referenceDate,
}: OnboardingWorkspaceInput): PlayerOnboardingWorkspace {
  const assignmentsByPlayer = groupByPlayer(assignments)
  const feePlansByPlayer = groupByPlayer(feePlans)
  const requestCases: PlayerOnboardingCase[] = pendingRequests.map((request) => ({
    academyId: null,
    academyPlan: null,
    batch: null,
    feePlanRecorded: false,
    fullName: request.fullName,
    id: request.id,
    joinedAt: null,
    level: null,
    primaryContact: null,
    recordRevision: null,
    requestedRole: request.requestedRole,
    requestedAt: request.createdAt,
    stage: "request",
  }))
  const playerCases = players.flatMap<PlayerOnboardingCase>((player) => {
    const playerAssignments = assignmentsByPlayer.get(player.id) ?? []
    const playerFeePlans = feePlansByPlayer.get(player.id) ?? []
    const stage = onboardingStage(
      playerAssignments,
      playerFeePlans,
      player,
      referenceDate,
    )
    if (!stage) return []

    return [{
      academyId: player.academyId,
      academyPlan: player.academyPlan,
      batch: player.batch,
      feePlanRecorded: playerFeePlans.length > 0,
      fullName: player.fullName,
      id: player.id,
      joinedAt: player.joinedAt,
      level: player.level,
      primaryContact: player.primaryContact,
      recordRevision: player.recordRevision,
      requestedRole: "player",
      requestedAt: null,
      stage,
    }]
  })
  const cases = [...requestCases, ...playerCases].sort((left, right) => {
    const stageDifference = STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage]
    if (stageDifference) return stageDifference
    const leftDate = left.requestedAt ?? left.joinedAt ?? ""
    const rightDate = right.requestedAt ?? right.joinedAt ?? ""
    return leftDate.localeCompare(rightDate) || left.fullName.localeCompare(right.fullName)
  })
  const summary = cases.reduce<PlayerOnboardingSummary>((current, item) => {
    if (item.stage === "request") current.newRequests += 1
    else current[item.stage] += 1
    current.total += 1
    return current
  }, {
    assessment: 0,
    feePlan: 0,
    newRequests: 0,
    session: 0,
    total: 0,
  })

  return { cases, summary }
}
