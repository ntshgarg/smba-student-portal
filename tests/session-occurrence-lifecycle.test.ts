import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-occurrence-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("stored session occurrence lifecycle", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-03T04:30:00.000Z"))
    accountService = await import("@/lib/auth/account-service")
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    database = client.initializeDatabase()
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("creates a bounded schedule atomically", async () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    const { createSessionSeriesRecords } = await import("@/lib/sessions/service")
    const sqlite = database.$client
    const seriesBefore = database.select().from(schema.sessionSeries).all().length

    sqlite.exec(`
      CREATE TEMP TRIGGER reject_test_occurrence
      BEFORE INSERT ON session_occurrences
      BEGIN
        SELECT RAISE(ABORT, 'forced occurrence failure');
      END;
    `)
    try {
      expect(() => createSessionSeriesRecords({
        coachId: coach.accountId,
        database,
        now: new Date(),
        input: {
          programme: "Beginner",
          batch: "Weekday",
          venue: "SMBA Court",
          startsOn: "2026-08-03",
          endsOn: "2026-08-31",
          weekdays: [1, 3, 5],
          startTime: "07:00",
          durationMinutes: 60,
        },
      })).toThrow("forced occurrence failure")
    } finally {
      sqlite.exec("DROP TRIGGER reject_test_occurrence")
    }

    expect(database.select().from(schema.sessionSeries).all()).toHaveLength(seriesBefore)
    expect(database.select().from(schema.sessionRecurrenceRules).all()).toHaveLength(0)
    expect(database.select().from(schema.sessionOccurrences).all()).toHaveLength(0)
  })

  it("keeps reads pure and backfills missing dates without reviving cancellations", async () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    const playerId = accountService.registerAccount("Read Only Player", "player")
    accountService.approveRegistration(playerId, coach.accountId)
    const now = new Date()
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      batch: "Weekday",
      joinedAt: new Date("2026-08-03T00:00:00.000Z"),
      level: "Beginner",
      status: "unassigned",
      updatedAt: now,
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()

    const {
      assignSessionRecords,
      cancelSessionOccurrence,
      createSessionSeriesRecords,
    } = await import("@/lib/sessions/service")
    const seriesId = createSessionSeriesRecords({
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
        startTime: "06:00",
        durationMinutes: 60,
      },
    })
    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: "2026-08-03",
      now,
      playerId,
      seriesId,
      weekdays: [1, 3, 5],
    })

    const generated = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).all()
    expect(generated.map((occurrence) => occurrence.occurrenceDate)).toEqual([
      "2026-08-03", "2026-08-05", "2026-08-07", "2026-08-10",
      "2026-08-12", "2026-08-14", "2026-08-17", "2026-08-19",
      "2026-08-21", "2026-08-24", "2026-08-26", "2026-08-28",
      "2026-08-31",
    ])

    const cancelled = generated.find((occurrence) => occurrence.occurrenceDate === "2026-08-05")
    const missing = generated.find((occurrence) => occurrence.occurrenceDate === "2026-08-07")
    if (!cancelled || !missing) throw new Error("Expected generated occurrences were not found.")
    cancelSessionOccurrence({
      coachId: coach.accountId,
      database,
      now,
      occurrenceId: cancelled.id,
      referenceDate: "2026-08-03",
    })
    database.delete(schema.sessionOccurrences).where(eq(schema.sessionOccurrences.id, missing.id)).run()

    const { backfillSessionOccurrences } = await import("@/lib/sessions/backfill")
    expect(backfillSessionOccurrences({ database, now })).toEqual({
      examinedSeries: 1,
      insertedOccurrences: 1,
    })
    expect(backfillSessionOccurrences({ database, now }).insertedOccurrences).toBe(0)
    expect(database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.seriesId, seriesId),
      eq(schema.sessionOccurrences.occurrenceDate, "2026-08-05"),
    )).all()).toEqual([expect.objectContaining({ id: cancelled.id, status: "cancelled" })])

    const occurrenceCount = database.select().from(schema.sessionOccurrences).all().length
    const sqlite = database.$client
    sqlite.pragma("query_only = ON")
    try {
      const { listSessionOccurrences } = await import("@/lib/sessions/database")
      const { getPlayerAttendanceInput } = await import("@/lib/attendance/database")
      const { getPlayerAttendanceRecord } = await import("@/lib/attendance/player-record")
      const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")

      expect(listSessionOccurrences("2026-08-01", "2026-08-31")).toHaveLength(13)
      expect(getPlayerAttendanceInput(playerId, "2026-08", "2026-08-03", now.toISOString(), database)).not.toBeNull()
      expect(getPlayerAttendanceRecord(playerId, now)).not.toBeNull()
      expect(await new SqlitePortalRepository().getDashboard(playerId)).not.toBeNull()
    } finally {
      sqlite.pragma("query_only = OFF")
    }
    expect(database.select().from(schema.sessionOccurrences).all()).toHaveLength(occurrenceCount)
  })
})
