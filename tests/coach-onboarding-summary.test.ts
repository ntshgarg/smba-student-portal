import { describe, expect, it } from "vitest"

import {
  derivePlayerOnboardingSummary,
  derivePlayerOnboardingWorkspace,
  type OnboardingAssignment,
  type OnboardingFeePlan,
  type OnboardingPlayer,
} from "@/lib/coach/onboarding"

const assessedPlayer: OnboardingPlayer = {
  academyPlan: "weekday-3-day",
  batch: "Weekday",
  id: "player-1",
  level: "Beginner",
}

function assignment(
  overrides: Partial<OnboardingAssignment> = {},
): OnboardingAssignment {
  return {
    batch: "Weekday",
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    playerId: "player-1",
    programme: "Beginner",
    seriesEndsOn: null,
    seriesStartsOn: "2026-08-01",
    seriesStatus: "active",
    ...overrides,
  }
}

function feePlan(overrides: Partial<OnboardingFeePlan> = {}): OnboardingFeePlan {
  return {
    academyPlan: "weekday-3-day",
    batch: "Weekday",
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    level: "Beginner",
    playerId: "player-1",
    ...overrides,
  }
}

function summary(input: {
  assignments?: OnboardingAssignment[]
  feePlans?: OnboardingFeePlan[]
  newRequestCount?: number
  players?: OnboardingPlayer[]
}) {
  return derivePlayerOnboardingSummary({
    assignments: input.assignments ?? [],
    feePlans: input.feePlans ?? [],
    newRequestCount: input.newRequestCount ?? 0,
    players: input.players ?? [assessedPlayer],
    referenceDate: "2026-08-15",
  })
}

describe("coach player onboarding summary", () => {
  it("keeps every player in one first-incomplete stage", () => {
    expect(summary({
      newRequestCount: 2,
      players: [{
        academyPlan: null,
        batch: null,
        id: "assessment-player",
        level: null,
      }, assessedPlayer],
    })).toEqual({
      assessment: 1,
      feePlan: 0,
      newRequests: 2,
      session: 1,
      total: 4,
    })
  })

  it("moves an assessed player from session to Fee Plan after assignment", () => {
    expect(summary({})).toMatchObject({ session: 1, feePlan: 0, total: 1 })
    expect(summary({ assignments: [assignment()] }))
      .toMatchObject({ session: 0, feePlan: 1, total: 1 })
  })

  it("does not let a Fee-Plan-first legacy record skip session assignment", () => {
    expect(summary({ feePlans: [feePlan()] }))
      .toMatchObject({ session: 1, feePlan: 0, total: 1 })
  })

  it("removes a player after a matching assignment and Fee Plan overlap", () => {
    expect(summary({ assignments: [assignment()], feePlans: [feePlan()] }))
      .toEqual({ assessment: 0, feePlan: 0, newRequests: 0, session: 0, total: 0 })
  })

  it("keeps completion monotonic after the assignment and Fee Plan end", () => {
    expect(summary({
      assignments: [assignment({
        effectiveFrom: "2025-01-01",
        effectiveTo: "2025-12-31",
        seriesEndsOn: "2025-12-31",
        seriesStartsOn: "2025-01-01",
        seriesStatus: "ended",
      })],
      feePlans: [feePlan({
        effectiveFrom: "2025-01-01",
        effectiveTo: "2025-12-31",
      })],
    })).toMatchObject({ total: 0 })
  })

  it("does not complete mismatched or non-overlapping records", () => {
    expect(summary({
      assignments: [assignment()],
      feePlans: [feePlan({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" })],
    })).toMatchObject({ feePlan: 1, total: 1 })
    expect(summary({
      assignments: [assignment()],
      feePlans: [feePlan({ level: "Intermediate" })],
    })).toMatchObject({ feePlan: 1, total: 1 })
  })

  it("builds one ordered register from the same stage classifier", () => {
    const workspace = derivePlayerOnboardingWorkspace({
      assignments: [assignment({ playerId: "fee-player" })],
      feePlans: [],
      pendingRequests: [{
        createdAt: "2026-08-09T10:00:00.000Z",
        fullName: "Myra Shah",
        id: "request-player",
      }],
      players: [
        {
          ...assessedPlayer,
          academyId: "SMBA#0002",
          fullName: "Advait Kapoor",
          joinedAt: "2026-08-11",
          primaryContact: { name: "", phone: "", relationship: "" },
          recordRevision: 0,
        },
        {
          academyId: "SMBA#0001",
          academyPlan: null,
          batch: null,
          fullName: "Rohan Kulkarni",
          id: "assessment-player",
          joinedAt: "2026-08-10",
          level: null,
          primaryContact: { name: "", phone: "", relationship: "" },
          recordRevision: 0,
        },
        {
          ...assessedPlayer,
          academyId: "SMBA#0003",
          fullName: "Kavya Bhat",
          id: "fee-player",
          joinedAt: "2026-08-12",
          primaryContact: { name: "", phone: "", relationship: "" },
          recordRevision: 1,
        },
      ],
      referenceDate: "2026-08-15",
    })

    expect(workspace.cases.map(({ id, stage }) => [id, stage])).toEqual([
      ["request-player", "request"],
      ["assessment-player", "assessment"],
      ["player-1", "session"],
      ["fee-player", "feePlan"],
    ])
    expect(workspace.summary).toEqual({
      assessment: 1,
      feePlan: 1,
      newRequests: 1,
      session: 1,
      total: 4,
    })
  })
})
