import path from "node:path"
import { randomUUID } from "node:crypto"

import Database from "better-sqlite3"
import { and, eq, gt } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { SmbaDatabase } from "@/lib/db/client"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"
import {
  expandDateRange,
  holidayClosedMessage,
} from "@/components/coach/calendar/holiday-composer"
import {
  cancellationLabel,
  holidayRemovedMessage,
} from "@/components/coach/calendar/session-calendar"
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

/**
 * A schedule ended by the End schedule code from before holiday sessions were
 * detached: the player's place closes on the day it ended, the schedule is
 * marked ended, and sessions the holiday cancelled stay tied to it.
 */
function endTheOldWay(
  seriesId: string,
  playerId: string,
  { endedOn, from }: { endedOn: string; from: string },
) {
  database.insert(schema.sessionAssignments).values({
    accountId: playerId,
    assignedAt: NOW,
    assignedByAccountId: COACH_ID,
    effectiveFrom: from,
    effectiveTo: endedOn,
    id: randomUUID(),
    seriesId,
  }).run()
  database.update(schema.sessionSeries).set({ status: "ended" })
    .where(eq(schema.sessionSeries.id, seriesId)).run()
  database.update(schema.sessionOccurrences).set({ status: "cancelled" }).where(and(
    eq(schema.sessionOccurrences.seriesId, seriesId),
    eq(schema.sessionOccurrences.status, "scheduled"),
    gt(schema.sessionOccurrences.occurrenceDate, endedOn),
  )).run()
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

  it("flags them when the missed session's day becomes a holiday", () => {
    const adjustmentId = addMakeUp(NEXT_MONDAY)
    const result = markHoliday([MONDAY])

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

  /*
   * A session moved onto a closed day before such moves were refused. Removal
   * used to be refused outright, and once the day had passed nothing could
   * clear the way, so the holiday could never be removed.
   */
  it("still removes the holiday when a session was moved onto the closed day, keeping the moved one", () => {
    markHoliday([NEXT_MONDAY])
    const source = occurrenceOn(morningSeriesId, "2026-08-17")
    const movedId = randomUUID()
    database.update(schema.sessionOccurrences).set({ status: "cancelled" })
      .where(eq(schema.sessionOccurrences.id, source.id)).run()
    database.insert(schema.sessionOccurrences).values({
      createdAt: NOW,
      durationMinutes: 60,
      id: movedId,
      occurrenceDate: NEXT_MONDAY,
      replacementForOccurrenceId: source.id,
      seriesId: morningSeriesId,
      startsAt: new Date("2026-08-10T07:00:00+05:30"),
      status: "scheduled",
      venue: "SMBA Court",
    }).run()
    const suspendedId = database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.seriesId, morningSeriesId),
      eq(schema.sessionOccurrences.occurrenceDate, NEXT_MONDAY),
      eq(schema.sessionOccurrences.status, "cancelled"),
    )).get()!.id

    // Long after the day, which is when the old refusal could never be cleared.
    const result = retractAcademyHoliday({
      coachId: COACH_ID,
      database,
      dateKey: NEXT_MONDAY,
      now: new Date("2026-08-25T09:00:00+05:30"),
    })

    expect(result).toMatchObject({ keptCancelledSessions: 1, restoredSessions: 1 })
    expect(listAcademyHolidays({ database })).toHaveLength(0)
    const byId = (id: string) => database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.id, id)).get()
    expect(byId(movedId)?.status).toBe("scheduled")
    expect(byId(suspendedId)).toMatchObject({ holidayId: null, status: "cancelled" })
    expect(occurrenceOn(eveningSeriesId, NEXT_MONDAY).status).toBe("scheduled")
  })

  it("does not bring back a session of a schedule ended after the closure", () => {
    markHoliday([NEXT_MONDAY])
    sessionService.endSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      now: NOW,
      seriesId: morningSeriesId,
      stopFees: false,
    })

    const result = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY, now: NOW })

    expect(result).toMatchObject({ keptCancelledSessions: 0, restoredSessions: 1 })
    expect(occurrenceOn(morningSeriesId, NEXT_MONDAY)).toMatchObject({
      holidayId: null,
      status: "cancelled",
    })
    expect(occurrenceOn(eveningSeriesId, NEXT_MONDAY).status).toBe("scheduled")
  })

  // Closures made before ending a schedule detached its holiday sessions.
  it("keeps an ended schedule's future session off even when it is still tied to the closure", () => {
    markHoliday([NEXT_MONDAY])
    database.update(schema.sessionSeries).set({ status: "ended" })
      .where(eq(schema.sessionSeries.id, morningSeriesId)).run()

    const result = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY, now: NOW })

    expect(result).toMatchObject({ keptCancelledSessions: 1, restoredSessions: 1 })
    expect(occurrenceOn(morningSeriesId, NEXT_MONDAY).status).toBe("cancelled")
  })

  // A day before the schedule ended is part of its record, and comes back.
  it("brings back an ended schedule's session from before it ended", () => {
    const playerId = addAccount("Ended Player", "player")
    const closedOn = new Date("2026-08-02T09:00:00+05:30")
    markAcademyHolidays({ coachId: COACH_ID, database, dateKeys: [MONDAY], label: "Bandh", now: closedOn })
    endTheOldWay(morningSeriesId, playerId, { from: MONDAY, endedOn: "2026-08-06" })

    const result = retractAcademyHoliday({
      coachId: COACH_ID,
      database,
      dateKey: MONDAY,
      now: new Date("2026-08-20T09:00:00+05:30"),
    })

    expect(result).toMatchObject({ keptCancelledSessions: 0, restoredSessions: 2 })
    expect(occurrenceOn(morningSeriesId, MONDAY).status).toBe("scheduled")
  })

  it("clears the review flags the closure raised, and only those", () => {
    const playerId = addAccount("Make-up Player", "player")
    const otherPlayerId = addAccount("Other Player", "player")
    const insertMakeUp = (id: string, player: string, reviewRequiredAt: Date | null) => {
      database.insert(schema.attendanceAdjustments).values({
        completedOn: NEXT_MONDAY,
        completionOccurrenceId: occurrenceOn(eveningSeriesId, NEXT_MONDAY).id,
        id,
        playerId: player,
        publishedAt: NOW,
        publishedByAccountId: COACH_ID,
        reviewRequiredAt,
        sourceOccurrenceId: occurrenceOn(morningSeriesId, MONDAY).id,
        type: "makeup",
      }).run()
    }
    const earlierFlag = new Date("2026-08-02T10:00:00+05:30")
    insertMakeUp("flagged-by-closure", playerId, null)
    insertMakeUp("flagged-before", otherPlayerId, earlierFlag)
    markHoliday([NEXT_MONDAY])
    // A make-up for a session the closure suspended, flagged with its stamp.
    database.insert(schema.attendanceAdjustments).values({
      completedOn: "2026-08-17",
      completionOccurrenceId: occurrenceOn(eveningSeriesId, "2026-08-17").id,
      id: "missed-on-closed-day",
      playerId: otherPlayerId,
      publishedAt: NOW,
      publishedByAccountId: COACH_ID,
      reviewRequiredAt: NOW,
      sourceOccurrenceId: occurrenceOn(morningSeriesId, NEXT_MONDAY).id,
      type: "makeup",
    }).run()

    const result = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY, now: NOW })

    const reviewOf = (id: string) => database.select().from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, id)).get()?.reviewRequiredAt
    expect(result.reviewFlagsCleared).toBe(2)
    expect(reviewOf("flagged-by-closure")).toBeNull()
    expect(reviewOf("missed-on-closed-day")).toBeNull()
    expect(reviewOf("flagged-before")).toEqual(earlierFlag)
  })

  it("keeps a review flag that another closed date of the same closure still explains", () => {
    const playerId = addAccount("Make-up Player", "player")
    database.insert(schema.attendanceAdjustments).values({
      completedOn: NEXT_MONDAY,
      completionOccurrenceId: occurrenceOn(eveningSeriesId, NEXT_MONDAY).id,
      id: "both-days-closed",
      playerId,
      publishedAt: NOW,
      publishedByAccountId: COACH_ID,
      sourceOccurrenceId: occurrenceOn(morningSeriesId, MONDAY).id,
      type: "makeup",
    }).run()
    markHoliday([MONDAY, NEXT_MONDAY])

    retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: MONDAY, now: NOW })

    expect(database.select().from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, "both-days-closed")).get()?.reviewRequiredAt)
      .toBeInstanceOf(Date)
  })

  it("keeps a review flag that a separately declared closure still explains, until that one goes too", () => {
    const playerId = addAccount("Make-up Player", "player")
    database.insert(schema.attendanceAdjustments).values({
      completedOn: NEXT_MONDAY,
      completionOccurrenceId: occurrenceOn(eveningSeriesId, NEXT_MONDAY).id,
      id: "two-requests",
      playerId,
      publishedAt: NOW,
      publishedByAccountId: COACH_ID,
      sourceOccurrenceId: occurrenceOn(morningSeriesId, MONDAY).id,
      type: "makeup",
    }).run()
    markHoliday([NEXT_MONDAY])
    markAcademyHolidays({
      coachId: COACH_ID,
      database,
      dateKeys: [MONDAY],
      label: "Diwali",
      now: new Date(NOW.getTime() + 60_000),
    })
    const reviewOf = () => database.select().from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, "two-requests")).get()?.reviewRequiredAt

    const first = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY, now: NOW })
    expect(first.reviewFlagsCleared).toBe(0)
    expect(reviewOf()).toBeInstanceOf(Date)

    const second = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: MONDAY, now: NOW })
    expect(second.reviewFlagsCleared).toBe(1)
    expect(reviewOf()).toBeNull()
  })

  it("refuses a date that is not a holiday", () => {
    expect(() => retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: MONDAY }))
      .toThrowError(expect.objectContaining({ code: "NOT_FOUND" }))
  })
})

