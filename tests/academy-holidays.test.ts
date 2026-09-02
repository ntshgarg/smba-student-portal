import path from "node:path"
import { randomUUID } from "node:crypto"

import Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"
import { expandDateRange } from "@/components/coach/calendar/holiday-composer"
import {
  listAcademyHolidays,
  markAcademyHolidays,
  previewAcademyHolidays,
  retractAcademyHoliday,
} from "@/lib/sessions/holidays"
import * as sessionService from "@/lib/sessions/service"

const COACH_ID = INITIAL_COACH_ACCOUNT_ID
// A Monday, so every date below lands on the weekday the series trains.
const MONDAY = "2026-08-03"
const NEXT_MONDAY = "2026-08-10"
const NOW = new Date("2026-08-03T05:00:00+05:30")

let sqlite: Database.Database
let database: SmbaDatabase
let morningSeriesId: string
let eveningSeriesId: string

function occurrenceOn(seriesId: string, dateKey: string) {
  const occurrence = database.select().from(schema.sessionOccurrences).where(and(
    eq(schema.sessionOccurrences.seriesId, seriesId),
    eq(schema.sessionOccurrences.occurrenceDate, dateKey),
  )).get()
  if (!occurrence) throw new Error(`Expected an occurrence on ${dateKey}.`)
  return occurrence
}

function addAccount(fullName: string, role: "player" | "coach") {
  const id = randomUUID()
  database.insert(schema.accounts).values({
    approvalStatus: "approved",
    createdAt: NOW,
    fullName,
    id,
    normalizedName: fullName.toLowerCase(),
    requestedRole: role,
    role,
    updatedAt: NOW,
  }).run()
  return id
}

function createSeries(programme: "Beginner" | "Intermediate", startTime: string) {
  return sessionService.createSessionSeriesRecords({
    coachId: COACH_ID,
    database,
    now: NOW,
    input: {
      batch: "Weekday",
      durationMinutes: 60,
      endsOn: "2026-08-31",
      programme,
      startTime,
      startsOn: MONDAY,
      venue: "SMBA Court",
      weekdays: [1],
    },
  })
}

function markHoliday(dateKeys: string[], label = "Diwali") {
  return markAcademyHolidays({ coachId: COACH_ID, database, dateKeys, label, now: NOW })
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
  morningSeriesId = createSeries("Beginner", "06:00")
  eveningSeriesId = createSeries("Intermediate", "18:00")
})

afterEach(() => {
  sqlite.close()
})

