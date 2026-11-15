import { describe, expect, it } from "vitest"

import {
  chronologicalOccurrencesForDate,
  daySessionsMarked,
  eligiblePlayerIdsForOccurrence,
  playerAttendanceRecordHref,
  resolvePlayerAttendanceSelection,
  rosterProgressForOccurrences,
} from "@/lib/attendance/recording-workspace"
import type {
  SessionAssignment,
  TrainingSessionOccurrence,
} from "@/lib/sessions/types"

const morning: TrainingSessionOccurrence = {
  id: "morning",
  seriesId: "weekday-series",
  occurrenceDate: "2026-08-10",
  eligibilityDate: "2026-08-10",
  startsAt: "2026-08-10T01:30:00.000Z",
  durationMinutes: 60,
  venue: "Court 1",
  status: "scheduled",
  replacementForOccurrenceId: null,
}

const evening: TrainingSessionOccurrence = {
  ...morning,
  id: "evening",
  startsAt: "2026-08-10T12:30:00.000Z",
}

describe("focused attendance recording selection", () => {
  it("selects only an explicit occurrence on the requested date and canonicalizes stale input", () => {
    expect(resolvePlayerAttendanceSelection({
      occurrences: [morning, evening],
      query: {},
      today: "2026-08-09",
    })).toEqual({
      dateKey: "2026-08-09",
      fromCalendar: false,
      occurrenceId: null,
      requiresCanonicalRedirect: true,
      staffOpen: false,
    })

    const selected = resolvePlayerAttendanceSelection({
      occurrences: [morning, evening],
      query: {
        date: "2026-08-10",
        from: "calendar",
        occurrence: "evening",
      },
      today: "2026-08-09",
    })
    expect(selected).toEqual({
      dateKey: "2026-08-10",
      fromCalendar: true,
      occurrenceId: "evening",
      requiresCanonicalRedirect: false,
      staffOpen: false,
    })
    expect(playerAttendanceRecordHref(selected)).toBe(
      "/coach/attendance/players/record?date=2026-08-10&occurrence=evening&from=calendar",
    )

    expect(resolvePlayerAttendanceSelection({
      occurrences: [morning, evening],
      query: { date: "2026-08-10", occurrence: "missing" },
      today: "2026-08-09",
    })).toMatchObject({
      dateKey: "2026-08-10",
      occurrenceId: null,
      requiresCanonicalRedirect: true,
    })
  })

  // The staff roll call is the Mark tab's first card; `staff=open` opens it, and
  // only one card is open at a time, so an occurrence beside it wins.
  it("opens the staff card from the query, never beside an occurrence", () => {
    const staff = resolvePlayerAttendanceSelection({
      occurrences: [morning, evening],
      query: { date: "2026-08-10", staff: "open" },
      today: "2026-08-09",
    })
    expect(staff).toMatchObject({ requiresCanonicalRedirect: false, staffOpen: true })
    expect(playerAttendanceRecordHref(staff))
      .toBe("/coach/attendance/players/record?date=2026-08-10&staff=open")

    expect(resolvePlayerAttendanceSelection({
      occurrences: [morning, evening],
      query: { date: "2026-08-10", occurrence: "evening", staff: "open" },
      today: "2026-08-09",
    })).toMatchObject({ occurrenceId: "evening", requiresCanonicalRedirect: true, staffOpen: false })

    expect(resolvePlayerAttendanceSelection({
      occurrences: [morning, evening],
      query: { date: "2026-08-10", staff: "yes" },
      today: "2026-08-09",
    })).toMatchObject({ requiresCanonicalRedirect: true, staffOpen: false })
  })

  it("orders the day by start time and derives its roster from effective assignment days", () => {
    expect(chronologicalOccurrencesForDate(
      [evening, { ...morning, id: "other-day", occurrenceDate: "2026-08-11" }, morning],
      "2026-08-10",
    ).map((occurrence) => occurrence.id)).toEqual(["morning", "evening"])

    const assignments: SessionAssignment[] = [
      {
        id: "eligible-assignment",
        playerId: "eligible",
        seriesId: morning.seriesId,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        weekdays: [1],
      },
      {
        id: "wrong-day-assignment",
        playerId: "wrong-day",
        seriesId: morning.seriesId,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        weekdays: [3],
      },
    ]

    expect(eligiblePlayerIdsForOccurrence({
      assignments,
      occurrence: morning,
      players: [
        { id: "eligible", joinedOn: "2026-08-01" },
        { id: "wrong-day", joinedOn: "2026-08-01" },
        { id: "joined-later", joinedOn: "2026-08-11" },
      ],
    })).toEqual(["eligible"])
  })

  it("reports how far each register got, counting only the eligible and only what is saved", () => {
    const assignments: SessionAssignment[] = [
      {
        id: "monday-assignment",
        playerId: "eligible",
        seriesId: morning.seriesId,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        weekdays: [1],
      },
      {
        id: "second-monday-assignment",
        playerId: "also-eligible",
        seriesId: morning.seriesId,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        weekdays: [1],
      },
    ]
    const players = [
      { id: "eligible", joinedOn: "2026-08-01" },
      { id: "also-eligible", joinedOn: "2026-08-01" },
      { id: "never-assigned", joinedOn: "2026-08-01" },
    ]

    const progress = rosterProgressForOccurrences({
      assignments,
      occurrences: [morning, evening],
      players,
      records: {
        // A mark against someone this session never rostered must not count
        // towards it, or a finished register reads as over-complete.
        morning: { eligible: "present", "never-assigned": "present" },
      },
    })

    expect(progress.get("morning")).toEqual({ eligible: 2, marked: 1 })
    expect(progress.get("evening")).toEqual({ eligible: 2, marked: 0 })
  })

  it("counts a register nobody has touched as zero rather than omitting it", () => {
    const progress = rosterProgressForOccurrences({
      assignments: [],
      occurrences: [morning],
      players: [],
      records: {},
    })

    expect(progress.get("morning")).toEqual({ eligible: 0, marked: 0 })
  })
})

// The dashboard's Attendance card and the Mark tab's day line both count with
// this, so they agree on the two cases they used to disagree on.
describe("a day's marked sessions", () => {
  const afternoon: TrainingSessionOccurrence = { ...morning, id: "afternoon" }
  const cancelled: TrainingSessionOccurrence = { ...morning, id: "cancelled", status: "cancelled" }

  it("leaves a cancelled session out of both counts", () => {
    expect(daySessionsMarked([morning, cancelled], new Map([
      ["morning", { eligible: 2, marked: 2 }],
      ["cancelled", { eligible: 2, marked: 0 }],
    ]))).toEqual({ marked: 1, total: 1 })
  })

  it("counts a session with nobody to mark as marked", () => {
    expect(daySessionsMarked([morning, evening, afternoon], new Map([
      ["morning", { eligible: 0, marked: 0 }],
      ["evening", { eligible: 3, marked: 3 }],
      ["afternoon", { eligible: 3, marked: 2 }],
    ]))).toEqual({ marked: 2, total: 3 })
  })

  it("has nothing to count on a day whose sessions were all cancelled", () => {
    expect(daySessionsMarked([cancelled], new Map())).toEqual({ marked: 0, total: 0 })
  })
})
