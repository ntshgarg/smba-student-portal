import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  initializeDatabase: vi.fn(),
  listAttendanceAdjustments: vi.fn(),
  listAttendanceRegisterPlayerRecords: vi.fn(),
  listCoachMonthlyReports: vi.fn(),
  listOperationalPlayerRecords: vi.fn(),
  listSessionAssignments: vi.fn(),
  listSessionAssignmentsForPlayers: vi.fn(),
  listSessionAssignmentsForSeries: vi.fn(),
  listSessionAttendanceRecordsForPlayer: vi.fn(),
  listSessionAttendanceRecordsForOccurrences: vi.fn(),
  listSessionOccurrences: vi.fn(),
  listSessionOccurrencesByIds: vi.fn(),
  listSessionOccurrencesForSeries: vi.fn(),
  listSessionSeries: vi.fn(),
}))

vi.mock("@/lib/attendance/adjustments", () => ({
  listAttendanceAdjustments: mocks.listAttendanceAdjustments,
}))
vi.mock("@/lib/coach/database", () => ({
  listAttendanceRegisterPlayerRecords: mocks.listAttendanceRegisterPlayerRecords,
  listCoachMonthlyReports: mocks.listCoachMonthlyReports,
  listOperationalPlayerRecords: mocks.listOperationalPlayerRecords,
}))
vi.mock("@/lib/db/client", () => ({ initializeDatabase: mocks.initializeDatabase }))
vi.mock("@/lib/sessions/database", () => ({
  listSessionAssignments: mocks.listSessionAssignments,
  listSessionAssignmentsForPlayers: mocks.listSessionAssignmentsForPlayers,
  listSessionAssignmentsForSeries: mocks.listSessionAssignmentsForSeries,
  listSessionAttendanceRecordsForPlayer: mocks.listSessionAttendanceRecordsForPlayer,
  listSessionAttendanceRecordsForOccurrences: mocks.listSessionAttendanceRecordsForOccurrences,
  listSessionOccurrences: mocks.listSessionOccurrences,
  listSessionOccurrencesByIds: mocks.listSessionOccurrencesByIds,
  listSessionOccurrencesForSeries: mocks.listSessionOccurrencesForSeries,
  listSessionSeries: mocks.listSessionSeries,
}))

import {
  getCoachAttendanceAdjustmentsSnapshot,
  getCoachAttendanceRecorderSnapshot,
  getCoachAttendanceRegisterSnapshot,
  getCoachCalendarMonthSnapshot,
  getCoachReportWritingSnapshot,
  getCoachScheduleMutationSnapshot,
  getCoachScheduleRosterSnapshot,
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
    mocks.listSessionAssignments.mockReturnValue([assignment])
    mocks.listSessionAssignmentsForPlayers.mockReturnValue([assignment])
    mocks.listSessionOccurrences.mockReturnValue([occurrence])
    mocks.listSessionOccurrencesForSeries.mockReturnValue([occurrence])
    mocks.listSessionAssignmentsForSeries.mockReturnValue([assignment])
    mocks.listSessionAttendanceRecordsForOccurrences.mockReturnValue({})
    mocks.listSessionAttendanceRecordsForPlayer.mockReturnValue({})
    mocks.listSessionOccurrencesByIds.mockReturnValue([occurrence])
    mocks.listAttendanceAdjustments.mockReturnValue([])
    mocks.listCoachMonthlyReports.mockReturnValue([])
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

  it("loads the attendance recorder for one exact day and its occurrence roster", () => {
    const snapshot = getCoachAttendanceRecorderSnapshot("2026-08-03")

    expect(mocks.listSessionOccurrences).toHaveBeenCalledWith("2026-08-03", "2026-08-03")
    expect(mocks.listSessionAttendanceRecordsForOccurrences).toHaveBeenCalledWith(["occurrence-1"])
    expect(mocks.listAttendanceAdjustments).toHaveBeenCalledWith({
      includeVoided: true,
      sourceOccurrenceIds: ["occurrence-1"],
    })
    expect(mocks.listOperationalPlayerRecords).toHaveBeenCalledWith(["player-1"])
    expect(snapshot.sessionOccurrences).toEqual([occurrence])
  })

  it("loads report writing data for one exact month", () => {
    getCoachReportWritingSnapshot("2026-08")

    expect(mocks.listSessionOccurrences).toHaveBeenCalledWith("2026-08-01", "2026-08-31")
    expect(mocks.listSessionAttendanceRecordsForOccurrences).toHaveBeenCalledWith(["occurrence-1"])
    expect(mocks.listCoachMonthlyReports).toHaveBeenCalledWith("2026-08")
    expect(mocks.listAttendanceAdjustments).toHaveBeenCalledWith({
      includeVoided: true,
      sourceOccurrenceIds: ["occurrence-1"],
    })
  })

  it("loads adjustment attendance and assignments for only the selected player", () => {
    mocks.listSessionAttendanceRecordsForPlayer.mockReturnValue({
      "occurrence-1": { "player-1": "absent" },
    })

    const snapshot = getCoachAttendanceAdjustmentsSnapshot({ playerId: "player-1" })

    expect(mocks.listSessionAttendanceRecordsForPlayer).toHaveBeenCalledWith("player-1")
    expect(mocks.listSessionAssignmentsForPlayers).toHaveBeenCalledWith(["player-1"])
    expect(mocks.listSessionOccurrencesByIds).toHaveBeenCalledWith(["occurrence-1"])
    expect(snapshot.selectedPlayerId).toBe("player-1")
  })

  it("serializes only compact past-occurrence keys for schedule backfill confirmation", () => {
    const snapshot = getCoachScheduleRosterSnapshot(
      "2026-08-03",
      new Date("2026-08-03T00:31:00.000Z"),
    )

    expect(mocks.listSessionOccurrences).toHaveBeenCalledWith("2026-01-01", "2026-08-03")
    expect(snapshot.backfillOccurrences).toEqual([{
      eligibilityDate: "2026-08-03",
      seriesId: "beginner-weekday",
    }])
    expect(snapshot.backfillOccurrences[0]).not.toHaveProperty("startsAt")
  })

  it("does not reload occurrences after a schedule mutation", () => {
    const snapshot = getCoachScheduleMutationSnapshot()

    expect(mocks.listSessionOccurrences).not.toHaveBeenCalled()
    expect(snapshot.sessionOccurrences).toEqual([])
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