describe("marking a holiday", () => {
  it("closes every session on the date in one call and records who declared it", () => {
    const result = markHoliday([MONDAY])

    expect(result.closedDates).toEqual([MONDAY])
    expect(result.cancelledSessions).toBe(2)
    expect(occurrenceOn(morningSeriesId, MONDAY).status).toBe("cancelled")
    expect(occurrenceOn(eveningSeriesId, MONDAY).status).toBe("cancelled")

    const [holiday] = listAcademyHolidays({ database })
    expect(holiday).toMatchObject({
      dateKey: MONDAY,
      declaredByAccountId: COACH_ID,
      label: "Diwali",
    })
  })

  it("closes a range of dates in one call", () => {
    const result = markHoliday([MONDAY, NEXT_MONDAY], "Academy break")

    expect(result.closedDates).toEqual([MONDAY, NEXT_MONDAY])
    expect(result.cancelledSessions).toBe(4)
    expect(listAcademyHolidays({ database }).map((holiday) => holiday.dateKey))
      .toEqual([MONDAY, NEXT_MONDAY])
  })

  /*
   * The whole reason this feature is not just a bulk cancel. Every other
   * cancellation path in the codebase refuses a date in the past.
   */
  it("closes a date that has already passed", () => {
    const later = new Date("2026-08-20T09:00:00+05:30")
    const result = markAcademyHolidays({
      coachId: COACH_ID,
      database,
      dateKeys: [MONDAY],
      label: "Bandh",
      now: later,
    })

    expect(result.cancelledSessions).toBe(2)
    expect(occurrenceOn(morningSeriesId, MONDAY).status).toBe("cancelled")
  })

  it("is a no-op on a date already closed, and still closes the rest of the range", () => {
    markHoliday([MONDAY])
    const second = markHoliday([MONDAY, NEXT_MONDAY])

    expect(second.skippedDates).toEqual([MONDAY])
    expect(second.closedDates).toEqual([NEXT_MONDAY])
    expect(second.cancelledSessions).toBe(2)
    expect(listAcademyHolidays({ database })).toHaveLength(2)
  })

  it("leaves a session that was already cancelled alone rather than counting it twice", () => {
    sessionService.cancelSessionOccurrence({
      coachId: COACH_ID,
      database,
      now: NOW,
      occurrenceId: occurrenceOn(eveningSeriesId, NEXT_MONDAY).id,
      referenceDate: MONDAY,
    })

    expect(markHoliday([NEXT_MONDAY]).cancelledSessions).toBe(1)
  })

  it("refuses a assistant coach", () => {
    const juniorId = addAccount("Junior Coach", "coach")
    database.insert(schema.academyIdAllocations)
      .values({ accountId: juniorId, createdAt: NOW }).run()
    database.insert(schema.coachProfiles).values({
      accessLevel: "junior_coach",
      accountId: juniorId,
      createdAt: NOW,
      joinedOn: MONDAY,
      updatedAt: NOW,
    }).run()

    expect(() => markAcademyHolidays({
      coachId: juniorId,
      database,
      dateKeys: [MONDAY],
      label: "Diwali",
      now: NOW,
    })).toThrowError(/Head coach access is required/u)
    expect(listAcademyHolidays({ database })).toHaveLength(0)
  })

  it("requires a label and rejects an oversized range", () => {
    expect(() => markHoliday([MONDAY], "   ")).toThrowError(
      expect.objectContaining({ field: "label" }),
    )
    const tooMany = Array.from({ length: 32 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`)
    expect(() => markHoliday(tooMany)).toThrowError(
      expect.objectContaining({ field: "dates" }),
    )
  })
})

describe("previewing a holiday before confirming", () => {
  it("counts the sessions a closure would cancel without writing anything", () => {
    const impact = previewAcademyHolidays({ database, dateKeys: [MONDAY], now: NOW })

    expect(impact.totals).toMatchObject({
      attendanceMarks: 0,
      datesToClose: 1,
      makeUpCompletions: 0,
      scheduledSessions: 2,
    })
    expect(impact.dates[0].existingHolidayLabel).toBeNull()
    expect(occurrenceOn(morningSeriesId, MONDAY).status).toBe("scheduled")
  })

  it("names a date that is already a holiday so it can be shown as a no-op", () => {
    markHoliday([MONDAY], "Independence Day")
    const impact = previewAcademyHolidays({ database, dateKeys: [MONDAY], now: NOW })

    expect(impact.dates[0].existingHolidayLabel).toBe("Independence Day")
    expect(impact.totals.datesToClose).toBe(0)
    expect(impact.totals.datesAlreadyClosed).toBe(1)
  })

  it("reports attendance already recorded on a past date, which is the warning the coach acts on", () => {
    const occurrence = occurrenceOn(morningSeriesId, MONDAY)
    const playerId = addAccount("Marked Player", "player")
    database.insert(schema.sessionAttendanceRecords).values({
      accountId: playerId,
      choice: "present",
      createdAt: NOW,
      id: randomUUID(),
      markedByAccountId: COACH_ID,
      occurrenceId: occurrence.id,
      updatedAt: NOW,
    }).run()

    const impact = previewAcademyHolidays({ database, dateKeys: [MONDAY], now: NOW })

    expect(impact.dates[0].attendanceMarks).toBe(1)
    expect(impact.dates[0].attendancePlayers).toBe(1)
    expect(impact.totals.attendanceMarks).toBe(1)
  })

  it("counts a player marked on several closed days once", () => {
    const playerId = addAccount("Repeat Player", "player")
    for (const dateKey of [MONDAY, NEXT_MONDAY]) {
      database.insert(schema.sessionAttendanceRecords).values({
        accountId: playerId,
        choice: "present",
        createdAt: NOW,
        id: randomUUID(),
        markedByAccountId: COACH_ID,
        occurrenceId: occurrenceOn(morningSeriesId, dateKey).id,
        updatedAt: NOW,
      }).run()
    }

    const impact = previewAcademyHolidays({
      database,
      dateKeys: [MONDAY, NEXT_MONDAY],
      now: NOW,
    })

    expect(impact.totals.attendanceMarks).toBe(2)
    // One person, told to the coach as one person.
    expect(impact.totals.attendancePlayers).toBe(1)
  })

  it("ignores a cleared mark, which carries no attendance meaning", () => {
    const occurrence = occurrenceOn(morningSeriesId, MONDAY)
    const playerId = addAccount("Cleared Player", "player")
    database.insert(schema.sessionAttendanceRecords).values({
      accountId: playerId,
      choice: "cleared",
      createdAt: NOW,
      id: randomUUID(),
      markedByAccountId: COACH_ID,
      occurrenceId: occurrence.id,
      updatedAt: NOW,
    }).run()

    expect(previewAcademyHolidays({ database, dateKeys: [MONDAY], now: NOW })
      .totals.attendanceMarks).toBe(0)
  })
})

describe("make-up sessions completed on a day that becomes a holiday", () => {
  function addMakeUp(completedOn: string) {
    const playerId = addAccount("Make-up Player", "player")
    const adjustmentId = randomUUID()
    database.insert(schema.attendanceAdjustments).values({
      completedOn,
      completionOccurrenceId: occurrenceOn(eveningSeriesId, completedOn).id,
      id: adjustmentId,
      playerId,
      publishedAt: NOW,
      publishedByAccountId: COACH_ID,
      sourceOccurrenceId: occurrenceOn(morningSeriesId, MONDAY).id,
      type: "makeup",
    }).run()
    return adjustmentId
  }

  it("counts them in the preview", () => {
    addMakeUp(NEXT_MONDAY)

    expect(previewAcademyHolidays({ database, dateKeys: [NEXT_MONDAY], now: NOW })
      .dates[0].makeUpCompletions).toBe(1)
  })

  /*
   * The credit for a make-up is keyed to the SOURCE occurrence, so closing the
   * completion day would otherwise leave the player silently credited present
   * for a session the academy has just said never happened.
   */
  it("flags them for review rather than revoking the credit silently", () => {
    const adjustmentId = addMakeUp(NEXT_MONDAY)
    const result = markHoliday([NEXT_MONDAY])

    expect(result.adjustmentsFlaggedForReview).toBe(1)
    expect(database.select().from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, adjustmentId)).get()?.reviewRequiredAt)
      .toBeInstanceOf(Date)
  })
})

describe("retracting a holiday", () => {
  it("puts back exactly the sessions the holiday cancelled", () => {
    markHoliday([MONDAY])
    const result = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: MONDAY })

    expect(result.restoredSessions).toBe(2)
    expect(occurrenceOn(morningSeriesId, MONDAY).status).toBe("scheduled")
    expect(occurrenceOn(eveningSeriesId, MONDAY).status).toBe("scheduled")
    expect(listAcademyHolidays({ database })).toHaveLength(0)
  })

  /*
   * The reason occurrences carry `holidayId` at all. A session the coach had
   * already called off for its own reasons must not come back with the holiday.
   */
  it("leaves a session cancelled separately beforehand cancelled", () => {
    sessionService.cancelSessionOccurrence({
      coachId: COACH_ID,
      database,
      now: NOW,
      occurrenceId: occurrenceOn(eveningSeriesId, NEXT_MONDAY).id,
      referenceDate: MONDAY,
    })
    markHoliday([NEXT_MONDAY])
    retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY })

    expect(occurrenceOn(morningSeriesId, NEXT_MONDAY).status).toBe("scheduled")
    expect(occurrenceOn(eveningSeriesId, NEXT_MONDAY).status).toBe("cancelled")
  })

  it("refuses when a session has since been scheduled onto the freed date", () => {
    markHoliday([NEXT_MONDAY])
    // A make-up moved onto the closed day, which the partial unique index
    // permits precisely because the original rows are cancelled.
    sessionService.replaceSessionOccurrence({
      coachId: COACH_ID,
      database,
      dateKey: NEXT_MONDAY,
      durationMinutes: 60,
      now: NOW,
      occurrenceId: occurrenceOn(morningSeriesId, "2026-08-17").id,
      referenceDate: MONDAY,
      startTime: "06:00",
      venue: "SMBA Court",
    })

    expect(() => retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY }))
      .toThrowError(expect.objectContaining({ code: "CONFLICT" }))
    expect(listAcademyHolidays({ database })).toHaveLength(1)
    expect(occurrenceOn(morningSeriesId, NEXT_MONDAY).status).toBe("cancelled")
  })

  it("refuses a date that is not a holiday", () => {
    expect(() => retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: MONDAY }))
      .toThrowError(expect.objectContaining({ code: "NOT_FOUND" }))
  })
})

describe("expanding a chosen date range", () => {
  it("includes both ends and every calendar day between", () => {
    expect(expandDateRange("2026-08-03", "2026-08-06"))
      .toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"])
  })

  /*
   * Calendar days, not training days. The academy is shut on the Sunday in the
   * middle of a Diwali block too; a date with no sessions simply cancels nothing.
   */
  it("keeps days the academy never trains on", () => {
    expect(expandDateRange("2026-08-07", "2026-08-10")).toContain("2026-08-09")
  })

  it("handles a single day and rejects a backwards range", () => {
    expect(expandDateRange("2026-08-03", "2026-08-03")).toEqual(["2026-08-03"])
    expect(expandDateRange("2026-08-06", "2026-08-03")).toEqual([])
    expect(expandDateRange("", "2026-08-03")).toEqual([])
  })

  it("crosses a month and a year boundary", () => {
    expect(expandDateRange("2026-12-30", "2027-01-02"))
      .toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"])
  })

  // Stops one past the cap so the caller can detect the overrun and refuse,
  // rather than silently closing 31 days of a 90-day request.
  it("stops just past the cap so an oversized range is detectable", () => {
    expect(expandDateRange("2026-01-01", "2026-06-30").length).toBe(32)
  })
})
