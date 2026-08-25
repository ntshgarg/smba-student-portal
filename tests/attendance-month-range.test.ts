import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, gte, lt } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { monthDateBounds } from "@/lib/date-keys"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-month-range-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

const coachId = "00000000-0000-4000-8000-000000000001"
const assignedSeriesId = "month-range-assigned-series"
const otherSeriesId = "month-range-other-series"
const playerId = "month-range-player"
const unassignedPlayerId = "month-range-unassigned-player"
const setupNow = new Date("2026-01-05T12:00:00+05:30")

// Mondays either side of the December boundary the bounds helper has to roll.
const assignedDates = ["2025-12-01", "2025-12-29", "2026-01-05", "2026-01-26"]

describe("monthDateBounds", () => {
  it("rolls December into the next January", () => {
    expect(monthDateBounds("2025-12")).toEqual({
      start: "2025-12-01",
      endExclusive: "2026-01-01",
    })
  })

  it("refuses a key that is not YYYY-MM rather than quietly selecting nothing", () => {
    // `LIKE '2026-%'` matched the whole year; the bounds for "2026" would be the
    // empty `["2026-01", "2026-01-01")`, which a publish gate reads as "clean".
    ;["2026", "2026-13", "2026-00", "2026-1", "26-01", ""].forEach((month) => {
      expect(() => monthDateBounds(month)).toThrow("Invalid month.")
    })
  })

  it("spans exactly the calendar length of every month, leap February included", () => {
    const dayMs = 24 * 60 * 60 * 1000
    const lengths = ["2024-01", "2024-02", "2025-02", "2024-04", "2024-12"].map((month) => {
      const { start, endExclusive } = monthDateBounds(month)
      return (Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / dayMs
    })
    expect(lengths).toEqual([31, 29, 28, 30, 31])
  })
})

describe("month-scoped occurrence reads", () => {
  let attendanceDatabase: typeof import("@/lib/attendance/database")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    attendanceDatabase = await import("@/lib/attendance/database")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })

    const series = {
      title: "Month range series",
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2025-12-01",
      endsOn: "2026-01-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: setupNow,
    } as const
    database.insert(schema.sessionSeries).values([
      { id: assignedSeriesId, ...series },
      { id: otherSeriesId, ...series },
    ]).run()

    // The other series runs on the same dates, so anything that leaks into the
    // player's read doubles their eligible count rather than merely padding it.
    database.insert(schema.sessionOccurrences).values(
      [assignedSeriesId, otherSeriesId].flatMap((seriesId) => assignedDates.map((occurrenceDate) => ({
        id: `${seriesId}-${occurrenceDate}`,
        seriesId,
        occurrenceDate,
        startsAt: new Date(`${occurrenceDate}T07:00:00+05:30`),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled" as const,
        createdAt: setupNow,
      }))),
    ).run()

    ;[playerId, unassignedPlayerId].forEach((id) => {
      database.insert(schema.accounts).values({
        id,
        fullName: id,
        normalizedName: id,
        requestedRole: "player",
        role: "player",
        approvalStatus: "approved",
        approvedAt: setupNow,
        createdAt: setupNow,
        updatedAt: setupNow,
      }).run()
      database.insert(schema.playerEnrollments).values({
        accountId: id,
        level: "Adult",
        batch: "Weekday",
        academyPlan: "weekday-3-day",
        status: "active",
        trainingStartOn: "2025-12-01",
        updatedAt: setupNow,
      }).run()
    })

    database.insert(schema.sessionAssignments).values({
      id: `${playerId}-assignment`,
      accountId: playerId,
      seriesId: assignedSeriesId,
      effectiveFrom: "2025-12-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: setupNow,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: `${playerId}-assignment-weekday`,
      assignmentId: `${playerId}-assignment`,
      weekday: 1,
    }).run()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("selects the same rows the LIKE pattern it replaced did", () => {
    const stored = database.select({ id: schema.sessionOccurrences.id })
      .from(schema.sessionOccurrences)
      .all()
    expect(stored.length).toBe(assignedDates.length * 2)

    ;["2025-11", "2025-12", "2026-01", "2026-02"].forEach((month) => {
      const bounds = monthDateBounds(month)
      const byRange = database.select({ id: schema.sessionOccurrences.id })
        .from(schema.sessionOccurrences)
        .where(and(
          gte(schema.sessionOccurrences.occurrenceDate, bounds.start),
          lt(schema.sessionOccurrences.occurrenceDate, bounds.endExclusive),
        ))
        .all()
        .map((row) => row.id)
        .sort()
      const byLike = database.$client
        .prepare("select id from session_occurrences where occurrence_date like ? order by id")
        .all(`${month}-%`)
        .map((row) => (row as { id: string }).id)

      expect(byRange).toEqual(byLike)
    })
  })

  it("seeks the series+date index rather than re-checking the month per series", () => {
    const { start, endExclusive } = monthDateBounds("2025-12")
    // Scoping the range by series is only a win if SQLite can seek both columns.
    // With just `session_occurrences_series_idx` it seeks `series_id` alone and
    // re-checks the month across each series' whole history, which is slower
    // than the unscoped range this replaced; `session_occurrences_series_date_idx`
    // cannot help because it is partial on `status = 'scheduled'` and this read
    // wants cancelled occurrences too.
    const plan = database.$client.prepare(
      "explain query plan select id, series_id, occurrence_date, starts_at, status,"
      + " replacement_for_occurrence_id from session_occurrences"
      + " where series_id in (?, ?) and occurrence_date >= ? and occurrence_date < ?",
    ).all(assignedSeriesId, otherSeriesId, start, endExclusive)
      .map((row) => (row as { detail: string }).detail)
      .join(" | ")

    expect(plan).toContain("session_occurrences_series_date_lookup_idx")
    expect(plan).toContain("occurrence_date>?")
  })

  it("reads only the series the player is assigned to", () => {
    const input = attendanceDatabase.getPlayerAttendanceInput(
      playerId,
      "2025-12",
      "2025-12-31",
      "2025-12-31T23:59:59+05:30",
      database,
    )
    if (!input) throw new Error("Player attendance input was not built.")

    expect(input.occurrences.map((occurrence) => occurrence.id)).toEqual([
      `${assignedSeriesId}-2025-12-01`,
      `${assignedSeriesId}-2025-12-29`,
    ])
    expect(attendanceDatabase.calculatePlayerAttendanceForMonth(
      playerId,
      "2025-12",
      "2025-12-31",
      "2025-12-31T23:59:59+05:30",
    )).toMatchObject({ eligible: 2, recorded: 0, pending: 2 })
  })

  it("reads no occurrences at all for a player with no assignment", () => {
    const input = attendanceDatabase.getPlayerAttendanceInput(
      unassignedPlayerId,
      "2025-12",
      "2025-12-31",
      "2025-12-31T23:59:59+05:30",
      database,
    )
    if (!input) throw new Error("Player attendance input was not built.")
    expect(input.occurrences).toEqual([])
  })
})
