import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanIsValid,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

export type PlayerOnboardingSummary = {
  assessment: number
  feePlan: number
  newRequests: number
  /**
   * Players who have finished every stage. `total` alone cannot tell the two
   * zeroes apart: an academy on its first day and an academy that has cleared
   * its queue both report 0 outstanding, and only one of them has onboarded
   * anyone. The dashboard card needs the difference to avoid congratulating a
   * new academy for finishing work it has not started.
   */
  onboarded: number
  session: number
  total: number
}

export type PlayerOnboardingStage = "request" | "assessment" | "session" | "feePlan"

/**
 * Someone already in the academy who might be this request again.
 *
 * The registration identity is the contact address and the name together, so a
 * second request under a differently spelled name -- or a differently spelled
 * address -- is a new identity and the unique index lets it through. That is
 * deliberate: one address may own several players, and folding Gmail's dots
 * would merge two genuinely distinct addresses elsewhere. It leaves one case the
 * key cannot judge and a coach can, so the coach is shown it rather than the
 * request being blocked or silently merged.
 */
export type OnboardingDuplicateSignal = {
  academyId: string | null
  fullName: string
  reason: "same-contact" | "same-name-and-birthday"
  standing: "pending" | "approved"
}

export type OnboardingPendingRequest = {
  contactEmail: string | null
  contactPhone: string | null
  createdAt: string
  dateOfBirth: string | null
  fullName: string
  id: string
  requestedRole: "player" | "coach"
}

export type OnboardingWorkspacePlayer = OnboardingPlayer & {
  academyId: string
  contactEmail?: string | null
  dateOfBirth?: string | null
  activatedAt?: string | null
  approvedAt?: string | null
  fullName: string
  onboardingCompletedAt?: string | null
  requestedAt?: string
  trainingStartOn: string
  trainingStartConfirmedAt?: string | null
  primaryContact: {
    name: string
    phone: string
    relationship: string
  }
  recordRevision: number
}

export type PlayerOnboardingCase = {
  activatedAt?: string | null
  academyId: string | null
  approvedAt?: string | null
  /*
   * Null on every request made before registration collected them, and on any
   * account a coach enters by hand -- so the approval screen renders what it has
   * rather than assuming all three are present.
   */
  contactEmail?: string | null
  contactPhone?: string | null
  dateOfBirth?: string | null
  /** Only ever populated for a request awaiting a decision. */
  duplicateSignals?: OnboardingDuplicateSignal[]
  academyPlan: AcademyPlan | null
  /**
   * The open session assignment, when there is one. Null at the "session" stage
   * by construction -- that stage exists because no current assignment was
   * found -- so this is only ever set on a case the coach has stepped BACK to.
   * Without it the Session step cannot tell "assign one" from "one already
   * exists" and renders a pristine form whose submit the server refuses.
   */
  assignedSession: {
    batch: TrainingBatch
    effectiveFrom: string
    programme: TrainingProgramme
  } | null
  batch: TrainingBatch | null
  feePlanRecorded: boolean
  fullName: string
  id: string
  onboardingCompletedAt?: string | null
  trainingStartOn: string | null
  trainingStartConfirmedAt?: string | null
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
  onboardingCompletedAt?: string | null
  trainingStartConfirmedAt?: string | null
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
  return player.trainingStartConfirmedAt !== null
    && player.level !== null
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
  if (player.onboardingCompletedAt !== undefined
    ? player.onboardingCompletedAt !== null
    : completedOnboarding(assignments, feePlans)) return null
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
    onboarded: 0,
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
    if (!stage) {
      summary.onboarded += 1
      return
    }

    summary[stage] += 1
    summary.total += 1
  })

  return summary
}

/**
 * Case and surrounding space only. This is a hint for a person to read, not the
 * identity key, so it deliberately does not reach for the full normaliser --
 * which lives in a server-only module this one is imported into client trees
 * from, and which folds cases a coach would want to see separately anyway.
 */
function comparableAddress(email: string | null | undefined) {
  return email?.trim().toLocaleLowerCase("en-IN") || null
}

function comparableName(fullName: string) {
  return fullName.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-IN")
}

type DuplicateCandidate = {
  academyId: string | null
  contactEmail?: string | null
  dateOfBirth?: string | null
  fullName: string
  id: string
  standing: "pending" | "approved"
}