describe("a day already closed never gets a live session", () => {
  it("creates a new schedule's session on the closed day already cancelled by that holiday", () => {
    markHoliday([NEXT_MONDAY])
    const lateSeriesId = sessionService.createSessionSeriesRecords({
      coachId: COACH_ID,
      database,
      now: NOW,
      input: {
        batch: "Weekday",
        durationMinutes: 60,
        endsOn: "2026-08-31",
        programme: "Advanced",
        startTime: "08:00",
        startsOn: MONDAY,
        venue: "SMBA Court",
        weekdays: [1],
      },
    })
    const [holiday] = listAcademyHolidays({ database })

    expect(occurrenceOn(lateSeriesId, NEXT_MONDAY)).toMatchObject({
      holidayId: holiday.id,
      status: "cancelled",
    })
    expect(occurrenceOn(lateSeriesId, "2026-08-17").status).toBe("scheduled")

    // And it comes back with the rest when the holiday is removed.
    const result = retractAcademyHoliday({ coachId: COACH_ID, database, dateKey: NEXT_MONDAY, now: NOW })
    expect(result.restoredSessions).toBe(3)
    expect(occurrenceOn(lateSeriesId, NEXT_MONDAY).status).toBe("scheduled")
  })

  it("refuses to move a session onto a closed day and changes nothing", () => {
    markHoliday([NEXT_MONDAY])
    const source = occurrenceOn(morningSeriesId, "2026-08-17")

    expect(() => sessionService.replaceSessionOccurrence({
      coachId: COACH_ID,
      database,
      dateKey: NEXT_MONDAY,
      durationMinutes: 60,
      now: NOW,
      occurrenceId: source.id,
      referenceDate: MONDAY,
      startTime: "07:00",
      venue: "SMBA Court",
    })).toThrowError(expect.objectContaining({
      code: "BUSINESS_RULE",
      field: "dateKey",
      message: expect.stringContaining("closed on Monday 10 August for Diwali"),
    }))
    expect(occurrenceOn(morningSeriesId, "2026-08-17").status).toBe("scheduled")
    expect(database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.occurrenceDate, NEXT_MONDAY),
      eq(schema.sessionOccurrences.status, "scheduled"),
    )).all()).toHaveLength(0)
  })
})

