import { describe, expect, it } from "vitest"

import { resolveAttendanceRegisterSelection } from "@/lib/attendance/register-workspace"
import type {
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

const series: TrainingSessionSeries[] = [
  {
    id: "beginner-weekday",
    title: "Beginner weekday",
    programme: "Beginner",
    batch: "Weekday",
    venue: "Court 1",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    status: "active",
    slots: [],
  },
  {
    id: "adult-weekend",
    title: "Adult weekend",
    programme: "Adult",
    batch: "Weekend",
    venue: "Court 1",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    status: "active",
    slots: [],
  },
]

function occurrence(input: Partial<TrainingSessionOccurrence>): TrainingSessionOccurrence {
  return {
    id: "occurrence",
    seriesId: "beginner-weekday",
    occurrenceDate: "2026-08-09",
    eligibilityDate: "2026-08-09",
    startsAt: "2026-08-09T00:30:00.000Z",
    durationMinutes: 60,
    venue: "Court 1",
    status: "scheduled",
    replacementForOccurrenceId: null,
    ...input,
  }
}

describe("attendance register route selection", () => {
  it("uses valid URL filters as the server-owned selection", () => {
    expect(resolveAttendanceRegisterSelection({
      occurrences: [],
      query: { batch: "Weekend", level: "Adult", year: "2027" },
      series,
      today: "2026-08-09",
    })).toEqual({ batch: "Weekend", programme: "Adult", year: 2027 })
  })

  it("falls back to today's first scheduled session and the current year", () => {
    expect(resolveAttendanceRegisterSelection({
      occurrences: [
        occurrence({ id: "later", startsAt: "2026-08-09T03:30:00.000Z" }),
        occurrence({
          id: "first",
          seriesId: "adult-weekend",
          startsAt: "2026-08-09T01:30:00.000Z",
        }),
      ],
      query: { batch: "invalid", level: "invalid", year: "2099" },
      series,
      today: "2026-08-09",
    })).toEqual({ batch: "Weekend", programme: "Adult", year: 2026 })
  })

  it("ignores cancelled sessions when deriving the default category", () => {
    expect(resolveAttendanceRegisterSelection({
      occurrences: [occurrence({
        seriesId: "adult-weekend",
        status: "cancelled",
      })],
      query: {},
      series,
      today: "2026-08-09",
    })).toEqual({ batch: "Weekday", programme: "Beginner", year: 2026 })
  })
})
