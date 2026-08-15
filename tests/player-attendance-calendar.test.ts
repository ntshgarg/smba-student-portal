import { describe, expect, it } from "vitest"

import {
  buildPlayerAttendanceCalendar,
  buildPlayerAttendanceCalendarDates,
} from "@/components/dashboard/player-attendance-calendar"
import type { PlayerAttendanceRecord } from "@/lib/types"

function recordFixture(): PlayerAttendanceRecord {
  return {
    referenceDate: "2026-08-03",
    referenceInstant: "2026-08-03T14:00:00.000Z",
    joinedOn: "2026-01-01",
    years: [2025, 2026, 2027],
    sessions: [
      {
        id: "series-present",
        programme: "Beginner",
        batch: "Weekday",
        startTime: "16:00",
        durationMinutes: 60,
      },
      {
        id: "series-absent",
        programme: "Beginner",
        batch: "Weekday",
        startTime: "18:00",
        durationMinutes: 60,
      },
      {
        id: "series-pending",
        programme: "Beginner",
        batch: "Weekday",
        startTime: "19:30",
        durationMinutes: 60,
      },
      {
        id: "series-future",
        programme: "Beginner",
        batch: "Weekday",
        startTime: "16:00",
        durationMinutes: 60,
      },
      {
        id: "series-rescheduled",
        programme: "Beginner",
        batch: "Weekday",
        startTime: "17:00",
        durationMinutes: 60,
      },
    ],
    assignments: [
      {
        id: "assignment-present",
        seriesId: "series-present",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        weekdays: [1],
      },
      {
        id: "assignment-absent",
        seriesId: "series-absent",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        weekdays: [1],
      },
      {
        id: "assignment-pending",
        seriesId: "series-pending",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        weekdays: [1],
      },
      {
        id: "assignment-future",
        seriesId: "series-future",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        weekdays: [3],
      },
      {
        id: "assignment-rescheduled",
        seriesId: "series-rescheduled",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        weekdays: [5],
      },
    ],
    occurrences: [
      {
        id: "occurrence-present",
        seriesId: "series-present",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T10:30:00.000Z",
        durationMinutes: 60,
        status: "scheduled",
      },
      {
        id: "occurrence-absent",
        seriesId: "series-absent",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T12:30:00.000Z",
        durationMinutes: 60,
        status: "scheduled",
      },
      {
        id: "occurrence-pending",
        seriesId: "series-pending",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T11:30:00.000Z",
        durationMinutes: 60,
        status: "scheduled",
      },
      {
        id: "occurrence-future",
        seriesId: "series-future",
        occurrenceDate: "2026-08-05",
        eligibilityDate: "2026-08-05",
        startsAt: "2026-08-05T10:30:00.000Z",
        durationMinutes: 60,
        status: "scheduled",
      },
      {
        id: "occurrence-rescheduled",
        seriesId: "series-rescheduled",
        occurrenceDate: "2026-07-31",
        eligibilityDate: "2026-07-31",
        startsAt: "2026-07-31T11:30:00.000Z",
        durationMinutes: 60,
        status: "scheduled",
      },
    ],
    records: [
      { occurrenceId: "occurrence-present", choice: "present" },
      { occurrenceId: "occurrence-absent", choice: "absent" },
      { occurrenceId: "occurrence-rescheduled", choice: "absent" },
    ],
    adjustments: [{
      sourceOccurrenceId: "occurrence-rescheduled",
      completedOn: "2026-08-01",
    }],
  }
}

describe("Player attendance month calendar", () => {
  it("builds a stable Monday-first six-week grid", () => {
    const dates = buildPlayerAttendanceCalendarDates(2026, 8)

    expect(dates).toHaveLength(42)
    expect(dates[0]).toBe("2026-07-27")
    expect(dates[41]).toBe("2026-09-06")
  })

  it("preserves every same-day session and each attendance state", () => {
    const calendar = buildPlayerAttendanceCalendar(recordFixture(), 2026, 8)
    const augustThird = calendar.days.find((day) => day.key === "2026-08-03")
    const augustFifth = calendar.days.find((day) => day.key === "2026-08-05")
    const julyThirtyFirst = calendar.days.find((day) => day.key === "2026-07-31")
    const augustFirst = calendar.days.find((day) => day.key === "2026-08-01")

    expect(augustThird?.isToday).toBe(true)
    expect(augustThird?.sessions).toHaveLength(3)
    expect(augustThird?.sessions.map((session) => session.state)).toEqual([
      "present",
      "absent",
      "pending",
    ])
    expect(new Set(augustThird?.sessions.map((session) => session.timeLabel))).toEqual(
      new Set(["4–5 pm", "6–7 pm", "7:30–8:30 pm"]),
    )
    expect(augustFifth?.sessions[0].state).toBe("future")
    expect(julyThirtyFirst?.sessions[0].state).toBe("rescheduled")
    expect(augustFirst?.completionCount).toBe(1)
  })
})
