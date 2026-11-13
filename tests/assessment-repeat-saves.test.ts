import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-assessment-repeat-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/**
 * M142/M143: a first publish repeated after a dropped connection, or made from
 * a second tab, gave the player two copies, and a repeated first "Save draft"
 * said "already has a draft".
 */
describe("assessment saves that are repeated or race", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let service: typeof import("@/lib/assessments/service")
  let queries: typeof import("@/lib/assessments/queries")

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
    expect(rows()[0]).toMatchObject({ id: firstId, status: "published" })
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

  it("tells a discard of a draft that is already gone apart from one that was published", () => {
    service.saveAssessmentDraft(input({ newAssessmentId: firstId }), { coachId, database, now })
    service.discardAssessmentDraft({ assessmentId: firstId }, { coachId, database })

    expect(() => service.discardAssessmentDraft({ assessmentId: firstId }, { coachId, database }))
      .toThrowError(expect.objectContaining({ code: "NOT_FOUND" }))
  })
})