/**
 * Everyone already here who shares this request's address, or its name and date
 * of birth under a different address. Both are the same person often enough to
 * be worth surfacing and rarely enough that the coach should decide: siblings
 * genuinely share one address, and two players genuinely can share a birthday.
 */
function duplicateSignalsFor(
  request: DuplicateCandidate,
  candidates: readonly DuplicateCandidate[],
): OnboardingDuplicateSignal[] {
  const address = comparableAddress(request.contactEmail)
  const name = comparableName(request.fullName)
  return candidates.flatMap((candidate) => {
    if (candidate.id === request.id) return []
    const reason: OnboardingDuplicateSignal["reason"] | null =
      address && comparableAddress(candidate.contactEmail) === address
        ? "same-contact"
        : request.dateOfBirth
          && candidate.dateOfBirth === request.dateOfBirth
          && comparableName(candidate.fullName) === name
          ? "same-name-and-birthday"
          : null
    if (!reason) return []
    return [{
      academyId: candidate.academyId,
      fullName: candidate.fullName,
      reason,
      standing: candidate.standing,
    }]
  })
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
  const duplicateCandidates: DuplicateCandidate[] = [
    ...pendingRequests.map((request) => ({
      academyId: null,
      contactEmail: request.contactEmail,
      dateOfBirth: request.dateOfBirth,
      fullName: request.fullName,
      id: request.id,
      standing: "pending" as const,
    })),
    ...players.map((player) => ({
      academyId: player.academyId,
      contactEmail: player.contactEmail,
      dateOfBirth: player.dateOfBirth,
      fullName: player.fullName,
      id: player.id,
      standing: "approved" as const,
    })),
  ]
  const requestCases: PlayerOnboardingCase[] = pendingRequests.map((request) => ({
    activatedAt: null,
    academyId: null,
    approvedAt: null,
    contactEmail: request.contactEmail ?? null,
    contactPhone: request.contactPhone ?? null,
    dateOfBirth: request.dateOfBirth ?? null,
    duplicateSignals: duplicateSignalsFor({
      academyId: null,
      contactEmail: request.contactEmail,
      dateOfBirth: request.dateOfBirth,
      fullName: request.fullName,
      id: request.id,
      standing: "pending",
    }, duplicateCandidates),
      academyPlan: null,
      assignedSession: null,
      batch: null,
      feePlanRecorded: false,
    fullName: request.fullName,
    id: request.id,
    onboardingCompletedAt: null,
    trainingStartOn: null,
    trainingStartConfirmedAt: null,
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

    // Only an open assignment counts. An ended one is exactly why a case can sit
    // at the "session" stage, and presenting it as current would block the
    // assignment the coach is there to make.
    const openAssignment = playerAssignments.find((assignment) => !assignment.effectiveTo) ?? null

    return [{
      activatedAt: player.activatedAt,
      academyId: player.academyId,
      approvedAt: player.approvedAt,
      academyPlan: player.academyPlan,
      assignedSession: openAssignment
        ? {
          batch: openAssignment.batch,
          effectiveFrom: openAssignment.effectiveFrom,
          programme: openAssignment.programme,
        }
        : null,
      batch: player.batch,
      feePlanRecorded: playerFeePlans.length > 0,
      fullName: player.fullName,
      id: player.id,
      onboardingCompletedAt: player.onboardingCompletedAt,
      trainingStartOn: player.trainingStartOn,
      trainingStartConfirmedAt: player.trainingStartConfirmedAt,
      level: player.level,
      primaryContact: player.primaryContact,
      recordRevision: player.recordRevision,
      requestedRole: "player",
      requestedAt: player.requestedAt ?? null,
      stage,
    }]
  })
  const cases = [...requestCases, ...playerCases].sort((left, right) => {
    const stageDifference = STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage]
    if (stageDifference) return stageDifference
    const leftDate = left.requestedAt ?? left.trainingStartOn ?? ""
    const rightDate = right.requestedAt ?? right.trainingStartOn ?? ""
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
    // Counted from the players the workspace filtered out above: `playerCases`
    // keeps only those with an outstanding stage, so a completed player never
    // reaches this reduce and has to be counted from the source list.
    onboarded: players.filter((player) => !onboardingStage(
      groupByPlayer(assignments).get(player.id) ?? [],
      groupByPlayer(feePlans).get(player.id) ?? [],
      player,
      referenceDate,
    )).length,
    session: 0,
    total: 0,
  })

  return { cases, summary }
}
