import { describe, expect, it } from "vitest"

import {
  derivePlayerOnboardingSummary,
  derivePlayerOnboardingWorkspace,
  type OnboardingAssignment,
  type OnboardingFeePlan,
  type OnboardingPendingRequest,
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
      onboarded: 0,
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
      .toEqual({ assessment: 0, feePlan: 0, newRequests: 0, onboarded: 1, session: 0, total: 0 })
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
        contactEmail: "shah@example.com",
        contactPhone: "+919000000001",
        createdAt: "2026-08-09T10:00:00.000Z",
        dateOfBirth: "2014-01-05",
        fullName: "Myra Shah",
        id: "request-player",
        requestedRole: "player",
      }, {
        // A request predating the contact fields still has to classify.
        contactEmail: null,
        contactPhone: null,
        createdAt: "2026-08-09T11:00:00.000Z",
        dateOfBirth: null,
        fullName: "Arjun Kumar",
        id: "request-coach",
        requestedRole: "coach",
      }],
      players: [
        {
          ...assessedPlayer,
          academyId: "SMBA#0002",
          fullName: "Advait Kapoor",
          trainingStartOn: "2026-08-11",
          primaryContact: { name: "", phone: "", relationship: "" },
          recordRevision: 0,
        },
        {
          academyId: "SMBA#0001",
          academyPlan: null,
          batch: null,
          fullName: "Rohan Kulkarni",
          id: "assessment-player",
          trainingStartOn: "2026-08-10",
          level: null,
          primaryContact: { name: "", phone: "", relationship: "" },
          recordRevision: 0,
        },
        {
          ...assessedPlayer,
          academyId: "SMBA#0003",
          fullName: "Kavya Bhat",
          id: "fee-player",
          trainingStartOn: "2026-08-12",
          primaryContact: { name: "", phone: "", relationship: "" },
          recordRevision: 1,
        },
      ],
      referenceDate: "2026-08-15",
    })

    expect(workspace.cases.map(({ id, stage }) => [id, stage])).toEqual([
      ["request-player", "request"],
      ["request-coach", "request"],
      ["assessment-player", "assessment"],
      ["player-1", "session"],
      ["fee-player", "feePlan"],
    ])
    expect(workspace.summary).toEqual({
      assessment: 1,
      feePlan: 1,
      newRequests: 2,
      onboarded: 0,
      session: 1,
      total: 5,
    })
    expect(workspace.cases.find(({ id }) => id === "request-coach"))
      .toMatchObject({ requestedRole: "coach" })
  })
})

/*
 * `total === 0` is true of an academy that has cleared its queue and of one that
 * opened this morning, and the dashboard card has to tell them apart -- it used
 * to report "Academy onboarding is complete" to a head coach on day one. That is
 * what `onboarded` is for, so it is asserted on its own rather than only inside
 * the summaries above.
 */
describe("the two zeroes an onboarding summary can report", () => {
  it("counts nothing onboarded on an academy that has never had a player", () => {
    expect(summary({ newRequestCount: 0, players: [] }))
      .toEqual({ assessment: 0, feePlan: 0, newRequests: 0, onboarded: 0, session: 0, total: 0 })
  })

  it("counts the finished player once the queue is cleared", () => {
    const cleared = summary({ assignments: [assignment()], feePlans: [feePlan()] })
    expect(cleared.total).toBe(0)
    expect(cleared.onboarded).toBe(1)
  })
})

