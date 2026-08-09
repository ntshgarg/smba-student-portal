import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"
import * as sessionService from "@/lib/sessions/service"
import type { CreateSessionSeriesInput } from "@/lib/sessions/types"

const COACH_ID = INITIAL_COACH_ACCOUNT_ID
const CREATED_AT = new Date("2026-07-01T06:00:00+05:30")
const CONFLICT_MESSAGE = "A schedule already uses this level, batch and time slot during the selected dates."

let sqlite: Database.Database
let database: SmbaDatabase

function scheduleInput(
  overrides: Partial<CreateSessionSeriesInput> = {},
): CreateSessionSeriesInput {
  return {
    programme: "Beginner",
    batch: "Weekday",
    venue: "SMBA Court",
    startsOn: "2026-08-03",
    endsOn: "2026-08-31",
    weekdays: [1, 3, 5],
    startTime: "06:00",
    durationMinutes: 60,
    ...overrides,
  }
}

function createSchedule(
  overrides: Partial<CreateSessionSeriesInput> = {},
  now = CREATED_AT,
) {
  return sessionService.createSessionSeriesRecords({
    coachId: COACH_ID,
    database,
    input: scheduleInput(overrides),
    now,
  })
}

function scheduleCounts() {
  return {
    occurrences: database.select().from(schema.sessionOccurrences).all().length,
    rules: database.select().from(schema.sessionRecurrenceRules).all().length,
    series: database.select().from(schema.sessionSeries).all().length,
  }
}

function insertExistingSeries({
  endsOn,
  id,
  startsOn,
  status,
}: {
  endsOn: string | null
  id: string
  startsOn: string
  status: "active" | "ended"
}) {
  database.insert(schema.sessionSeries).values({
    id,
    title: `${id} schedule`,
    programme: "Beginner",
    batch: "Weekday",
    venue: "SMBA Court",
    startsOn,
    endsOn,
    status,
    createdByAccountId: COACH_ID,
    createdAt: CREATED_AT,
  }).run()
  database.insert(schema.sessionRecurrenceRules).values({
    id: `${id}-monday`,
    seriesId: id,
    weekday: 1,
    startTime: "06:00",
    durationMinutes: 60,
  }).run()
}

function createAssignablePlayer() {
  const playerId = "completed-term-player"
  database.insert(schema.accounts).values({
    id: playerId,
    fullName: "Completed Term Player",
    normalizedName: "completed term player",
    requestedRole: "player",
    role: "player",
    approvalStatus: "approved",
    approvedAt: CREATED_AT,
    approvedByAccountId: COACH_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }).run()
  database.insert(schema.playerEnrollments).values({
    accountId: playerId,
    academyPlan: "weekday-3-day",
    batch: "Weekday",
    joinedAt: new Date("2026-08-01T00:00:00+05:30"),
    level: "Beginner",
    status: "unassigned",
    updatedAt: CREATED_AT,
  }).run()
  return playerId
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
})

afterEach(() => {
  sqlite.close()
})

describe("recurring schedule terms", () => {
  it("allows an otherwise identical successor on the day after a bounded term", () => {
    const firstId = createSchedule({
      startsOn: "2026-07-01",
      endsOn: "2026-08-31",
    })
    const successorId = createSchedule({
      startsOn: "2026-09-01",
      endsOn: "2026-10-31",
    })

    expect(successorId).not.toBe(firstId)
    expect(database.select().from(schema.sessionSeries).all()).toEqual([
      expect.objectContaining({ id: firstId, startsOn: "2026-07-01", endsOn: "2026-08-31" }),
      expect.objectContaining({ id: successorId, startsOn: "2026-09-01", endsOn: "2026-10-31" }),
    ])
    expect(database.select().from(schema.sessionRecurrenceRules).all()).toHaveLength(6)
    expect(database.select().from(schema.sessionOccurrences).all().length).toBeGreaterThan(0)
  })

  it("rejects boundary and contained date overlaps without partial schedule rows", () => {
    createSchedule({ startsOn: "2026-07-01", endsOn: "2026-08-31" })
    const before = scheduleCounts()

    for (const overlap of [
      { startsOn: "2026-08-31", endsOn: "2026-09-30" },
      { startsOn: "2026-07-15", endsOn: "2026-08-15" },
    ]) {
      expect(() => createSchedule(overlap)).toThrow(CONFLICT_MESSAGE)
      expect(scheduleCounts()).toEqual(before)
    }
  })

  it("allows a term overlapping an administratively ended schedule", () => {
    insertExistingSeries({
      id: "ended-series",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      status: "ended",
    })

    expect(() => createSchedule()).not.toThrow()
    expect(database.select().from(schema.sessionSeries).all()).toHaveLength(2)
  })

  it("treats a legacy unbounded active schedule as overlapping future terms", () => {
    insertExistingSeries({
      id: "unbounded-series",
      startsOn: "2026-01-01",
      endsOn: null,
      status: "active",
    })
    const before = scheduleCounts()

    expect(() => createSchedule({
      startsOn: "2030-01-01",
      endsOn: "2030-01-31",
      weekdays: [1],
    })).toThrow(CONFLICT_MESSAGE)
    expect(scheduleCounts()).toEqual(before)
  })

  it("does not release a recurring slot when one occurrence is cancelled", () => {
    const seriesId = createSchedule()
    const occurrence = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).get()
    if (!occurrence) throw new Error("The generated occurrence is unavailable.")
    sessionService.cancelSessionOccurrence({
      coachId: COACH_ID,
      database,
      now: new Date("2026-08-01T06:00:00+05:30"),
      occurrenceId: occurrence.id,
      referenceDate: "2026-08-01",
    })
    const afterCancellation = scheduleCounts()

    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.id, occurrence.id)).get()?.status).toBe("cancelled")
    expect(() => createSchedule()).toThrow(CONFLICT_MESSAGE)
    expect(scheduleCounts()).toEqual(afterCancellation)
  })

  it("rejects a backdated assignment after the schedule term is complete", () => {
    const playerId = createAssignablePlayer()
    const seriesId = createSchedule()

    expect(() => sessionService.assignSessionRecords({
      coachId: COACH_ID,
      database,
      effectiveFrom: "2026-08-03",
      now: new Date("2026-09-01T06:00:00+05:30"),
      playerId,
      seriesId,
      weekdays: [1, 3, 5],
    })).toThrow("The selected schedule has ended.")
    expect(database.select().from(schema.sessionAssignments).all()).toHaveLength(0)
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.status).toBe("unassigned")
  })
})
