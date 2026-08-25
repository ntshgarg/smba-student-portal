import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-player-dashboard-scope-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

const reads = vi.hoisted(() => ({
  listSessionAssignments: vi.fn(),
  listSessionAssignmentsForPlayers: vi.fn(),
  listSessionOccurrences: vi.fn(),
  listSessionOccurrencesForSeries: vi.fn(),
}))

// The real readers, watched rather than replaced: the point is which one the
// player dashboard reaches for and what it hands it, not what it gets back.
vi.mock("@/lib/sessions/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sessions/database")>()
  reads.listSessionAssignments.mockImplementation(actual.listSessionAssignments)
  reads.listSessionAssignmentsForPlayers.mockImplementation(actual.listSessionAssignmentsForPlayers)
  reads.listSessionOccurrences.mockImplementation(actual.listSessionOccurrences)
  reads.listSessionOccurrencesForSeries.mockImplementation(actual.listSessionOccurrencesForSeries)
  return { ...actual, ...reads }
})

/*
 * A player's next session can only be an occurrence of a series they are
 * assigned to -- `assignmentCoversOccurrence` (`lib/sessions/domain.ts:274`)
 * discards everything else -- and the academy's other players' occurrences are
 * exactly what "everything else" is. This pins the two reads the dashboard is
 * allowed to make, because a regression here is invisible: the returned session
 * stays correct while the read grows with the academy.
 */
describe("player dashboard session read scope", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  const now = new Date("2026-08-03T02:00:00.000Z")
  const today = "2026-08-03"
  let playerId: string
  let decoyPlayerId: string
  let seriesId: string
  let decoySeriesId: string

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const accountService = await import("@/lib/auth/account-service")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    const { assignSessionRecords, createSessionSeriesRecords } = await import(
      "@/lib/sessions/service"
    )
    database = prepareDatabase({ seed: true })

    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    playerId = accountService.registerAccount("Scoped Player", "player")
    decoyPlayerId = accountService.registerAccount("Other Player", "player")
    accountService.approveRegistration(playerId, coach.accountId)
    accountService.approveRegistration(decoyPlayerId, coach.accountId);

    [playerId, decoyPlayerId].forEach((accountId) => {
      database.update(schema.playerEnrollments).set({
        academyPlan: "weekday-3-day",
        batch: "Weekday",
        level: "Beginner",
        status: "unassigned",
        trainingStartOn: "2026-08-03",
        updatedAt: now,
      }).where(eq(schema.playerEnrollments.accountId, accountId)).run()
    })

    const series = (startTime: string) => createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-08-03",
        endsOn: "2026-08-31",
        weekdays: [1, 3, 5],
        startTime,
        durationMinutes: 60,
      },
    })
    seriesId = series("18:00")
    decoySeriesId = series("07:00")

    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: "2026-08-03",
      now,
      playerId,
      seriesId,
      weekdays: [1, 3, 5],
    })
    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: "2026-08-03",
      now,
      playerId: decoyPlayerId,
      seriesId: decoySeriesId,
      weekdays: [1, 3, 5],
    })
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("asks only for this player's assignments and only for the series they cover", async () => {
    const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")

    const dashboard = await new SqlitePortalRepository().getDashboard(playerId)

    const ownOccurrenceIds = database.select({ id: schema.sessionOccurrences.id })
      .from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).all()
      .map((row) => row.id)
    expect(ownOccurrenceIds).toContain(dashboard?.nextSession?.id)
    expect(reads.listSessionAssignmentsForPlayers).toHaveBeenCalledWith([playerId])
    expect(reads.listSessionOccurrencesForSeries)
      .toHaveBeenCalledWith(today, "2027-12-31", [seriesId])
    // The decoy player's series is the whole point: an unscoped read fetches it
    // and then throws it away.
    expect(reads.listSessionOccurrencesForSeries.mock.calls
      .some((call) => (call[2] as readonly string[]).includes(decoySeriesId))).toBe(false)
    expect(reads.listSessionAssignments).not.toHaveBeenCalled()
    expect(reads.listSessionOccurrences).not.toHaveBeenCalled()
  })
})
