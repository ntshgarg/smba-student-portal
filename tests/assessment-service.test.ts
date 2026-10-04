import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-assessment-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("player assessments", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let service: typeof import("@/lib/assessments/service")
  let queries: typeof import("@/lib/assessments/queries")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const playerId = "10000000-0000-4000-8000-0000000000a1"
  const secondPlayerId = "10000000-0000-4000-8000-0000000000a2"
  const pausedPlayerId = "10000000-0000-4000-8000-0000000000a3"
  const now = new Date("2026-10-04T10:00:00+05:30")

  function addPlayer(id: string, name: string, status: "active" | "paused") {
    database.insert(schema.accounts).values({
      id,
      fullName: name,
      normalizedName: name.toLowerCase(),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      level: "Intermediate",
      batch: "Weekday",
      academyPlan: "weekday-3-day",
      status,
      trainingStartOn: "2026-07-01",
      updatedAt: now,
    }).run()
  }

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

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    service = await import("@/lib/assessments/service")
    queries = await import("@/lib/assessments/queries")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    addPlayer(playerId, "Aarav Nair", "active")
    addPlayer(secondPlayerId, "Meera Iyer", "active")
    addPlayer(pausedPlayerId, "Paused Player", "paused")
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("saves a draft the player cannot see, then publishes it", () => {
    const { assessmentId } = service.saveAssessmentDraft(input(), { coachId, database, now })
    expect(queries.listPublishedAssessmentsForPlayer(playerId, { database })).toEqual([])

    service.publishAssessment(input({ assessmentId, ratings: { footwork: 4, "mental-focus": 5 } }), {
      coachId,
      database,
      now,
    })
    const published = queries.listPublishedAssessmentsForPlayer(playerId, { database })
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      id: assessmentId,
      overall: 4.5,
      revision: 1,
      status: "published",
    })
  })

  it("keeps a published assessment published when the coach edits it, and counts the revision", () => {
    const [published] = queries.listPublishedAssessmentsForPlayer(playerId, { database })
    const later = new Date("2026-10-05T10:00:00+05:30")
    service.publishAssessment(
      input({ assessmentId: published.id, ratings: { footwork: 5, "mental-focus": 5 }, strengths: "Quicker." }),
      { coachId, database, now: later },
    )
    const [edited] = queries.listPublishedAssessmentsForPlayer(playerId, { database })
    expect(edited).toMatchObject({ overall: 5, revision: 2, status: "published", strengths: "Quicker." })
    expect(edited.publishedAt).toBe(published.publishedAt)
  })

  it("refuses to save a published assessment as a draft", () => {
    const [published] = queries.listPublishedAssessmentsForPlayer(playerId, { database })
    expect(() => service.saveAssessmentDraft(input({ assessmentId: published.id }), { coachId, database, now }))
      .toThrowError(expect.objectContaining({ code: "CONFLICT" }))
  })

  it("allows only one open draft per player", () => {
    service.saveAssessmentDraft(input({ playerId: secondPlayerId }), { coachId, database, now })
    expect(() => service.saveAssessmentDraft(input({ playerId: secondPlayerId }), { coachId, database, now }))
      .toThrowError(expect.objectContaining({ code: "CONFLICT" }))
  })

  it("rejects bad input without writing anything", () => {
    const before = database.select().from(schema.playerAssessments).all().length
    const cases: Array<[Partial<import("@/lib/assessments/contracts").SaveAssessmentInput>, string]> = [
      [{ assessedOn: "2026-10-05" }, "assessedOn"],
      [{ assessedOn: "2026-02-31" }, "assessedOn"],
      [{ assessedOn: "yesterday" }, "assessedOn"],
      [{ ratings: { footwork: 6 } }, "ratings"],
      [{ ratings: { footwork: 3.5 } }, "ratings"],
      [{ ratings: { footwork: 0 } }, "ratings"],
      [{ ratings: { "not-a-skill": 3 } }, "ratings"],
      [{ strengths: "x".repeat(2_001) }, "strengths"],
      [{ playerId: "" }, "playerId"],
    ]
    for (const [overrides, field] of cases) {
      expect(() => service.saveAssessmentDraft(input(overrides), { coachId, database, now }))
        .toThrowError(expect.objectContaining({ code: "INVALID_INPUT", field }))
    }
    expect(database.select().from(schema.playerAssessments).all()).toHaveLength(before)
  })

  it("will not publish an assessment with nothing rated, but will draft one", () => {
    expect(() => service.publishAssessment(input({ ratings: {} }), { coachId, database, now }))
      .toThrowError(expect.objectContaining({ code: "INVALID_INPUT", field: "ratings" }))
  })

  it("is only for active players", () => {
    expect(() => service.saveAssessmentDraft(input({ playerId: pausedPlayerId }), { coachId, database, now }))
      .toThrowError(expect.objectContaining({ code: "PLAYER_UNAVAILABLE" }))
    expect(() => service.saveAssessmentDraft(input({ playerId: "missing" }), { coachId, database, now }))
      .toThrowError(expect.objectContaining({ code: "PLAYER_UNAVAILABLE" }))
  })

  it("is only for the head coach", () => {
    expect(() => service.saveAssessmentDraft(input(), { coachId: "not-a-coach", database, now })).toThrow()
  })

  it("discards a draft but never a published assessment", () => {
    const draft = queries.getAssessmentStart(secondPlayerId, coachId, { database })
    expect(draft?.draftId).toBeTruthy()
    service.discardAssessmentDraft({ assessmentId: draft!.draftId! }, { coachId, database })
    expect(queries.getAssessmentStart(secondPlayerId, coachId, { database })?.draftId).toBeNull()

    const [published] = queries.listPublishedAssessmentsForPlayer(playerId, { database })
    expect(() => service.discardAssessmentDraft({ assessmentId: published.id }, { coachId, database }))
      .toThrowError(expect.objectContaining({ code: "NOT_FOUND" }))
    expect(database.select().from(schema.playerAssessments)
      .where(eq(schema.playerAssessments.id, published.id)).get()).toBeTruthy()
  })

  it("lists never-assessed players first, then whoever has waited longest", () => {
    service.publishAssessment(input({ assessedOn: "2026-08-01", playerId: secondPlayerId }), { coachId, database, now })
    const home = queries.listAssessmentHome(coachId, { database })
    expect(home.players.map((player) => player.name)).toEqual(["Meera Iyer", "Aarav Nair"])
    service.saveAssessmentDraft(input({ playerId: secondPlayerId, ratings: { footwork: 2 } }), { coachId, database, now })
    const withDraft = queries.listAssessmentHome(coachId, { database })
    expect(withDraft.drafts).toBe(1)
    expect(withDraft.players[0].draft).toMatchObject({ rated: 1 })
  })

  it("shows the player only their own published assessments, with the one before for comparison", () => {
    service.publishAssessment(input({ assessedOn: "2026-09-01", ratings: { footwork: 3 } }), { coachId, database, now })
    const list = queries.listPublishedAssessmentsForPlayer(playerId, { database })
    expect(list.map((item) => item.assessedOn)).toEqual(["2026-10-04", "2026-09-01"])
    const detail = queries.getPublishedAssessmentForPlayer(playerId, list[0].id, { database })
    expect(detail?.previous).toMatchObject({ assessedOn: "2026-09-01", overall: 3 })
    expect(queries.getPublishedAssessmentForPlayer(secondPlayerId, list[0].id, { database })).toBeNull()
  })
})
