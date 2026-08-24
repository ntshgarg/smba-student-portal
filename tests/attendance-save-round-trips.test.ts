import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-attendance-round-trips-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * Production runs libSQL over the network with the synchronous driver, so every
 * prepared statement inside the attendance transaction is a blocking round trip
 * holding the academy's only write lock. This measures the real statement count
 * rather than reading the source, because the defect this guards against is not
 * a particular call site -- it is any per-player read creeping back into the
 * loop, however it is spelled.
 */
describe("attendance save round trips", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let sessionService: typeof import("@/lib/sessions/service")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const seriesId = "round-trip-series"
  const occurrenceId = "round-trip-occurrence"
  const secondOccurrenceId = "round-trip-occurrence-earlier"
  const now = new Date("2026-08-20T19:00:00+05:30")
  const playerIds = Array.from({ length: 12 }, (_, index) => `round-trip-player-${index}`)

  let statementCount = 0
  const originalPrepare = BetterSqlite3.prototype.prepare

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    sessionService = await import("@/lib/sessions/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })

    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: "Round trip weekday",
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()

    database.insert(schema.sessionOccurrences).values([
      {
        id: occurrenceId,
        seriesId,
        occurrenceDate: "2026-08-20",
        startsAt: new Date("2026-08-20T17:00:00+05:30"),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled",
        createdAt: now,
      },
      {
        // A second Thursday, so each measurement starts from an unmarked
        // register rather than colliding with the previous one's marks.
        id: secondOccurrenceId,
        seriesId,
        occurrenceDate: "2026-08-13",
        startsAt: new Date("2026-08-13T17:00:00+05:30"),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled",
        createdAt: now,
      },
    ]).run()

    playerIds.forEach((playerId, index) => {
      database.insert(schema.accounts).values({
        id: playerId,
        fullName: `Round Trip Player ${index}`,
        normalizedName: `round trip player ${index}`,
        requestedRole: "player",
        role: "player",
        approvalStatus: "approved",
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      }).run()
      database.insert(schema.playerEnrollments).values({
        accountId: playerId,
        level: "Beginner",
        batch: "Weekday",
        academyPlan: "weekday-3-day",
        status: "active",
        trainingStartOn: "2026-08-01",
        trainingStartConfirmedAt: now,
        updatedAt: now,
      }).run()
      const assignmentId = `round-trip-assignment-${index}`
      database.insert(schema.sessionAssignments).values({
        id: assignmentId,
        accountId: playerId,
        seriesId,
        effectiveFrom: "2026-08-01",
        assignedByAccountId: coachId,
        assignedAt: now,
      }).run()
      database.insert(schema.sessionAssignmentWeekdays).values({
        id: `round-trip-weekday-${index}`,
        assignmentId,
        weekday: 4,
      }).run()
    })
  })

  afterAll(() => {
    BetterSqlite3.prototype.prepare = originalPrepare
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  function countStatements(run: () => void) {
    statementCount = 0
    BetterSqlite3.prototype.prepare = function patched(this: BetterSqlite3.Database, ...args) {
      statementCount += 1
      return originalPrepare.apply(this, args as Parameters<typeof originalPrepare>)
    } as typeof originalPrepare
    try {
      run()
    } finally {
      BetterSqlite3.prototype.prepare = originalPrepare
    }
    return statementCount
  }

  function save(count: number, target: string) {
    sessionService.saveSessionAttendanceRecords({
      database,
      coachId,
      now,
      referenceDate: "2026-08-20",
      changes: playerIds.slice(0, count).map((playerId) => ({
        playerId,
        occurrenceId: target,
        choice: "present" as const,
        expectedChoice: "cleared" as const,
      })),
    })
  }

  it("does not issue a per-player read for each extra player on the register", () => {
    const forThree = countStatements(() => save(3, secondOccurrenceId))
    const forTwelve = countStatements(() => save(12, occurrenceId))

    // Nine more players must not cost nine times the statements. The marginal
    // cost per player is the adjustment reconcile, which is one statement each;
    // the eight per-player reads this batching removed would put the delta near
    // 72 rather than near 9.
    const marginalPerPlayer = (forTwelve - forThree) / 9
    expect(marginalPerPlayer).toBeLessThanOrEqual(3)
    expect(forTwelve).toBeLessThan(forThree * 3)
  })

  it("still writes every mark it was given", () => {
    save(12, occurrenceId)
    const stored = database.select().from(schema.sessionAttendanceRecords).all()
      .filter((record) => record.occurrenceId === occurrenceId)
    expect(stored).toHaveLength(12)
    expect(stored.every((record) => record.choice === "present")).toBe(true)
  })
})
