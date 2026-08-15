import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  initializeDatabase: vi.fn(),
  listAttendanceRegisterPlayerRecords: vi.fn(),
  listOperationalPlayerRecords: vi.fn(),
  listSessionAssignmentsForSeries: vi.fn(),
  listSessionAttendanceRecordsForOccurrences: vi.fn(),
  listSessionOccurrences: vi.fn(),
  listSessionOccurrencesForSeries: vi.fn(),
  listSessionSeries: vi.fn(),
}))

vi.mock("@/lib/coach/database", () => ({
  listAttendanceRegisterPlayerRecords: mocks.listAttendanceRegisterPlayerRecords,
  listOperationalPlayerRecords: mocks.listOperationalPlayerRecords,
}))
vi.mock("@/lib/db/client", () => ({ initializeDatabase: mocks.initializeDatabase }))
vi.mock("@/lib/sessions/database", () => ({
  listSessionAssignmentsForSeries: mocks.listSessionAssignmentsForSeries,
  listSessionAttendanceRecordsForOccurrences: mocks.listSessionAttendanceRecordsForOccurrences,
  listSessionOccurrences: mocks.listSessionOccurrences,
  listSessionOccurrencesForSeries: mocks.listSessionOccurrencesForSeries,
  listSessionSeries: mocks.listSessionSeries,
}))

import {
  getCoachAttendanceRegisterSnapshot,
  getCoachCalendarMonthSnapshot,
} from "@/lib/coach/session-read-models"
import type {
  SessionAssignment,
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
const occurrence: TrainingSessionOccurrence = {
  id: "occurrence-1",
  seriesId: "beginner-weekday",
  occurrenceDate: "2026-08-03",
  eligibilityDate: "2026-08-03",
  startsAt: "2026-08-03T00:30:00.000Z",
  durationMinutes: 60,
  venue: "Court 1",
  status: "scheduled",
  replacementForOccurrenceId: null,
}
const assignment: SessionAssignment = {
  id: "assignment-1",
  playerId: "player-1",
  seriesId: "beginner-weekday",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  weekdays: [1],
}

function emptyAdjustmentQuery() {
  const query = {
    all: vi.fn(() => []),
    from: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
    where: vi.fn(),
  }
  query.from.mockReturnValue(query)
  query.innerJoin.mockReturnValue(query)
  query.orderBy.mockReturnValue(query)
  query.where.mockReturnValue(query)
  return query
}

describe("route-scoped coach session read models", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const adjustmentQuery = emptyAdjustmentQuery()
    mocks.initializeDatabase.mockReturnValue({ select: vi.fn(() => adjustmentQuery) })
    mocks.listSessionSeries.mockReturnValue(series)
    mocks.listSessionOccurrences.mockReturnValue([occurrence])
    mocks.listSessionOccurrencesForSeries.mockReturnValue([occurrence])
    mocks.listSessionAssignmentsForSeries.mockReturnValue([assignment])
    mocks.listSessionAttendanceRecordsForOccurrences.mockReturnValue({})
    mocks.listOperationalPlayerRecords.mockReturnValue({
      members: [{ id: "player-1" }],
      trainingProfiles: [{ memberId: "player-1" }],
    })
    mocks.listAttendanceRegisterPlayerRecords.mockReturnValue({
      members: [{ id: "player-1" }],
      trainingProfiles: [{ memberId: "player-1" }],
    })
  })

  it("loads Calendar occurrences for one exact month and only its roster players", () => {
    const snapshot = getCoachCalendarMonthSnapshot("2026-08")

    expect(mocks.listSessionOccurrences).toHaveBeenCalledWith("2026-08-01", "2026-08-31")
    expect(mocks.listSessionAssignmentsForSeries).toHaveBeenCalledWith(["beginner-weekday"])
    expect(mocks.listOperationalPlayerRecords).toHaveBeenCalledWith(["player-1"])
    expect(mocks.listAttendanceRegisterPlayerRecords).not.toHaveBeenCalled()
    expect(snapshot.sessionOccurrences).toEqual([occurrence])
  })

  it("loads one Attendance category/year and scopes attendance to that occurrence set", () => {
    const snapshot = getCoachAttendanceRegisterSnapshot({
      batch: "Weekday",
      programme: "Beginner",
      year: 2026,
    }, series)

    expect(mocks.listSessionOccurrencesForSeries).toHaveBeenCalledWith(
      "2025-12-18",
      "2026-12-31",
      ["beginner-weekday"],
    )
    expect(mocks.listSessionAssignmentsForSeries).toHaveBeenCalledWith(["beginner-weekday"])
    expect(mocks.listSessionAttendanceRecordsForOccurrences).toHaveBeenCalledWith(["occurrence-1"])
    expect(mocks.listAttendanceRegisterPlayerRecords).toHaveBeenCalledWith(["player-1"])
    expect(snapshot.sessionSeries).toEqual(series)
  })

  it("retains a prior-year assignment when a replacement occurs in the displayed year", () => {
    const replacement = {
      ...occurrence,
      id: "replacement-1",
      occurrenceDate: "2026-01-03",
      eligibilityDate: "2025-12-27",
      startsAt: "2026-01-03T00:30:00.000Z",
      replacementForOccurrenceId: "source-1",
    }
    const priorYearAssignment = {
      ...assignment,
      effectiveFrom: "2025-12-01",
      effectiveTo: "2025-12-28",
      weekdays: [6],
    }
    mocks.listSessionOccurrencesForSeries.mockReturnValue([replacement])
    mocks.listSessionAssignmentsForSeries.mockReturnValue([priorYearAssignment])

    const snapshot = getCoachAttendanceRegisterSnapshot({
      batch: "Weekday",
      programme: "Beginner",
      year: 2026,
    }, series)

    expect(snapshot.sessionAssignments).toEqual([priorYearAssignment])
    expect(mocks.listAttendanceRegisterPlayerRecords).toHaveBeenCalledWith(["player-1"])
  })
})