describe("what a coach sees before approving", () => {
  /*
   * The approval screen used to carry a name, a request type and a date. Two
   * people of the same name were indistinguishable on it, which is half of why
   * duplicate requests were hard to spot from the coach's side.
   */
  function workspaceWith(request: Partial<OnboardingPendingRequest>) {
    return derivePlayerOnboardingWorkspace({
      assignments: [],
      feePlans: [],
      pendingRequests: [{
        contactEmail: null,
        contactPhone: null,
        createdAt: "2026-08-09T10:00:00.000Z",
        dateOfBirth: null,
        fullName: "Myra Shah",
        id: "request-1",
        requestedRole: "player",
        ...request,
      }],
      players: [],
      referenceDate: "2026-08-10",
    })
  }

  /*
   * The identity is the address and the name together, so a second request under
   * a differently spelled name is a new identity and the unique index lets it
   * through -- deliberately, because siblings really do share one address. These
   * pin what the coach is shown so they can judge the case the key cannot.
   */
  function workspaceWithMany(
    requests: Partial<OnboardingPendingRequest>[],
    players: Parameters<typeof derivePlayerOnboardingWorkspace>[0]["players"] = [],
  ) {
    return derivePlayerOnboardingWorkspace({
      assignments: [],
      feePlans: [],
      pendingRequests: requests.map((request, index) => ({
        contactEmail: null,
        contactPhone: null,
        createdAt: "2026-08-09T10:00:00.000Z",
        dateOfBirth: null,
        fullName: `Player ${index}`,
        id: `request-${index}`,
        requestedRole: "player" as const,
        ...request,
      })),
      players,
      referenceDate: "2026-08-10",
    })
  }

  function caseNamed(
    workspace: ReturnType<typeof derivePlayerOnboardingWorkspace>,
    fullName: string,
  ) {
    return workspace.cases.find((item) => item.fullName === fullName)
  }

  it("names the other request waiting on the same contact address", () => {
    // Case differs between the two addresses, which must not hide the match.
    const workspace = workspaceWithMany([
      { contactEmail: "shah@example.com", fullName: "Myra Shah" },
      { contactEmail: "Shah@Example.com", fullName: "Myra R Shah" },
    ])

    expect(caseNamed(workspace, "Myra Shah")?.duplicateSignals).toEqual([
      { academyId: null, fullName: "Myra R Shah", reason: "same-contact", standing: "pending" },
    ])
    expect(caseNamed(workspace, "Myra R Shah")?.duplicateSignals).toEqual([
      { academyId: null, fullName: "Myra Shah", reason: "same-contact", standing: "pending" },
    ])
  })

  it("names an approved member on the same address, with their Academy ID", () => {
    const [item] = workspaceWithMany(
      [{ contactEmail: "shah@example.com", fullName: "Myra R Shah" }],
      [{
        academyId: "SMBA-PL-0002",
        academyPlan: "weekday-3-day",
        batch: "Weekday",
        contactEmail: "shah@example.com",
        dateOfBirth: "2014-01-05",
        fullName: "Myra Shah",
        id: "player-approved",
        level: "Beginner",
        primaryContact: { name: "Rakesh Shah", phone: "+919000000001", relationship: "Parent" },
        recordRevision: 0,
        trainingStartOn: "2026-08-01",
      }],
    ).cases

    expect(item?.duplicateSignals).toEqual([{
      academyId: "SMBA-PL-0002",
      fullName: "Myra Shah",
      reason: "same-contact",
      standing: "approved",
    }])
  })

  it("catches the same child re-registered from a second address", () => {
    // Gmail dots and +tags are deliberately not folded into the identity, so one
    // inbox can hold two identities. Name plus date of birth is what is left.
    const workspace = workspaceWithMany([
      { contactEmail: "r.a.kesh@gmail.com", dateOfBirth: "2014-01-05", fullName: "Myra Shah" },
      { contactEmail: "rakesh@gmail.com", dateOfBirth: "2014-01-05", fullName: "  myra   shah " },
    ])

    expect(caseNamed(workspace, "Myra Shah")?.duplicateSignals).toEqual([{
      academyId: null,
      fullName: "  myra   shah ",
      reason: "same-name-and-birthday",
      standing: "pending",
    }])
  })

  it("says nothing about two players who merely share a birthday", () => {
    const workspace = workspaceWithMany([
      { contactEmail: "shah@example.com", dateOfBirth: "2014-01-05", fullName: "Myra Shah" },
      { contactEmail: "rao@example.com", dateOfBirth: "2014-01-05", fullName: "Anaya Rao" },
    ])

    expect(caseNamed(workspace, "Myra Shah")?.duplicateSignals).toEqual([])
  })

  it("says nothing about a request with no contact details to compare", () => {
    const workspace = workspaceWithMany([
      { fullName: "Myra Shah" },
      { fullName: "Anaya Rao" },
    ])

    expect(caseNamed(workspace, "Myra Shah")?.duplicateSignals).toEqual([])
  })

  it("carries the verified contact details onto the request case", () => {
    const [item] = workspaceWith({
      contactEmail: "shah@example.com",
      contactPhone: "+919000000001",
      dateOfBirth: "2014-01-05",
    }).cases

    expect(item).toMatchObject({
      contactEmail: "shah@example.com",
      contactPhone: "+919000000001",
      dateOfBirth: "2014-01-05",
      stage: "request",
    })
  })

  it("still classifies a request made before those fields existed", () => {
    // Requests already in the queue have none of them, and a coach entering
    // someone by hand never will. The stage must not depend on their presence.
    const [item] = workspaceWith({}).cases

    expect(item).toMatchObject({
      contactEmail: null,
      contactPhone: null,
      dateOfBirth: null,
      stage: "request",
    })
  })
})
