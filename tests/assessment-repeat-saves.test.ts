import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-assessment-repeat-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/**
 * The state-machine audit's M142/M143: a first publish repeated after a dropped
 * connection, or made from a second tab, gave the player two copies; a repeated
 * first "Save draft" said "already has a draft"; and two windows editing one
 * assessment overwrote each other without a word.
 */
describe("assessment saves that are repeated or race", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let service: typeof import("@/lib/assessments/service")
  let queries: typeof import("@/lib/assessments/queries")
  let contracts: typeof import("@/lib/assessments/contracts")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const playerId = "10000000-0000-4000-8000-0000000000b1"
  const firstId = "50000000-0000-4000-8000-000000000001"
  const secondId = "50000000-0000-4000-8000-000000000002"
  const now = new Date("2026-10-04T10:00:00+05:30")

  function input(overrides: Partial<import("@/lib/assessments/contracts").SaveAssessmentInput> = {}) {
    return {
      assessedOn: "2026-10-04",
      comments: "",
      improvements: "",
      playerId,
      ratings: { footwork: 4, "mental-focus": 3 },
      strengths: "",
      ...overrides,
    }
  }

  function rows() {
    return database.select().from(schema.playerAssessments)
      .where(eq(schema.playerAssessments.playerAccountId, playerId))
      .all()
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    service = await import("@/lib/assessments/service")
    queries = await import("@/lib/assessments/queries")
    contracts = await import("@/lib/assessments/contracts")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: "Kavya Menon",
      normalizedName: "kavya menon",
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      level: "Intermediate",
      batch: "Weekday",
      academyPlan: "weekday-3-day",
      status: "active",
      trainingStartOn: "2026-07-01",
      updatedAt: now,
    }).run()
  })

  beforeEach(() => {
    database.delete(schema.playerAssessments)
      .where(eq(schema.playerAssessments.playerAccountId, playerId)).run()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("lands a repeated first publish on the assessment the first attempt created", () => {
    const first = service.publishAssessment(
      input({ expectedPublishedCount: 0, newAssessmentId: firstId }),
      { coachId, database, now },
    )
    const repeat = service.publishAssessment(
      input({ expectedPublishedCount: 0, newAssessmentId: firstId }),
      { coachId, createId: () => secondId, database, now: new Date("2026-10-04T10:01:00+05:30") },
    )

    expect(repeat.assessmentId).toBe(first.assessmentId)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ id: firstId, revision: 1, status: "published" })
  })

  it("refuses a first publish from a second window once another has been published", () => {
    service.publishAssessment(
      input({ expectedPublishedCount: 0, newAssessmentId: firstId }),
      { coachId, database, now },
    )

    expect(() => service.publishAssessment(
      input({ expectedPublishedCount: 0, newAssessmentId: secondId, strengths: "Second window" }),
      { coachId, database, now },
    )).toThrowError(expect.objectContaining({ code: "CONFLICT" }))
    expect(rows()).toHaveLength(1)
  })

  it("continues the same draft when a first save is repeated", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    const repeat = service.saveAssessmentDraft(
      input({ newAssessmentId: firstId, strengths: "Typed after the first save" }),
      { coachId, database, now },
    )

    expect(repeat.assessmentId).toBe(firstId)
    expect(rows()).toEqual([expect.objectContaining({ id: firstId, status: "draft", strengths: "Typed after the first save" })])
  })

  it("will not publish a new assessment beside a draft saved in another window", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })

    expect(() => service.publishAssessment(
      input({ expectedPublishedCount: 0, newAssessmentId: secondId }),
      { coachId, database, now },
    )).toThrowError(expect.objectContaining({ code: "CONFLICT" }))
    expect(rows()).toHaveLength(1)
  })

  it("refuses to overwrite changes saved in another window, but not a repeat of its own save", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    const opened = rows()[0].updatedAt.toISOString()
    const later = new Date("2026-10-04T11:00:00+05:30")
    service.saveAssessmentDraft(
      input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Window one" }),
      { coachId, database, now: later },
    )

    expect(() => service.saveAssessmentDraft(
      input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Window two" }),
      { coachId, database, now: new Date("2026-10-04T11:05:00+05:30") },
    )).toThrowError(expect.objectContaining({
      code: "CHANGED_ELSEWHERE",
      currentStatus: "draft",
      currentUpdatedAt: later.toISOString(),
    }))
    expect(rows()[0].strengths).toBe("Window one")

    // Window one sending the same thing again is not a conflict with itself.
    expect(service.saveAssessmentDraft(
      input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Window one" }),
      { coachId, database, now: new Date("2026-10-04T11:10:00+05:30") },
    ).assessmentId).toBe(firstId)
  })

  it("says the assessment is already published when a draft save reaches a published one", () => {
    service.publishAssessment(input({ newAssessmentId: firstId }), { coachId, database, now })

    expect(() => service.saveAssessmentDraft(
      input({ assessmentId: firstId, strengths: "Edited as a draft" }),
      { coachId, database, now },
    )).toThrowError(expect.objectContaining({ code: "CONFLICT", currentStatus: "published" }))
  })

  it("keeps who first published beside when it was first published", () => {
    service.publishAssessment(input({ newAssessmentId: firstId }), { coachId, database, now })
    // Stand-in for a different head coach having made the first publish.
    const firstPublisher = playerId
    database.update(schema.playerAssessments)
      .set({ publishedByAccountId: firstPublisher })
      .where(eq(schema.playerAssessments.id, firstId)).run()
    service.publishAssessment(
      input({ assessmentId: firstId, strengths: "Updated" }),
      { coachId, database, now: new Date("2026-10-05T10:00:00+05:30") },
    )

    // Before: the update replaced the publisher but kept the first date, so the
    // two described different publishes. The update is recorded as an update.
    const updated = rows()[0]
    expect(updated.publishedByAccountId).toBe(firstPublisher)
    expect(updated.publishedAt?.toISOString()).toBe(now.toISOString())
    expect(updated.updatedByAccountId).toBe(coachId)
    expect(updated.revision).toBe(2)
  })

  it("orders two assessments on one date by when they were written", () => {
    service.publishAssessment(
      input({ assessedOn: "2026-10-01", newAssessmentId: firstId, ratings: { footwork: 2 } }),
      { coachId, database, now },
    )
    service.publishAssessment(
      input({ assessedOn: "2026-10-01", newAssessmentId: secondId, ratings: { footwork: 5 } }),
      { coachId, database, now: new Date("2026-10-04T12:00:00+05:30") },
    )

    // Before: each counted the other as "previous".
    expect(queries.getPublishedAssessmentForPlayer(playerId, secondId, { database })?.previous)
      .toMatchObject({ overall: 2 })
    expect(queries.getPublishedAssessmentForPlayer(playerId, firstId, { database })?.previous)
      .toBeNull()
  })

  it("lets window two save over window one once it has been told, using the version it was told about", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    const opened = rows()[0].updatedAt.toISOString()
    service.saveAssessmentDraft(
      input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Window one" }),
      { coachId, database, now: new Date("2026-10-04T11:00:00+05:30") },
    )
    let refusal: unknown
    try {
      service.saveAssessmentDraft(
        input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Window two" }),
        { coachId, database, now: new Date("2026-10-04T11:05:00+05:30") },
      )
    } catch (error) {
      refusal = error
    }
    const told = (refusal as { currentUpdatedAt: string }).currentUpdatedAt

    // Before: every retry was refused, because the form's version never moved
    // on, and the only way out was to leave and lose window two's work.
    service.saveAssessmentDraft(
      input({ assessmentId: firstId, expectedUpdatedAt: told, strengths: "Window two" }),
      { coachId, database, now: new Date("2026-10-04T11:10:00+05:30") },
    )
    expect(rows()[0].strengths).toBe("Window two")
  })

  it("says a draft was published elsewhere, and lets the update that follows through", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    const opened = rows()[0].updatedAt.toISOString()
    // Tab B publishes the draft.
    service.publishAssessment(
      input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Tab B" }),
      { coachId, database, now: new Date("2026-10-04T11:00:00+05:30") },
    )

    // Tab A, still showing the draft, saves it. Before: "already published,
    // publish your changes", then the publish was refused as out of date.
    let refusal: { code?: string; currentStatus?: string; currentUpdatedAt?: string } = {}
    try {
      service.saveAssessmentDraft(
        input({ assessmentId: firstId, expectedUpdatedAt: opened, strengths: "Tab A" }),
        { coachId, database, now: new Date("2026-10-04T11:05:00+05:30") },
      )
    } catch (error) {
      refusal = error as typeof refusal
    }
    expect(refusal).toMatchObject({ code: "CHANGED_ELSEWHERE", currentStatus: "published" })

    service.publishAssessment(
      input({ assessmentId: firstId, expectedUpdatedAt: refusal.currentUpdatedAt, strengths: "Tab A" }),
      { coachId, database, now: new Date("2026-10-04T11:10:00+05:30") },
    )
    expect(rows()).toEqual([expect.objectContaining({ status: "published", strengths: "Tab A" })])
  })

  it("checks a draft's first publish against the count the form opened with", () => {
    // Both tabs opened with nothing published. Tab 1 publishes.
    service.publishAssessment(
      input({ expectedPublishedCount: 0, newAssessmentId: firstId }),
      { coachId, database, now },
    )
    // Tab 2 saves a draft first (allowed: nothing reaches the player)...
    service.saveAssessmentDraft(
      input({ expectedPublishedCount: 0, newAssessmentId: secondId, strengths: "Tab 2" }),
      { coachId, database, now },
    )

    // ...then publishes it. Before: no check at all on this path, and the
    // player got a second published copy.
    expect(() => service.publishAssessment(
      input({ assessmentId: secondId, expectedPublishedCount: 0, strengths: "Tab 2" }),
      { coachId, database, now },
    )).toThrowError(expect.objectContaining({ code: "CONFLICT", currentPublishedCount: 1 }))
    expect(rows().filter((row) => row.status === "published")).toHaveLength(1)

    // Told, and sure it is a separate assessment, the coach publishes again.
    service.publishAssessment(
      input({ assessmentId: secondId, expectedPublishedCount: 1, strengths: "Tab 2" }),
      { coachId, database, now },
    )
    expect(rows().filter((row) => row.status === "published")).toHaveLength(2)
  })

  it("publishes beside another window's draft only once the coach has been told about it", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })

    let refusal: { currentDraftId?: string } = {}
    try {
      service.publishAssessment(
        input({ expectedPublishedCount: 0, newAssessmentId: secondId, strengths: "This window" }),
        { coachId, database, now },
      )
    } catch (error) {
      refusal = error as typeof refusal
    }
    expect(refusal.currentDraftId).toBe(firstId)

    // Before: refused every time, so this window's work could not be kept.
    service.publishAssessment(
      input({
        expectedPublishedCount: 0,
        knownDraftId: refusal.currentDraftId,
        newAssessmentId: secondId,
        strengths: "This window",
      }),
      { coachId, database, now },
    )
    expect(rows()).toHaveLength(2)
    expect(rows().find((row) => row.id === firstId)?.status).toBe("draft")
    // A second draft is still not allowed: a player has one at a time.
    expect(() => service.saveAssessmentDraft(
      input({ knownDraftId: firstId, newAssessmentId: "50000000-0000-4000-8000-000000000003" }),
      { coachId, database, now },
    )).toThrowError(expect.objectContaining({ code: "CONFLICT", currentDraftId: firstId }))
  })

  it("makes a draft discarded elsewhere again under its old id, so its page still opens", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    service.discardAssessmentDraft({ assessmentId: firstId }, { coachId, database })

    expect(() => service.saveAssessmentDraft(
      input({ assessmentId: firstId, strengths: "Kept" }),
      { coachId, database, now },
    )).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }))

    // The form's next save sends the old id as the new one.
    service.saveAssessmentDraft(
      input({ newAssessmentId: firstId, strengths: "Kept" }),
      { coachId, database, now },
    )
    // /coach/assessments/<firstId> re-renders after the save; before, it was
    // "page not found" over the coach's work.
    expect(queries.getCoachAssessment(firstId, coachId, { database })?.assessment)
      .toMatchObject({ status: "draft", strengths: "Kept" })
  })

  it("tells a discard of a draft that is already gone apart from one that was published", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    service.discardAssessmentDraft({ assessmentId: firstId }, { coachId, database })

    expect(() => service.discardAssessmentDraft({ assessmentId: firstId }, { coachId, database }))
      .toThrowError(expect.objectContaining({ code: "NOT_FOUND" }))
  })

  it("never offers a new assessment as its own previous one after its first publish", () => {
    service.publishAssessment(
      input({ assessedOn: "2026-10-01", newAssessmentId: firstId, ratings: { footwork: 2 } }),
      { coachId, database, now },
    )
    // The new form publishes, and its page refreshes with a fresh list.
    service.publishAssessment(
      input({ expectedPublishedCount: 1, newAssessmentId: secondId, ratings: { footwork: 4 } }),
      { coachId, database, now },
    )
    const start = queries.getAssessmentStart(playerId, coachId, { database })
    const options = start?.previousOptions ?? []

    // Before: the list's newest entry was this assessment, so "Previous
    // assessment" and every "Last time" showed its own scores.
    expect(contracts.previousForDate(options, "2026-10-04")).toMatchObject({ overall: 4 })
    expect(contracts.previousForDate(options, "2026-10-04", secondId))
      .toMatchObject({ assessedOn: "2026-10-01", overall: 2 })
  })

  it("compares a new assessment with the one before the date the coach picks", () => {
    service.publishAssessment(
      input({ assessedOn: "2026-09-01", newAssessmentId: firstId, ratings: { footwork: 2 } }),
      { coachId, database, now },
    )
    service.publishAssessment(
      input({ assessedOn: "2026-10-01", newAssessmentId: secondId, ratings: { footwork: 5 } }),
      { coachId, database, now },
    )
    const start = queries.getAssessmentStart(playerId, coachId, { database })

    expect(start?.publishedCount).toBe(2)
    expect(contracts.previousForDate(start?.previousOptions ?? [], "2026-10-04"))
      .toMatchObject({ assessedOn: "2026-10-01" })
    // Backdated between the two: compared with September, not October.
    expect(contracts.previousForDate(start?.previousOptions ?? [], "2026-09-15"))
      .toMatchObject({ assessedOn: "2026-09-01" })
    expect(contracts.previousForDate(start?.previousOptions ?? [], "2026-08-01")).toBeNull()
  })
})
