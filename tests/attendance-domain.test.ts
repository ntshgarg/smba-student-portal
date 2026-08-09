import { describe, expect, it } from "vitest"

import {
  assertAttendanceBreakdown,
  calculateMonthlyAttendance,
  createAttendanceSnapshotV2,
  createAttendanceSnapshotV3,
  createAttendanceSnapshotV4,
  parseAttendanceSnapshot,
} from "@/lib/attendance/domain"

describe("session occurrence attendance domain", () => {
  it("counts only real completed occurrences covered by the player assignment", () => {
    const result = calculateMonthlyAttendance({
      month: "2026-07",
      referenceDate: "2026-07-31",
      joinedOn: "2026-07-18",
      assignments: [{ seriesId: "weekend-adult", effectiveFrom: "2026-07-18", effectiveTo: null, weekdays: [0, 6] }],
      occurrences: ["18", "19", "25", "26"].map((day) => ({
        id: `occ-${day}`,
        seriesId: "weekend-adult",
        occurrenceDate: `2026-07-${day}`,
        eligibilityDate: `2026-07-${day}`,
        status: "scheduled" as const,
      })),
      records: [
        { occurrenceId: "occ-18", choice: "present" },
        { occurrenceId: "occ-19", choice: "present" },
        { occurrenceId: "occ-25", choice: "absent" },
      ],
    })

    expect(result).toEqual({
      eligible: 4,
      recorded: 3,
      attended: 2,
      absent: 1,
      pending: 1,
      percentage: 67,
    })
  })

  it("excludes future and cancelled occurrences", () => {
    expect(calculateMonthlyAttendance({
      month: "2026-08",
      referenceDate: "2026-08-12",
      joinedOn: "2026-07-31",
      assignments: [{ seriesId: "weekday-adult", effectiveFrom: "2026-07-31", effectiveTo: null, weekdays: [1] }],
      occurrences: [
        { id: "one", seriesId: "weekday-adult", occurrenceDate: "2026-08-10", eligibilityDate: "2026-08-10", status: "scheduled" },
        { id: "two", seriesId: "weekday-adult", occurrenceDate: "2026-08-11", eligibilityDate: "2026-08-11", status: "cancelled" },
        { id: "three", seriesId: "weekday-adult", occurrenceDate: "2026-08-13", eligibilityDate: "2026-08-13", status: "scheduled" },
      ],
      records: [],
    })).toEqual({ eligible: 1, recorded: 0, attended: 0, absent: 0, pending: 1, percentage: null })
  })

  it("counts two assigned sessions on the same day as two eligible occurrences", () => {
    expect(calculateMonthlyAttendance({
      month: "2026-08",
      referenceDate: "2026-08-02",
      joinedOn: "2026-08-01",
      assignments: [
        { seriesId: "adult-six", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [0] },
        { seriesId: "adult-seven", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [0] },
      ],
      occurrences: [
        { id: "six", seriesId: "adult-six", occurrenceDate: "2026-08-02", eligibilityDate: "2026-08-02", status: "scheduled" },
        { id: "seven", seriesId: "adult-seven", occurrenceDate: "2026-08-02", eligibilityDate: "2026-08-02", status: "scheduled" },
      ],
      records: [
        { occurrenceId: "six", choice: "present" },
        { occurrenceId: "seven", choice: "present" },
      ],
    })).toMatchObject({ eligible: 2, recorded: 2, attended: 2, pending: 0, percentage: 100 })
  })

  it("counts only same-day sessions that have reached their start instant", () => {
    const input = {
      month: "2026-08",
      referenceDate: "2026-08-03",
      joinedOn: "2026-08-01",
      assignments: [
        { seriesId: "adult-six", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [1] },
        { seriesId: "adult-seven", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [1] },
      ],
      occurrences: [
        {
          id: "six",
          seriesId: "adult-six",
          occurrenceDate: "2026-08-03",
          eligibilityDate: "2026-08-03",
          startsAt: "2026-08-03T00:30:00.000Z",
          status: "scheduled" as const,
        },
        {
          id: "seven",
          seriesId: "adult-seven",
          occurrenceDate: "2026-08-03",
          eligibilityDate: "2026-08-03",
          startsAt: "2026-08-03T01:30:00.000Z",
          status: "scheduled" as const,
        },
      ],
      records: [],
    }

    expect(calculateMonthlyAttendance({
      ...input,
      referenceInstant: "2026-08-03T01:00:00.000Z",
    })).toMatchObject({ eligible: 1, pending: 1 })
    expect(calculateMonthlyAttendance({
      ...input,
      referenceInstant: "2026-08-03T01:30:00.000Z",
    })).toMatchObject({ eligible: 2, pending: 2 })
  })

  it("uses non-overlapping assignment intervals during a schedule transfer", () => {
    const result = calculateMonthlyAttendance({
      month: "2026-07",
      referenceDate: "2026-07-31",
      joinedOn: "2026-06-30",
      assignments: [
        { seriesId: "series-a", effectiveFrom: "2026-06-30", effectiveTo: "2026-07-16", weekdays: [3, 5] },
        { seriesId: "series-b", effectiveFrom: "2026-07-16", effectiveTo: null, weekdays: [3, 5] },
      ],
      occurrences: [
        { id: "a-before", seriesId: "series-a", occurrenceDate: "2026-07-15", eligibilityDate: "2026-07-15", status: "scheduled" },
        { id: "a-after", seriesId: "series-a", occurrenceDate: "2026-07-17", eligibilityDate: "2026-07-17", status: "scheduled" },
        { id: "b-before", seriesId: "series-b", occurrenceDate: "2026-07-15", eligibilityDate: "2026-07-15", status: "scheduled" },
        { id: "b-after", seriesId: "series-b", occurrenceDate: "2026-07-17", eligibilityDate: "2026-07-17", status: "scheduled" },
      ],
      records: [],
    })
    expect(result.eligible).toBe(2)
    expect(result.pending).toBe(2)
  })

  it("produces the same date-only result in different host timezones", () => {
    const originalTimezone = process.env.TZ
    const input = {
      month: "2026-08",
      referenceDate: "2026-08-10",
      joinedOn: "2026-08-01",
      assignments: [{ seriesId: "weekend-adult", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [0, 6] }],
      occurrences: [
        { id: "one", seriesId: "weekend-adult", occurrenceDate: "2026-08-02", eligibilityDate: "2026-08-02", status: "scheduled" as const },
        { id: "two", seriesId: "weekend-adult", occurrenceDate: "2026-08-08", eligibilityDate: "2026-08-08", status: "scheduled" as const },
      ],
      records: [
        { occurrenceId: "one", choice: "present" as const },
        { occurrenceId: "two", choice: "absent" as const },
      ],
    }
    try {
      process.env.TZ = "America/Los_Angeles"
      const west = calculateMonthlyAttendance(input)
      process.env.TZ = "Asia/Kolkata"
      expect(calculateMonthlyAttendance(input)).toEqual(west)
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })

  it("reconciles an absent source as attended without changing the denominator", () => {
    const result = calculateMonthlyAttendance({
      month: "2026-08",
      referenceDate: "2026-08-31",
      joinedOn: "2026-08-01",
      assignments: [{ seriesId: "adult", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [1, 3] }],
      occurrences: [
        { id: "missed", seriesId: "adult", occurrenceDate: "2026-08-03", eligibilityDate: "2026-08-03", status: "scheduled" },
        { id: "present", seriesId: "adult", occurrenceDate: "2026-08-05", eligibilityDate: "2026-08-05", status: "scheduled" },
      ],
      records: [
        { occurrenceId: "missed", choice: "absent" },
        { occurrenceId: "present", choice: "present" },
      ],
      adjustments: [{ id: "makeup-1", sourceOccurrenceId: "missed" }],
    })

    expect(result).toEqual({
      eligible: 2,
      recorded: 2,
      attended: 2,
      absent: 0,
      pending: 0,
      percentage: 100,
    })
  })

  it("applies a later-month make-up only to its source month", () => {
    const shared = {
      referenceDate: "2026-08-31",
      joinedOn: "2026-07-01",
      assignments: [{ seriesId: "adult", effectiveFrom: "2026-07-01", effectiveTo: null, weekdays: [1] }],
      records: [{ occurrenceId: "july-missed", choice: "absent" as const }],
      adjustments: [{ id: "makeup-august", sourceOccurrenceId: "july-missed" }],
    }
    const july = calculateMonthlyAttendance({
      ...shared,
      month: "2026-07",
      occurrences: [{ id: "july-missed", seriesId: "adult", occurrenceDate: "2026-07-27", eligibilityDate: "2026-07-27", status: "scheduled" }],
    })
    const august = calculateMonthlyAttendance({
      ...shared,
      month: "2026-08",
      occurrences: [{ id: "august-session", seriesId: "adult", occurrenceDate: "2026-08-03", eligibilityDate: "2026-08-03", status: "scheduled" }],
      records: [{ occurrenceId: "august-session", choice: "present" }],
    })

    expect(july).toMatchObject({ eligible: 1, attended: 1, absent: 0, percentage: 100 })
    expect(august).toMatchObject({ eligible: 1, attended: 1, absent: 0, percentage: 100 })
  })

  it("does not apply an adjustment to a pending or present source", () => {
    const base = {
      month: "2026-08",
      referenceDate: "2026-08-31",
      joinedOn: "2026-08-01",
      assignments: [{ seriesId: "adult", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [1] }],
      occurrences: [{ id: "source", seriesId: "adult", occurrenceDate: "2026-08-03", eligibilityDate: "2026-08-03", status: "scheduled" as const }],
      adjustments: [{ id: "makeup", sourceOccurrenceId: "source" }],
    }

    expect(calculateMonthlyAttendance({ ...base, records: [] }))
      .toMatchObject({ recorded: 0, attended: 0, pending: 1 })
    expect(calculateMonthlyAttendance({
      ...base,
      records: [{ occurrenceId: "source", choice: "present" }],
    })).toMatchObject({ recorded: 1, attended: 1, absent: 0 })
  })

  it("keeps V1-V3 readable and creates adjustment-aware immutable V4 snapshots", () => {
    expect(() => assertAttendanceBreakdown({
      eligible: 3, recorded: 2, attended: 2, absent: 1, pending: 1, percentage: 100,
    })).toThrow("Recorded attendance")

    const snapshot = createAttendanceSnapshotV2({
      month: "2026-07",
      referenceDate: "2026-08-02",
      joinedOn: "2026-06-30",
      assignments: [],
      occurrences: [],
      records: [],
    })
    expect(parseAttendanceSnapshot(snapshot)).toEqual(snapshot)
    expect(parseAttendanceSnapshot({
      version: 1,
      month: "2026-07",
      referenceDate: "2026-08-02",
      eligible: 1,
      recorded: 1,
      attended: 1,
      absent: 0,
      pending: 0,
      percentage: 100,
    })?.version).toBe(1)
    expect(parseAttendanceSnapshot({ ...snapshot, version: 3 })).toBeNull()

    const preciseSnapshot = createAttendanceSnapshotV3({
      month: "2026-08",
      referenceDate: "2026-08-03",
      referenceInstant: "2026-08-03T00:30:00.000Z",
      joinedOn: "2026-08-01",
      assignments: [],
      occurrences: [],
      records: [],
    })
    expect(parseAttendanceSnapshot(preciseSnapshot)).toEqual(preciseSnapshot)

    const adjustedSnapshot = createAttendanceSnapshotV4({
      month: "2026-08",
      referenceDate: "2026-08-31",
      referenceInstant: "2026-08-31T12:30:00.000Z",
      joinedOn: "2026-08-01",
      assignments: [{ seriesId: "adult", effectiveFrom: "2026-08-01", effectiveTo: null, weekdays: [1] }],
      occurrences: [{
        id: "source",
        seriesId: "adult",
        occurrenceDate: "2026-08-03",
        eligibilityDate: "2026-08-03",
        startsAt: "2026-08-03T12:30:00.000Z",
        status: "scheduled",
      }],
      records: [{ occurrenceId: "source", choice: "absent" }],
      adjustments: [{ id: "makeup-b", sourceOccurrenceId: "source" }],
    })
    expect(adjustedSnapshot).toMatchObject({
      version: 4,
      adjustmentPolicyVersion: 1,
      appliedAdjustmentIds: ["makeup-b"],
      eligible: 1,
      attended: 1,
      absent: 0,
    })
    expect(parseAttendanceSnapshot(adjustedSnapshot)).toEqual(adjustedSnapshot)
    expect(parseAttendanceSnapshot({ ...adjustedSnapshot, appliedAdjustmentIds: ["makeup-b", "makeup-b"] }))
      .toBeNull()
    expect(parseAttendanceSnapshot({ ...adjustedSnapshot, adjustmentPolicyVersion: 2 }))
      .toBeNull()
  })
})
