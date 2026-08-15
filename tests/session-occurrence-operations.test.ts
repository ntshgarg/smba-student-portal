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

const COACH_ID = INITIAL_COACH_ACCOUNT_ID
const REFERENCE_DATE = "2026-08-01"
const NOW = new Date("2026-08-01T06:00:00+05:30")

let sqlite: Database.Database
let database: SmbaDatabase
let seriesId: string

function occurrenceOn(dateKey: string) {
  const occurrence = database.select().from(schema.sessionOccurrences).where(
    eq(schema.sessionOccurrences.seriesId, seriesId),
  ).all().find((candidate) => candidate.occurrenceDate === dateKey)
  if (!occurrence) throw new Error(`Expected occurrence on ${dateKey}.`)
  return occurrence
}

function replace(
  occurrenceId: string,
  overrides: Partial<Parameters<typeof sessionService.replaceSessionOccurrence>[0]> = {},
) {
  return sessionService.replaceSessionOccurrence({
    coachId: COACH_ID,
    database,
    dateKey: "2026-08-03",
    durationMinutes: 60,
    now: NOW,
    occurrenceId,
    referenceDate: REFERENCE_DATE,
    startTime: "07:00",
    venue: "SMBA Court 2",
    ...overrides,
  })
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
  seriesId = sessionService.createSessionSeriesRecords({
    coachId: COACH_ID,
    database,
    now: NOW,
    input: {
      batch: "Weekday",
      durationMinutes: 60,
      endsOn: "2026-08-17",
      programme: "Beginner",
      startTime: "06:00",
      startsOn: "2026-08-03",
      venue: "SMBA Court",
      weekdays: [1],
    },
  })
})

afterEach(() => {
  sqlite.close()
})

describe("session occurrence operational boundaries", () => {
  it("keeps the source scheduled and returns a friendly conflict for an occupied target date", () => {
    const source = occurrenceOn("2026-08-03")

    expect(() => replace(source.id, { dateKey: "2026-08-10" })).toThrowError(
      expect.objectContaining({
        code: "CONFLICT",
        field: "dateKey",
        message: expect.stringContaining("already has a session"),
      }),
    )
    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.id, source.id)).get()?.status).toBe("scheduled")
    expect(database.select().from(schema.sessionOccurrences).where(
      eq(schema.sessionOccurrences.replacementForOccurrenceId, source.id),
    ).all()).toHaveLength(0)
  })

  it("makes exact replacement retries idempotent and rejects changed retries", () => {
    const source = occurrenceOn("2026-08-03")
    const first = replace(source.id)
    const retry = replace(source.id)

    expect(first.alreadyReplaced).toBe(false)
    expect(retry).toEqual({
      alreadyReplaced: true,
      replacementOccurrenceId: first.replacementOccurrenceId,
    })
    expect(database.select().from(schema.sessionOccurrences).where(
      eq(schema.sessionOccurrences.replacementForOccurrenceId, source.id),
    ).all()).toHaveLength(1)
    expect(() => replace(source.id, { startTime: "08:00" })).toThrowError(
      expect.objectContaining({ code: "CONFLICT", field: "occurrenceId" }),
    )
    expect(() => sessionService.cancelSessionOccurrence({
      coachId: COACH_ID,
      database,
      now: NOW,
      occurrenceId: source.id,
      referenceDate: REFERENCE_DATE,
    })).toThrow("already replaced")
  })

  it("makes cancellation retries idempotent", () => {
    const source = occurrenceOn("2026-08-10")

    expect(sessionService.cancelSessionOccurrence({
      coachId: COACH_ID,
      database,
      now: NOW,
      occurrenceId: source.id,
      referenceDate: REFERENCE_DATE,
    })).toEqual({ alreadyCancelled: false })
    expect(sessionService.cancelSessionOccurrence({
      coachId: COACH_ID,
      database,
      now: NOW,
      occurrenceId: source.id,
      referenceDate: REFERENCE_DATE,
    })).toEqual({ alreadyCancelled: true })
  })

  it("validates replacement duration, midnight boundary and venue before mutation", () => {
    const source = occurrenceOn("2026-08-03")

    for (const [overrides, field] of [
      [{ durationMinutes: 29 }, "durationMinutes"],
      [{ durationMinutes: 301 }, "durationMinutes"],
      [{ startTime: "25:00" }, "startTime"],
      [{ startTime: "23:30", durationMinutes: 60 }, "durationMinutes"],
      [{ venue: " " }, "venue"],
      [{ venue: "x".repeat(121) }, "venue"],
    ] as const) {
      expect(() => replace(source.id, overrides)).toThrowError(
        expect.objectContaining({ code: "INVALID_INPUT", field }),
      )
    }
    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.id, source.id)).get()?.status).toBe("scheduled")
    expect(database.select().from(schema.sessionOccurrences).where(
      eq(schema.sessionOccurrences.replacementForOccurrenceId, source.id),
    ).all()).toHaveLength(0)
  })

  it("keeps replacements inside their term and out of another matching schedule", () => {
    const source = occurrenceOn("2026-08-03")
    expect(() => replace(source.id, { dateKey: "2030-08-05" })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT", field: "dateKey" }),
    )

    sessionService.createSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      now: NOW,
      input: {
        batch: "Weekday",
        durationMinutes: 60,
        endsOn: "2026-08-18",
        programme: "Beginner",
        startTime: "07:00",
        startsOn: "2026-08-04",
        venue: "SMBA Court 2",
        weekdays: [2],
      },
    })
    expect(() => replace(source.id, {
      dateKey: "2026-08-04",
      startTime: "07:30",
    })).toThrowError(expect.objectContaining({
      code: "CONFLICT",
      field: "startTime",
      message: expect.stringContaining("overlaps"),
    }))
    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.id, source.id)).get()?.status).toBe("scheduled")
  })

  it("bounds replacements for legacy null-ended and oversized schedules", () => {
    database.insert(schema.sessionSeries).values({
      id: "legacy-unbounded-series",
      title: "Legacy unbounded schedule",
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: null,
      status: "active",
      createdByAccountId: COACH_ID,
      createdAt: NOW,
    }).run()
    database.insert(schema.sessionRecurrenceRules).values({
      id: "legacy-unbounded-monday",
      seriesId: "legacy-unbounded-series",
      weekday: 1,
      startTime: "09:00",
      durationMinutes: 60,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "legacy-unbounded-source",
      seriesId: "legacy-unbounded-series",
      occurrenceDate: "2026-08-03",
      startsAt: new Date("2026-08-03T09:00:00+05:30"),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      replacementForOccurrenceId: null,
      createdAt: NOW,
    }).run()

    expect(() => replace("legacy-unbounded-source", {
      dateKey: "2027-08-02",
      startTime: "09:00",
    })).toThrowError(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "dateKey",
    }))

    database.update(schema.sessionSeries).set({ endsOn: "2030-08-31" })
      .where(eq(schema.sessionSeries.id, "legacy-unbounded-series")).run()
    expect(() => replace("legacy-unbounded-source", {
      dateKey: "2027-08-02",
      startTime: "09:00",
    })).toThrowError(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "dateKey",
    }))
    expect(database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.id, "legacy-unbounded-source")).get()?.status)
      .toBe("scheduled")
  })
})
