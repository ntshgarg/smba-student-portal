import { describe, expect, it } from "vitest"

import {
  chronologicalOccurrencesForDate,
  eligiblePlayerIdsForOccurrence,
  playerAttendanceRecordHref,
  resolvePlayerAttendanceSelection,
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
})
