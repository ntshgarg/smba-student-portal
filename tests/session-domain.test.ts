import { describe, expect, it } from "vitest"

import {
  assignmentCoversOccurrence,
  buildOccurrenceDrafts,
  calendarWindowForMonth,
  dateRangesOverlapInclusive,
  distinctAssignmentWeekdays,
  indiaLocalDateTime,
  playerWasEnrolledForOccurrence,
  resolveNextAssignedOccurrence,
  resolveNextScheduledOccurrence,
  sessionDisplayName,
  sessionSlotsOverlap,
  validateSeriesInput,
} from "@/lib/sessions/domain"
import { occurrenceHasStarted, occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"

describe("session scheduling domain", () => {
  it("compares canonical schedule terms as inclusive ranges with open-ended support", () => {
    const firstTerm = { startsOn: "2026-07-01", endsOn: "2026-08-31" }

    expect(dateRangesOverlapInclusive(firstTerm, {
      startsOn: "2026-08-31",
      endsOn: "2026-09-30",
    })).toBe(true)
    expect(dateRangesOverlapInclusive(firstTerm, {
      startsOn: "2026-09-01",
      endsOn: "2026-10-31",
    })).toBe(false)
    expect(dateRangesOverlapInclusive(firstTerm, {
      startsOn: "2026-07-15",
      endsOn: "2026-08-15",
    })).toBe(true)
    expect(dateRangesOverlapInclusive({
      startsOn: "2026-01-01",
      endsOn: null,
    }, {
      startsOn: "2030-01-01",
      endsOn: "2030-01-31",
    })).toBe(true)
  })

  it("resolves complete calendar months for the month navigator", () => {
    expect(calendarWindowForMonth("2026-08"))
      .toEqual({ from: "2026-08-01", to: "2026-08-31" })
  })

  it("generates immutable occurrence drafts only on recurrence weekdays", () => {
    const drafts = buildOccurrenceDrafts({
      from: "2026-08-01",
      to: "2026-08-09",
      series: { id: "series", startsOn: "2026-08-01", endsOn: null, venue: "Court 1" },
      slots: [{ id: "sun", weekday: 0, startTime: "07:00", durationMinutes: 60 }],
    })
    expect(drafts.map((draft) => draft.occurrenceDate)).toEqual(["2026-08-02", "2026-08-09"])
    expect(drafts[0].startsAt.toISOString()).toBe("2026-08-02T01:30:00.000Z")
  })

  it("uses inclusive assignment starts and exclusive assignment ends", () => {
    const assignment = { id: "assignment", playerId: "player", seriesId: "series", effectiveFrom: "2026-08-02", effectiveTo: "2026-08-09", weekdays: [0] }
    expect(assignmentCoversOccurrence(assignment, { seriesId: "series", eligibilityDate: "2026-08-02" })).toBe(true)
    expect(assignmentCoversOccurrence(assignment, { seriesId: "series", eligibilityDate: "2026-08-03" })).toBe(false)
    expect(assignmentCoversOccurrence(assignment, { seriesId: "series", eligibilityDate: "2026-08-09" })).toBe(false)
  })

  it("uses the source date rather than the replacement date for roster eligibility", () => {
    const saturdayAssignment = {
      seriesId: "series",
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-02",
      weekdays: [6],
    }
    const wednesdayAssignment = {
      seriesId: "series",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      weekdays: [3],
    }
    const replacement = {
      seriesId: "series",
      eligibilityDate: "2026-08-01",
    }

    expect(assignmentCoversOccurrence(saturdayAssignment, replacement)).toBe(true)
    expect(assignmentCoversOccurrence(wednesdayAssignment, replacement)).toBe(false)
    expect(playerWasEnrolledForOccurrence("2026-08-01", replacement)).toBe(true)
    expect(playerWasEnrolledForOccurrence("2026-08-02", replacement)).toBe(false)
  })

  it("counts the union of active assignment weekdays only once", () => {
    expect(distinctAssignmentWeekdays([[1, 3, 5], [1, 3], [5]])).toEqual([1, 3, 5])
  })

  it("changes a same-day occurrence from upcoming to actionable at its exact start instant", () => {
    const occurrence = { startsAt: "2026-08-03T00:30:00.000Z" }
    expect(occurrenceHasStarted(occurrence, "2026-08-03T00:29:59.999Z")).toBe(false)
    expect(occurrenceIsUpcoming(occurrence, "2026-08-03T00:29:59.999Z")).toBe(true)
    expect(occurrenceHasStarted(occurrence, "2026-08-03T00:30:00.000Z")).toBe(true)
    expect(occurrenceIsUpcoming(occurrence, "2026-08-03T00:30:00.000Z")).toBe(false)
  })

  it("shows today's session until its start, then resolves the next assigned session", () => {
    const assignment = {
      id: "assignment",
      playerId: "player",
      seriesId: "series",
      effectiveFrom: "2026-08-03",
      effectiveTo: null,
      weekdays: [1, 3],
    }
    const occurrences = [
      {
        id: "today",
        seriesId: "series",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T12:30:00.000Z",
        durationMinutes: 60,
        venue: "Court 1",
        status: "scheduled" as const,
        replacementForOccurrenceId: null,
      },
      {
        id: "next",
        seriesId: "series",
        occurrenceDate: "2026-08-05",
        eligibilityDate: "2026-08-05",
        startsAt: "2026-08-05T12:30:00.000Z",
        durationMinutes: 60,
        venue: "Court 1",
        status: "scheduled" as const,
        replacementForOccurrenceId: null,
      },
    ]

    expect(resolveNextAssignedOccurrence({
      assignments: [assignment],
      occurrences,
      referenceInstant: "2026-08-03T12:29:59.999Z",
    })?.id).toBe("today")
    expect(resolveNextAssignedOccurrence({
      assignments: [assignment],
      occurrences,
      referenceInstant: "2026-08-03T12:30:00.000Z",
    })?.id).toBe("today")
    expect(resolveNextAssignedOccurrence({
      assignments: [assignment],
      occurrences,
      referenceInstant: "2026-08-03T12:30:00.001Z",
    })?.id).toBe("next")
  })

  it("resolves the coach's next scheduled session from the current time", () => {
    const occurrences = [
      {
        id: "first",
        seriesId: "series-one",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T00:30:00.000Z",
        durationMinutes: 60,
        venue: "Court 1",
        status: "scheduled" as const,
        replacementForOccurrenceId: null,
      },
      {
        id: "second",
        seriesId: "series-two",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T02:30:00.000Z",
        durationMinutes: 60,
        venue: "Court 2",
        status: "scheduled" as const,
        replacementForOccurrenceId: null,
      },
    ]

    expect(resolveNextScheduledOccurrence({
      occurrences,
      referenceInstant: "2026-08-03T00:00:00.000Z",
    })?.id).toBe("first")
    expect(resolveNextScheduledOccurrence({
      occurrences,
      referenceInstant: "2026-08-03T00:30:00.001Z",
    })?.id).toBe("second")
    expect(resolveNextScheduledOccurrence({
      occurrences,
      referenceInstant: "2026-08-03T02:30:00.001Z",
    })).toBeNull()
  })

  it("generates stable display names and validates batch days", () => {
    expect(indiaLocalDateTime("2026-08-02", "07:00").toISOString()).toBe("2026-08-02T01:30:00.000Z")
    expect(sessionDisplayName({
      programme: "Adult", batch: "Weekday", startTime: "18:00", durationMinutes: 60,
    })).toBe("Adult_Weekday_6-7_PM")
    expect(sessionDisplayName({
      programme: "Intermediate", batch: "Weekday", startTime: "11:30", durationMinutes: 60,
    })).toBe("Intermediate_Weekday_11:30_AM-12:30_PM")
    expect(() => validateSeriesInput({
      programme: "Adult",
      batch: "Weekday",
      venue: "Court 1",
      startsOn: "2026-08-01",
      endsOn: "",
      weekdays: [1],
      startTime: "07:00",
      durationMinutes: 60,
    })).toThrow("valid schedule end date")
    expect(() => validateSeriesInput({
      programme: "Adult",
      batch: "Weekend",
      venue: "Court 1",
      startsOn: "2026-08-01",
      endsOn: "2026-10-31",
      weekdays: [1],
      startTime: "07:00",
      durationMinutes: 60,
    })).toThrow("weekend training days")
  })

  it("detects overlapping recurring slots while allowing back-to-back sessions", () => {
    const first = { slots: [{ id: "one", weekday: 1, startTime: "18:00", durationMinutes: 60 }] }
    expect(sessionSlotsOverlap(first, {
      slots: [{ id: "two", weekday: 1, startTime: "18:30", durationMinutes: 60 }],
    })).toBe(true)
    expect(sessionSlotsOverlap(first, {
      slots: [{ id: "three", weekday: 1, startTime: "19:00", durationMinutes: 60 }],
    })).toBe(false)
  })
})
