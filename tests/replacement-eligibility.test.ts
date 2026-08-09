import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-replacement-eligibility-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("cross-weekday replacement eligibility", () => {
  let adjustments: typeof import("@/lib/attendance/adjustments")
  let attendanceDatabase: typeof import("@/lib/attendance/database")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let recordingWorkspace: typeof import("@/lib/attendance/recording-workspace")
  let reports: typeof import("@/lib/reports/service")
  let schema: typeof import("@/lib/db/schema")
  let sessionDatabase: typeof import("@/lib/sessions/database")
  let sessionService: typeof import("@/lib/sessions/service")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const seriesId = "replacement-weekend-series"
  const rootOccurrenceId = "replacement-root-saturday"
  const middleOccurrenceId = "replacement-middle-wednesday"
  const finalOccurrenceId = "replacement-final-thursday"
  const sourcePlayerId = "replacement-source-player"
  const endedPlayerId = "replacement-ended-player"
  const joinedLaterPlayerId = "replacement-joined-later-player"
  const targetDayPlayerId = "replacement-target-day-player"
  const setupNow = new Date("2026-08-20T12:00:00+05:30")

  beforeAll(async () => {
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    adjustments = await import("@/lib/attendance/adjustments")
    attendanceDatabase = await import("@/lib/attendance/database")
    recordingWorkspace = await import("@/lib/attendance/recording-workspace")
    reports = await import("@/lib/reports/service")
    sessionDatabase = await import("@/lib/sessions/database")
    sessionService = await import("@/lib/sessions/service")
    database = client.initializeDatabase()

    database.insert(schema.sessionSeries).values([
      {
        id: seriesId,
        title: "Adult weekend replacement",
        programme: "Adult",
        batch: "Weekend",
        venue: "SMBA Court",
        startsOn: "2026-07-01",
        endsOn: "2026-08-31",
        status: "active",
        createdByAccountId: coachId,
        createdAt: setupNow,
      },
      {
        id: "replacement-completion-series",
        title: "Academy completion session",
        programme: "Adult",
        batch: "Weekend",
        venue: "SMBA Court",
        startsOn: "2026-08-15",
        endsOn: "2026-08-15",
        status: "ended",
        createdByAccountId: coachId,
        createdAt: setupNow,
      },
    ]).run()
    database.insert(schema.sessionOccurrences).values([
      {
        id: rootOccurrenceId,
        seriesId,
        occurrenceDate: "2026-07-25",
        startsAt: new Date("2026-07-25T06:00:00+05:30"),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "cancelled",
        createdAt: setupNow,
      },
      {
        id: middleOccurrenceId,
        seriesId,
        occurrenceDate: "2026-08-05",
        startsAt: new Date("2026-08-05T06:00:00+05:30"),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "cancelled",
        replacementForOccurrenceId: rootOccurrenceId,
        createdAt: setupNow,
      },
      {
        id: finalOccurrenceId,
        seriesId,
        occurrenceDate: "2026-08-06",
        startsAt: new Date("2026-08-06T06:00:00+05:30"),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled",
        replacementForOccurrenceId: middleOccurrenceId,
        createdAt: setupNow,
      },
      {
        id: "replacement-completion-occurrence",
        seriesId: "replacement-completion-series",
        occurrenceDate: "2026-08-15",
        startsAt: new Date("2026-08-15T06:00:00+05:30"),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled",
        createdAt: setupNow,
      },
    ]).run()

    const players = [
      {
        id: sourcePlayerId,
        joinedAt: "2026-07-01",
        weekday: 6,
        effectiveTo: null,
      },
      {
        id: endedPlayerId,
        joinedAt: "2026-07-01",
        weekday: 6,
        effectiveTo: "2026-08-01",
      },
      {
        id: joinedLaterPlayerId,
        joinedAt: "2026-08-01",
        weekday: 6,
        effectiveTo: null,
      },
      {
        id: targetDayPlayerId,
        joinedAt: "2026-07-01",
        weekday: 4,
        effectiveTo: null,
      },
    ]
    players.forEach((player) => {
      database.insert(schema.accounts).values({
        id: player.id,
        fullName: player.id,
        normalizedName: player.id,
        requestedRole: "player",
        role: "player",
        approvalStatus: "approved",
        approvedAt: setupNow,
        createdAt: setupNow,
        updatedAt: setupNow,
      }).run()
      database.insert(schema.playerEnrollments).values({
        accountId: player.id,
        level: "Adult",
        batch: "Weekend",
        academyPlan: "weekend-standard",
        status: "active",
        joinedAt: new Date(`${player.joinedAt}T00:00:00+05:30`),
        updatedAt: setupNow,
      }).run()
      const assignmentId = `${player.id}-assignment`
      database.insert(schema.sessionAssignments).values({
        id: assignmentId,
        accountId: player.id,
        seriesId,
        effectiveFrom: "2026-07-01",
        effectiveTo: player.effectiveTo,
        assignedByAccountId: coachId,
        assignedAt: setupNow,
      }).run()
      database.insert(schema.sessionAssignmentWeekdays).values({
        id: `${assignmentId}-weekday`,
        assignmentId,
        weekday: player.weekday,
      }).run()
    })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("uses the root roster across weekday, month and assignment boundaries", () => {
    const final = sessionDatabase.listSessionOccurrences("2026-08-06", "2026-08-06")
      .find((occurrence) => occurrence.id === finalOccurrenceId)
    if (!final) throw new Error("Final replacement was not returned.")
    expect(final).toMatchObject({
      occurrenceDate: "2026-08-06",
      eligibilityDate: "2026-07-25",
    })

    const eligiblePlayerIds = recordingWorkspace.eligiblePlayerIdsForOccurrence({
      assignments: sessionDatabase.listSessionAssignments(),
      occurrence: final,
      players: [
        { id: sourcePlayerId, joinedOn: "2026-07-01" },
        { id: endedPlayerId, joinedOn: "2026-07-01" },
        { id: joinedLaterPlayerId, joinedOn: "2026-08-01" },
        { id: targetDayPlayerId, joinedOn: "2026-07-01" },
      ],
    })
    expect(eligiblePlayerIds).toEqual([sourcePlayerId, endedPlayerId])
  })

  it("enforces root eligibility atomically when saving replacement attendance", () => {
    expect(() => sessionService.saveSessionAttendanceRecords({
      database,
      coachId,
      now: setupNow,
      referenceDate: "2026-08-20",
      changes: [
        { playerId: sourcePlayerId, occurrenceId: finalOccurrenceId, choice: "present" },
        { playerId: targetDayPlayerId, occurrenceId: finalOccurrenceId, choice: "present" },
      ],
    })).toThrow("assigned")
    expect(database.select().from(schema.sessionAttendanceRecords).where(and(
      eq(schema.sessionAttendanceRecords.accountId, sourcePlayerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, finalOccurrenceId),
    )).get()).toBeUndefined()

    sessionService.saveSessionAttendanceRecords({
      database,
      coachId,
      now: setupNow,
      referenceDate: "2026-08-20",
      changes: [
        { playerId: sourcePlayerId, occurrenceId: finalOccurrenceId, choice: "present" },
        { playerId: endedPlayerId, occurrenceId: finalOccurrenceId, choice: "present" },
      ],
    })
    expect(() => sessionService.saveSessionAttendanceRecords({
      database,
      coachId,
      now: setupNow,
      referenceDate: "2026-08-20",
      changes: [
        { playerId: joinedLaterPlayerId, occurrenceId: finalOccurrenceId, choice: "present" },
      ],
    })).toThrow("enrolled")
  })

  it("counts and publishes the replacement only in its actual month", () => {
    expect(attendanceDatabase.calculatePlayerAttendanceForMonth(
      sourcePlayerId,
      "2026-07",
      "2026-07-31",
      "2026-07-31T23:59:59+05:30",
    )).toMatchObject({ eligible: 0, attended: 0 })
    expect(attendanceDatabase.calculatePlayerAttendanceForMonth(
      sourcePlayerId,
      "2026-08",
      "2026-08-31",
      "2026-08-31T23:59:59+05:30",
    )).toMatchObject({ eligible: 1, recorded: 1, attended: 1 })
    expect(attendanceDatabase.calculatePlayerAttendanceForMonth(
      endedPlayerId,
      "2026-08",
      "2026-08-31",
      "2026-08-31T23:59:59+05:30",
    )).toMatchObject({ eligible: 1, attended: 1 })
    expect(attendanceDatabase.calculatePlayerAttendanceForMonth(
      targetDayPlayerId,
      "2026-08",
      "2026-08-31",
      "2026-08-31T23:59:59+05:30",
    )).toMatchObject({ eligible: 0, attended: 0 })

    const publication = reports.publishMonthlyReport({
      month: "2026-08",
      playerId: sourcePlayerId,
      publicationKey: "77777777-7777-4777-8777-777777777777",
      reportText: "Replacement attendance remains part of August training.",
    }, {
      coachId,
      database,
      now: new Date("2026-09-02T12:00:00+05:30"),
    })
    if (!publication.publicationId) throw new Error("Report publication was not created.")
    const snapshot = database.select({ attendanceSnapshot: schema.reportPublications.attendanceSnapshot })
      .from(schema.reportPublications)
      .where(eq(schema.reportPublications.id, publication.publicationId)).get()?.attendanceSnapshot
    expect(JSON.parse(snapshot ?? "null")).toMatchObject({
      month: "2026-08",
      eligible: 1,
      recorded: 1,
      attended: 1,
    })
  })

  it("uses root eligibility but the actual replacement date for rescheduling", () => {
    sessionService.saveSessionAttendanceRecords({
      database,
      coachId,
      now: setupNow,
      referenceDate: "2026-08-20",
      changes: [
        { playerId: sourcePlayerId, occurrenceId: finalOccurrenceId, choice: "absent" },
      ],
    })
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      completedOn: "2026-08-15",
      database,
      now: setupNow,
      playerId: sourcePlayerId,
      reason: "Replacement recovery",
      sourceOccurrenceId: finalOccurrenceId,
    })
    expect(published).toMatchObject({
      playerId: sourcePlayerId,
      sourceOccurrenceId: finalOccurrenceId,
      completedOn: "2026-08-15",
    })
  })
})