describe("what the calendar says after a holiday change", () => {
  it("reports a closure from what was saved", () => {
    expect(holidayClosedMessage(" Diwali ", {
      adjustmentsFlaggedForReview: 1,
      cancelledSessions: 3,
      closedDates: [MONDAY, NEXT_MONDAY],
      skippedDates: ["2026-08-17"],
    })).toBe("Closed 2 days for Diwali. 3 sessions cancelled. 1 day was already a holiday and left as it was. 1 make-up is waiting for review on Attendance adjustments.")
    expect(holidayClosedMessage("Diwali", {
      adjustmentsFlaggedForReview: 0,
      cancelledSessions: 0,
      closedDates: [MONDAY],
      skippedDates: [],
    })).toBe("Closed Monday 3 August for Diwali. No sessions needed cancelling.")
  })

  // The notice sits above the calendar and the answer can arrive after the
  // coach has moved to another day, so it always names the day it was for.
  it("reports a removal, naming the day, including sessions that stayed off", () => {
    expect(holidayRemovedMessage(MONDAY, {
      keptCancelledSessions: 1,
      restoredSessions: 2,
      reviewFlagsCleared: 1,
    })).toBe("Holiday on Monday 3 August removed. 2 sessions are back on. 1 session stayed cancelled because its schedule has ended or already has a session that day. 1 make-up is no longer waiting for review.")
  })

  it("tells a holiday, a move and an ordinary cancellation apart", () => {
    const holidays = new Map([[MONDAY, { label: "Diwali" }]])
    const base = { holidayId: null, id: "a", occurrenceDate: MONDAY }

    expect(cancellationLabel({ ...base, holidayId: "h" }, [], holidays)).toBe("Closed for Diwali")
    expect(cancellationLabel(base, [
      { id: "b", replacementForOccurrenceId: "a", status: "scheduled" },
    ], holidays)).toBe("Moved")
    expect(cancellationLabel(base, [], holidays)).toBe("Cancelled")
  })

  it("still reads Moved when the moved session was moved again", () => {
    const holidays = new Map<string, { label: string }>()
    const base = { holidayId: null, id: "tue", occurrenceDate: "2026-11-03" }

    expect(cancellationLabel(base, [
      { id: "wed", replacementForOccurrenceId: "tue", status: "cancelled" },
      { id: "thu", replacementForOccurrenceId: "wed", status: "scheduled" },
    ], holidays)).toBe("Moved")
    // A move whose new session was then called off is just cancelled.
    expect(cancellationLabel(base, [
      { id: "wed", replacementForOccurrenceId: "tue", status: "cancelled" },
    ], holidays)).toBe("Cancelled")
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
