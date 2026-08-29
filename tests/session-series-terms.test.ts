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
import { NOT_A_BATCH, NOT_A_PROGRAMME } from "./support/invalid-domain-values"

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

/*
 * The occurrence write is the reason this service batches, so the tests below
 * measure it at the driver rather than trusting the row count: drizzle's
 * better-sqlite3 session calls `client.prepare(sql)` once per statement it
 * executes, so recording every `prepare` gives the exact statement list the
 * transaction sent. A per-row loop shows up as one prepared insert per
 * occurrence; a single multi-row insert shows up as one, carrying every bind.
 */
function recordStatements() {
  const statements: string[] = []
  const prepare = sqlite.prepare.bind(sqlite)
  sqlite.prepare = ((source: string) => {
    statements.push(source)
    return prepare(source)
  }) as typeof sqlite.prepare
  return {
    occurrenceInserts: () => statements.filter(
      (sql) => sql.startsWith('insert into "session_occurrences"'),
    ),
    restore: () => {
      Reflect.deleteProperty(sqlite, "prepare")
    },
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
    trainingStartOn: "2026-08-01",
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
  it("revalidates player archival inside the assignment transaction", () => {
    const playerId = createAssignablePlayer()
    const seriesId = createSchedule()
    const transaction = database.transaction.bind(database)
    database.transaction = ((callback, config) => {
      database.update(schema.accounts).set({ archivedAt: CREATED_AT })
        .where(eq(schema.accounts.id, playerId)).run()
      return transaction(callback, config)
    }) as typeof database.transaction

    try {
      expect(() => sessionService.assignSessionRecords({
        coachId: COACH_ID,
        database,
        effectiveFrom: "2026-08-03",
        now: CREATED_AT,
        playerId,
        seriesId,
        weekdays: [1, 3, 5],
      })).toThrowError(expect.objectContaining({
        code: "NOT_FOUND",
        field: "playerId",
      }))
    } finally {
      database.transaction = transaction
    }
    expect(database.select().from(schema.sessionAssignments).all()).toHaveLength(0)
  })

  it("rejects a stale training profile inside the assignment transaction", () => {
    const playerId = createAssignablePlayer()
    const seriesId = createSchedule()
    const transaction = database.transaction.bind(database)
    database.transaction = ((callback, config) => {
      database.update(schema.playerEnrollments).set({
        level: "Intermediate",
        recordRevision: 1,
      }).where(eq(schema.playerEnrollments.accountId, playerId)).run()
      return transaction(callback, config)
    }) as typeof database.transaction

    try {
      expect(() => sessionService.assignSessionRecords({
        coachId: COACH_ID,
        database,
        effectiveFrom: "2026-08-03",
        now: CREATED_AT,
        playerId,
        seriesId,
        weekdays: [1, 3, 5],
      })).toThrowError(expect.objectContaining({
        code: "CONFLICT",
        field: "playerId",
      }))
    } finally {
      database.transaction = transaction
    }
    expect(database.select().from(schema.sessionAssignments).all()).toHaveLength(0)
  })

  it("refuses a weekend schedule for a level that trains weekdays only", () => {
    // Without this the series is creatable and then rejects every player who
    // tries to join, blaming their Academy Plan rather than the schedule.
    for (const programme of ["Advanced", "Elite"] as const) {
      expect(() => createSchedule({ batch: "Weekend", programme }))
        .toThrowError(expect.objectContaining({ code: "INVALID_INPUT", field: "batch" }))
    }
  })

  it("rejects crafted programme and batch values without partial rows", () => {
    const before = scheduleCounts()

    expect(() => createSchedule({
      programme: NOT_A_PROGRAMME as CreateSessionSeriesInput["programme"],
    })).toThrowError(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "programme",
    }))
    expect(() => createSchedule({
      batch: NOT_A_BATCH as CreateSessionSeriesInput["batch"],
      weekdays: [0],
    })).toThrowError(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "batch",
    }))
    expect(scheduleCounts()).toEqual(before)
  })

  it("uses shared weekdays and interval overlap when reserving recurring slots", () => {
    createSchedule({ weekdays: [1, 3, 5], startTime: "06:00", durationMinutes: 60 })

    expect(() => createSchedule({
      weekdays: [2, 4],
      startTime: "06:00",
      durationMinutes: 60,
    })).not.toThrow()
    expect(() => createSchedule({
      weekdays: [1],
      startTime: "06:30",
      durationMinutes: 60,
    })).toThrow(CONFLICT_MESSAGE)
    expect(() => createSchedule({
      weekdays: [1],
      startTime: "07:00",
      durationMinutes: 60,
    })).not.toThrow()
  })

  it("rejects a new schedule that overlaps a materialized replacement", () => {
    const existingSeriesId = createSchedule({
      weekdays: [1],
      startTime: "06:00",
      durationMinutes: 60,
    })
    const source = database.select().from(schema.sessionOccurrences).where(
      eq(schema.sessionOccurrences.seriesId, existingSeriesId),
    ).all().find((occurrence) => occurrence.occurrenceDate === "2026-08-03")
    if (!source) throw new Error("Expected source occurrence.")

    sessionService.replaceSessionOccurrence({
      coachId: COACH_ID,
      database,
      dateKey: "2026-08-04",
      durationMinutes: 60,
      now: CREATED_AT,
      occurrenceId: source.id,
      referenceDate: "2026-07-01",
      startTime: "07:30",
      venue: "SMBA Court 2",
    })
    const before = scheduleCounts()

    expect(() => createSchedule({
      startsOn: "2026-08-04",
      endsOn: "2026-08-18",
      weekdays: [2],
      startTime: "07:00",
      durationMinutes: 60,
    })).toThrow(CONFLICT_MESSAGE)
    expect(scheduleCounts()).toEqual(before)
  })

  it("caps recurring terms at 366 inclusive calendar days", () => {
    expect(() => createSchedule({
      startsOn: "2026-01-01",
      endsOn: "2027-01-01",
      weekdays: [1],
    })).not.toThrow()
    expect(() => createSchedule({
      startsOn: "2028-01-01",
      endsOn: "2029-01-01",
      weekdays: [1],
    })).toThrow("at most 366 days")
  })

  it("materialises the widest legal term in one insert", () => {
    // 2026-01-01..2027-01-01 is the 366-day cap; five weekdays over it is the
    // most occurrences any input can reach, and the one multi-row insert has to
    // carry all of them without tripping SQLite's bind-parameter limit.
    const recorder = recordStatements()
    let seriesId: string
    try {
      seriesId = createSchedule({
        startsOn: "2026-01-01",
        endsOn: "2027-01-01",
        weekdays: [1, 2, 3, 4, 5],
      })
    } finally {
      recorder.restore()
    }
    const occurrenceInserts = recorder.occurrenceInserts()
    const occurrences = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).all()

    // One statement, not 262: reverting to a per-row loop fails here first.
    expect(occurrenceInserts).toHaveLength(1)
    // 262 rows x 9 columns of binds in that one statement, so the assertion
    // also pins the batch against SQLITE_MAX_VARIABLE_NUMBER rather than
    // passing on a statement that quietly re-prepares per row.
    expect((occurrenceInserts[0]?.match(/\?/g) ?? []).length).toBe(262 * 9)
    expect(occurrences).toHaveLength(262)
    expect(new Set(occurrences.map((occurrence) => occurrence.id)).size).toBe(262)
    expect(occurrences.every((occurrence) => occurrence.status === "scheduled")).toBe(true)
    const dates = occurrences.map((occurrence) => occurrence.occurrenceDate).sort()
    expect(dates.at(0)).toBe("2026-01-01")
    expect(dates.at(-1)).toBe("2027-01-01")
  })

  it("creates a term whose weekdays never fall inside its date range", () => {
    // Saturday to Sunday with a Monday slot generates no occurrence at all, so
    // the batched insert must be skipped rather than sent with no rows.
    const recorder = recordStatements()
    let seriesId: string
    try {
      seriesId = createSchedule({
        startsOn: "2026-08-08",
        endsOn: "2026-08-09",
        weekdays: [1],
      })
    } finally {
      recorder.restore()
    }

    expect(recorder.occurrenceInserts()).toEqual([])
    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).all()).toEqual([])
    expect(database.select().from(schema.sessionRecurrenceRules)
      .where(eq(schema.sessionRecurrenceRules.seriesId, seriesId)).all()).toHaveLength(1)
  })

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

  it("ends an active schedule once and closes its future roster without rewriting history", () => {
    const playerId = createAssignablePlayer()
    const seriesId = createSchedule()
    sessionService.assignSessionRecords({
      coachId: COACH_ID,
      database,
      effectiveFrom: "2026-08-03",
      now: new Date("2026-08-01T06:00:00+05:30"),
      playerId,
      seriesId,
      weekdays: [1, 3, 5],
    })
    const revisionBefore = database.select({ revision: schema.playerEnrollments.recordRevision })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.revision

    expect(sessionService.endSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      now: new Date("2026-08-01T06:00:00+05:30"),
      seriesId,
    })).toMatchObject({
      alreadyEnded: false,
      closedAssignments: 1,
    })
    expect(database.select().from(schema.sessionSeries)
      .where(eq(schema.sessionSeries.id, seriesId)).get()?.status).toBe("ended")
    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).all()
      .every((occurrence) => occurrence.status === "cancelled")).toBe(true)
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, playerId)).get()?.effectiveTo).toBe("2026-08-03")
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()).toMatchObject({
      recordRevision: (revisionBefore ?? 0) + 1,
      status: "paused",
    })

    expect(sessionService.endSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      now: new Date("2026-08-01T06:01:00+05:30"),
      seriesId,
    })).toEqual({
      alreadyEnded: true,
      cancelledOccurrences: 0,
      closedAssignments: 0,
    })
    expect(database.select({ revision: schema.playerEnrollments.recordRevision })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.revision)
      .toBe((revisionBefore ?? 0) + 1)
  })

  it("does not end a schedule after one of today's sessions has started", () => {
    const seriesId = createSchedule({
      startsOn: "2026-08-03",
      endsOn: "2026-08-31",
      weekdays: [1],
    })

    expect(() => sessionService.endSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      now: new Date("2026-08-03T06:00:00+05:30"),
      seriesId,
    })).toThrow("already started today")
    expect(database.select().from(schema.sessionSeries)
      .where(eq(schema.sessionSeries.id, seriesId)).get()?.status).toBe("active")
  })
})
