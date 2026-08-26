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

    /*
     * Nine more players must cost nothing at all. Every read the save makes is
     * now one statement for the whole register, including the adjustment
     * reconcile that was the last per-player holdout at one statement each --
     * measured 10 statements at one player and 21 at twelve before it was
     * batched, and 10 at both after.
     */
    const marginalPerPlayer = (forTwelve - forThree) / 9
    expect(marginalPerPlayer).toBe(0)
  })

  it("still writes every mark it was given", () => {
    save(12, occurrenceId)
    const stored = database.select().from(schema.sessionAttendanceRecords).all()
      .filter((record) => record.occurrenceId === occurrenceId)
    expect(stored).toHaveLength(12)
    expect(stored.every((record) => record.choice === "present")).toBe(true)
  })

  /*
   * The register above has no attendance adjustments on it, which is the cheap
   * case: the reconcile finds nothing and stops. This is the expensive one --
   * every player on the register holds a make-up completed on the session's own
   * date -- where the reconcile also probes presence and writes. Its own series
   * and Tuesdays, built here rather than in `beforeAll`, so the measurements
   * above stay on a register with no adjustments at all.
   */
  it("does not issue a per-player read when every player holds an adjustment", () => {
    const adjustmentSeriesId = "round-trip-adjustment-series"
    const completions = {
      three: { id: "round-trip-adjustment-completion-three", date: "2026-08-04" },
      twelve: { id: "round-trip-adjustment-completion-twelve", date: "2026-08-11" },
    }
    // Only an id for the adjustments to point at: no change below targets a
    // source, so nothing reads these.
    const sources = {
      three: { id: "round-trip-adjustment-source-three", date: "2026-08-03" },
      twelve: { id: "round-trip-adjustment-source-twelve", date: "2026-08-10" },
    }
    const publishedAt = new Date("2026-08-12T10:00:00+05:30")
    const reviewRequiredAt = new Date("2026-08-14T10:00:00+05:30")

    database.insert(schema.sessionSeries).values({
      id: adjustmentSeriesId,
      title: "Round trip make-up",
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values(
      [completions.three, completions.twelve, sources.three, sources.twelve].map(
        ({ date, id }) => ({
          id,
          seriesId: adjustmentSeriesId,
          occurrenceDate: date,
          startsAt: new Date(`${date}T17:00:00+05:30`),
          durationMinutes: 60,
          venue: "SMBA Court",
          status: "scheduled" as const,
          createdAt: now,
        }),
      ),
    ).run()

    playerIds.forEach((playerId, index) => {
      const assignmentId = `round-trip-adjustment-assignment-${index}`
      database.insert(schema.sessionAssignments).values({
        id: assignmentId,
        accountId: playerId,
        seriesId: adjustmentSeriesId,
        effectiveFrom: "2026-08-01",
        assignedByAccountId: coachId,
        assignedAt: now,
      }).run()
      database.insert(schema.sessionAssignmentWeekdays).values({
        id: `round-trip-adjustment-weekday-${index}`,
        assignmentId,
        weekday: 2,
      }).run()
      database.insert(schema.attendanceAdjustments).values(
        (["three", "twelve"] as const).map((cohort) => ({
          id: `round-trip-adjustment-${cohort}-${index}`,
          type: "makeup" as const,
          playerId,
          sourceOccurrenceId: sources[cohort].id,
          completedOn: completions[cohort].date,
          completionOccurrenceId: completions[cohort].id,
          reason: null,
          publishedByAccountId: coachId,
          publishedAt,
          reviewRequiredAt,
          voidedByAccountId: null,
          voidedAt: null,
        })),
      ).run()
    })

    const forThree = countStatements(() => save(3, completions.three.id))
    const forTwelve = countStatements(() => save(12, completions.twelve.id))

    // Three more statements than the adjustment-free register -- the reconcile's
    // select, its presence probe and one update for the whole batch -- and not
    // one more for the ninth extra player. Per pair those three were per player.
    const marginalPerPlayer = (forTwelve - forThree) / 9
    expect(marginalPerPlayer).toBe(0)

    // The batch is a statement shortcut, not a change of outcome: each player
    // now has a saved Present at the session the make-up was completed at, so
    // every one of those adjustments stops needing review.
    const reviewStates = database.select().from(schema.attendanceAdjustments).all()
      .filter((adjustment) => adjustment.completionOccurrenceId === completions.twelve.id)
    expect(reviewStates).toHaveLength(12)
    expect(reviewStates.every((adjustment) => adjustment.reviewRequiredAt === null)).toBe(true)
  })
})
