import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-db-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("shared academy session workflow", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-02T04:30:00.000Z"))
    accountService = await import("@/lib/auth/account-service")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("seeds the initial approved coach with the first human-friendly Academy ID", () => {
    expect(accountService.findApprovedAccountByAcademyId("smba#0001")).toMatchObject({
      academyId: "SMBA#0001",
      fullName: "Sathiya Moorthy",
      role: "coach",
    })
  })

  it("keeps approval separate and synchronizes occurrence attendance after assignment", async () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    const firstId = accountService.registerAccount("Mira Rao", "player")
    const secondId = accountService.registerAccount("Mira Rao", "player")
    const first = accountService.approveRegistration(firstId, coach.accountId, {
      chooseAcademyIdIndex: () => 0,
    })
    const second = accountService.approveRegistration(secondId, coach.accountId, {
      chooseAcademyIdIndex: () => 0,
    })
    expect(first.academyId).toBe("SMBA#0002")
    expect(second.academyId).toBe("SMBA#0003")
    expect(database.select().from(schema.authAccessCodes)
      .where(eq(schema.authAccessCodes.purpose, "activation")).all()).toHaveLength(0)
    expect(database.select().from(schema.authCredentialStates)
      .where(eq(schema.authCredentialStates.accountId, firstId)).get()?.status).toBe("pending")

    const now = new Date()
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit", month: "2-digit", timeZone: "Asia/Kolkata", year: "numeric",
    }).formatToParts(now)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
    const todayKey = `${part("year")}-${part("month")}-${part("day")}`
    const joined = new Date(`${todayKey}T00:00:00.000Z`)
    joined.setUTCDate(joined.getUTCDate() - 7)
    const joinedOn = joined.toISOString().slice(0, 10)
    database.update(schema.playerEnrollments).set({
      joinedAt: joined,
      batch: "Weekend",
      level: "Beginner",
      academyPlan: "weekend-standard",
      status: "unassigned",
      updatedAt: now,
    }).where(eq(schema.playerEnrollments.accountId, firstId)).run()

    const {
      assignSessionRecords,
      createSessionSeriesRecords,
      replaceSessionOccurrence,
      saveSessionAttendanceRecords,
    } = await import("@/lib/sessions/service")
    const weekday = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay()
    const batch = weekday === 0 || weekday === 6 ? "Weekend" as const : "Weekday" as const
    database.update(schema.playerEnrollments).set({
      batch,
      academyPlan: batch === "Weekday" ? "weekday-3-day" : "weekend-standard",
    }).where(
      eq(schema.playerEnrollments.accountId, firstId),
    ).run()
    const future = new Date(`${todayKey}T00:00:00.000Z`)
    future.setUTCDate(future.getUTCDate() + 14)
    const seriesId = createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch,
        venue: "SMBA Court",
        startsOn: joinedOn,
        endsOn: future.toISOString().slice(0, 10),
        weekdays: [weekday],
        startTime: "06:00",
        durationMinutes: 60,
      },
    })
    const secondSeriesId = createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch,
        venue: "SMBA Court",
        startsOn: joinedOn,
        endsOn: future.toISOString().slice(0, 10),
        weekdays: [weekday],
        startTime: "07:00",
        durationMinutes: 60,
      },
    })
    const laterTodaySeriesId = createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch,
        venue: "SMBA Court",
        startsOn: joinedOn,
        endsOn: future.toISOString().slice(0, 10),
        weekdays: [weekday],
        startTime: "11:00",
        durationMinutes: 60,
      },
    })
    expect(database.select().from(schema.sessionAssignments).all()).toHaveLength(0)
    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: firstId,
      seriesId,
      weekdays: [weekday],
    })
    expect(database.select().from(schema.sessionAssignmentWeekdays).all()).toHaveLength(1)
    expect(() => assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: firstId,
      seriesId,
      weekdays: [0, 1, 2, 3, 4, 5],
    })).toThrow("Academy Plan")
    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: firstId,
      seriesId: secondSeriesId,
      weekdays: [weekday],
    })
    expect(database.select().from(schema.sessionAssignmentWeekdays).all()).toHaveLength(2)
    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: firstId,
      seriesId: laterTodaySeriesId,
      weekdays: [weekday],
    })
    expect(database.select().from(schema.sessionAssignmentWeekdays).all()).toHaveLength(3)
    database.update(schema.playerEnrollments).set({
      batch: batch === "Weekday" ? "Weekend" : "Weekday",
      level: "Beginner",
      academyPlan: batch === "Weekday" ? "weekend-standard" : "weekday-3-day",
    }).where(eq(schema.playerEnrollments.accountId, secondId)).run()
    expect(() => assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: secondId,
      seriesId,
      weekdays: [weekday],
    })).toThrow("batch")

    expect(() => createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch,
        venue: "SMBA Court",
        startsOn: joinedOn,
        endsOn: future.toISOString().slice(0, 10),
        weekdays: [weekday],
        startTime: "06:30",
        durationMinutes: 60,
      },
    })).toThrow("time slot")
    const overlappingSeriesId = "legacy-overlapping-series"
    database.insert(schema.sessionSeries).values({
      id: overlappingSeriesId,
      batch,
      createdAt: now,
      createdByAccountId: coach.accountId,
      endsOn: future.toISOString().slice(0, 10),
      programme: "Beginner",
      startsOn: joinedOn,
      status: "active",
      title: "Legacy overlapping schedule",
      venue: "SMBA Court",
    }).run()
    database.insert(schema.sessionRecurrenceRules).values({
      id: "legacy-overlapping-rule",
      durationMinutes: 60,
      seriesId: overlappingSeriesId,
      startTime: "06:30",
      weekday,
    }).run()
    expect(() => assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: firstId,
      seriesId: overlappingSeriesId,
      weekdays: [weekday],
    })).toThrow("overlaps")
    expect(() => assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: joinedOn,
      now,
      playerId: firstId,
      seriesId: "missing-series",
      weekdays: [weekday],
    })).toThrow("unavailable")

    const occurrences = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).all()
    const secondOccurrences = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, secondSeriesId)).all()
    const laterTodayOccurrences = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, laterTodaySeriesId)).all()
    const todayOccurrence = occurrences.find((item) => item.occurrenceDate === todayKey)
    const secondTodayOccurrence = secondOccurrences.find((item) => item.occurrenceDate === todayKey)
    const laterTodayOccurrence = laterTodayOccurrences.find((item) => item.occurrenceDate === todayKey)
    const futureOccurrence = occurrences.find((item) => item.occurrenceDate > todayKey)
    if (!todayOccurrence || !secondTodayOccurrence || !laterTodayOccurrence || !futureOccurrence) {
      throw new Error("Expected occurrences were not generated.")
    }
    saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now,
      changes: [
        { playerId: firstId, occurrenceId: todayOccurrence.id, choice: "present", expectedChoice: "cleared" },
        { playerId: firstId, occurrenceId: secondTodayOccurrence.id, choice: "present", expectedChoice: "cleared" },
      ],
    })

    database.insert(schema.monthlyReports).values({
      id: "report-one",
      accountId: firstId,
      month: "2026-07",
      draftText: "Published coach feedback.",
      updatedByAccountId: coach.accountId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.reportPublications).values({
      id: "publication-one",
      reportId: "report-one",
      revision: 1,
      reportText: "Published coach feedback.",
      attendanceSnapshot: JSON.stringify({
        version: 1,
        month: "2026-07",
        referenceDate: "2026-08-02",
        eligible: 4,
        recorded: 3,
        attended: 2,
        absent: 1,
        pending: 1,
        percentage: 67,
      }),
      publishedByAccountId: coach.accountId,
      publishedAt: now,
    }).run()

    const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")
    const { listApprovedPlayerRecords } = await import("@/lib/coach/database")
    const dashboard = await new SqlitePortalRepository().getDashboard(firstId)
    expect(dashboard?.attendance).toMatchObject({ eligible: 2, attended: 2, recorded: 2, percentage: 100 })
    expect(dashboard?.latestReport).toEqual({ monthLabel: "July 2026" })
    expect(dashboard?.attendanceRecord.assignments).toHaveLength(3)
    expect(dashboard?.attendanceRecord.records).toEqual(expect.arrayContaining([
      { occurrenceId: todayOccurrence.id, choice: "present" },
      { occurrenceId: secondTodayOccurrence.id, choice: "present" },
    ]))
    const expectedSeriesIds: string[] = [seriesId, secondSeriesId, laterTodaySeriesId]
    expect(dashboard?.attendanceRecord.occurrences.every((occurrence) => (
      expectedSeriesIds.includes(occurrence.seriesId)
    ))).toBe(true)
    expect((await new SqlitePortalRepository().getDashboard(secondId))?.attendanceRecord)
      .toMatchObject({ assignments: [], occurrences: [], records: [] })
    const trainingProfile = listApprovedPlayerRecords().trainingProfiles.find((profile) => profile.memberId === firstId)
    expect(trainingProfile).toMatchObject({ batch, level: "Beginner", status: "active" })
    expect(trainingProfile?.activeSessionIds).toEqual(expect.arrayContaining([
      seriesId,
      secondSeriesId,
      laterTodaySeriesId,
    ]))

    const originalAttendance = database.select().from(schema.sessionAttendanceRecords)
      .where(and(
        eq(schema.sessionAttendanceRecords.accountId, firstId),
        eq(schema.sessionAttendanceRecords.occurrenceId, todayOccurrence.id),
      )).get()
    expect(saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now: new Date(now.getTime() + 60_000),
      changes: [{
        playerId: firstId,
        occurrenceId: todayOccurrence.id,
        choice: "present",
        expectedChoice: "cleared",
      }],
    })).toEqual({ applied: 0 })
    expect(database.select().from(schema.sessionAttendanceRecords)
      .where(and(
        eq(schema.sessionAttendanceRecords.accountId, firstId),
        eq(schema.sessionAttendanceRecords.occurrenceId, todayOccurrence.id),
      )).get()?.updatedAt).toEqual(originalAttendance?.updatedAt)
    expect(() => saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now,
      changes: [{
        playerId: firstId,
        occurrenceId: todayOccurrence.id,
        choice: "absent",
        expectedChoice: "cleared",
      }],
    })).toThrow("changed since this page was opened")
    expect(() => saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now,
      changes: [{
        playerId: firstId,
        occurrenceId: todayOccurrence.id,
        choice: "late" as never,
        expectedChoice: "present",
      }],
    })).toThrow("valid attendance result")

    expect(() => saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now,
      changes: [
        { playerId: firstId, occurrenceId: todayOccurrence.id, choice: "absent", expectedChoice: "present" },
        { playerId: firstId, occurrenceId: laterTodayOccurrence.id, choice: "present", expectedChoice: "cleared" },
      ],
    })).toThrow("future session")
    expect(database.select({ choice: schema.sessionAttendanceRecords.choice })
      .from(schema.sessionAttendanceRecords)
      .where(eq(schema.sessionAttendanceRecords.occurrenceId, todayOccurrence.id))
      .get()?.choice).toBe("present")

    saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now: new Date(`${todayKey}T11:00:00+05:30`),
      changes: [
        { playerId: firstId, occurrenceId: laterTodayOccurrence.id, choice: "present", expectedChoice: "cleared" },
      ],
    })
    expect((await new SqlitePortalRepository().getDashboard(firstId))?.attendance)
      .toMatchObject({ eligible: 2, recorded: 2, attended: 2 })

    expect(() => saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now,
      changes: [
        { playerId: firstId, occurrenceId: todayOccurrence.id, choice: "absent", expectedChoice: "present" },
        { playerId: firstId, occurrenceId: futureOccurrence.id, choice: "present", expectedChoice: "cleared" },
      ],
    })).toThrow("future session")
    expect(database.select({ choice: schema.sessionAttendanceRecords.choice })
      .from(schema.sessionAttendanceRecords)
      .where(eq(schema.sessionAttendanceRecords.occurrenceId, todayOccurrence.id))
      .get()?.choice).toBe("present")

    replaceSessionOccurrence({
      coachId: coach.accountId,
      database,
      occurrenceId: futureOccurrence.id,
      dateKey: futureOccurrence.occurrenceDate,
      startTime: "12:00",
      durationMinutes: 75,
      venue: "SMBA Court 2",
      referenceDate: todayKey,
      now,
    })
    const rescheduled = database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.seriesId, seriesId),
      eq(schema.sessionOccurrences.occurrenceDate, futureOccurrence.occurrenceDate),
    )).all()
    expect(rescheduled).toHaveLength(2)
    expect(rescheduled.find((occurrence) => occurrence.id === futureOccurrence.id)?.status).toBe("cancelled")
    expect(rescheduled.find((occurrence) => occurrence.status === "scheduled")).toMatchObject({
      replacementForOccurrenceId: futureOccurrence.id,
      durationMinutes: 75,
      venue: "SMBA Court 2",
    })

    database.update(schema.accounts).set({ archivedAt: now })
      .where(eq(schema.accounts.id, firstId)).run()
    expect(() => saveSessionAttendanceRecords({
      database,
      coachId: coach.accountId,
      referenceDate: todayKey,
      now,
      changes: [{
        playerId: firstId,
        occurrenceId: todayOccurrence.id,
        choice: "absent",
        expectedChoice: "present",
      }],
    })).toThrow("selected player is unavailable")
    expect(database.select({ choice: schema.sessionAttendanceRecords.choice })
      .from(schema.sessionAttendanceRecords).where(and(
        eq(schema.sessionAttendanceRecords.accountId, firstId),
        eq(schema.sessionAttendanceRecords.occurrenceId, todayOccurrence.id),
      )).get()?.choice).toBe("present")
  })

  it("enforces exact distinct weekdays across active Weekday assignments", async () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    const {
      assignSessionRecords,
      createSessionSeriesRecords,
      endSessionAssignment,
    } = await import("@/lib/sessions/service")
    const now = new Date("2026-08-02T04:30:00.000Z")
    const startsOn = "2026-08-03"
    const endsOn = "2026-09-30"
    const cases = [
      {
        exactDays: [1, 3, 5],
        level: "Beginner" as const,
        name: "Three Day Player",
        plan: "weekday-3-day" as const,
        startTime: "13:00",
      },
      {
        exactDays: [1, 2, 4, 5],
        level: "Intermediate" as const,
        name: "Four Day Player",
        plan: "weekday-4-day" as const,
        startTime: "14:00",
      },
      {
        exactDays: [1, 2, 3, 4, 5],
        level: "Advanced" as const,
        name: "Five Day Player",
        plan: "weekday-5-day" as const,
        startTime: "15:00",
      },
    ]
    const playerIds: string[] = []
    const seriesIds: string[] = []

    for (const fixture of cases) {
      const playerId = accountService.registerAccount(fixture.name, "player")
      accountService.approveRegistration(playerId, coach.accountId)
      database.update(schema.playerEnrollments).set({
        academyPlan: fixture.plan,
        batch: "Weekday",
        joinedAt: new Date(`${startsOn}T00:00:00.000Z`),
        level: fixture.level,
        status: "unassigned",
        updatedAt: now,
      }).where(eq(schema.playerEnrollments.accountId, playerId)).run()
      const seriesId = createSessionSeriesRecords({
        coachId: coach.accountId,
        database,
        now,
        input: {
          batch: "Weekday",
          durationMinutes: 60,
          endsOn,
          programme: fixture.level,
          startTime: fixture.startTime,
          startsOn,
          venue: "SMBA Court",
          weekdays: [1, 2, 3, 4, 5],
        },
      })

      expect(() => assignSessionRecords({
        coachId: coach.accountId,
        database,
        effectiveFrom: startsOn,
        now,
        playerId,
        seriesId,
        weekdays: fixture.exactDays.slice(0, -1),
      })).toThrow(`exactly ${fixture.exactDays.length}`)
      expect(database.select().from(schema.sessionAssignments).all()
        .filter((assignment) => assignment.accountId === playerId)).toHaveLength(0)

      assignSessionRecords({
        coachId: coach.accountId,
        database,
        effectiveFrom: startsOn,
        now,
        playerId,
        seriesId,
        weekdays: fixture.exactDays,
      })
      const assignment = database.select().from(schema.sessionAssignments).all()
        .find((item) => item.accountId === playerId && item.seriesId === seriesId)
      expect(assignment).toBeDefined()
      expect(database.select().from(schema.sessionAssignmentWeekdays).all()
        .filter((weekday) => weekday.assignmentId === assignment?.id)
        .map((weekday) => weekday.weekday)
        .sort()).toEqual(fixture.exactDays)
      playerIds.push(playerId)
      seriesIds.push(seriesId)
    }

    const [threeDayPlayerId] = playerIds
    const secondSeriesId = createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        batch: "Weekday",
        durationMinutes: 60,
        endsOn,
        programme: "Beginner",
        startTime: "16:00",
        startsOn,
        venue: "SMBA Court",
        weekdays: [1, 2, 3, 4, 5],
      },
    })
    assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: startsOn,
      now,
      playerId: threeDayPlayerId,
      seriesId: secondSeriesId,
      weekdays: [1, 3],
    })
    const thirdSeriesId = createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        batch: "Weekday",
        durationMinutes: 60,
        endsOn,
        programme: "Beginner",
        startTime: "17:00",
        startsOn,
        venue: "SMBA Court",
        weekdays: [1, 2, 3, 4, 5],
      },
    })
    expect(() => assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: startsOn,
      now,
      playerId: threeDayPlayerId,
      seriesId: thirdSeriesId,
      weekdays: [2],
    })).toThrow("exactly 3")

    const secondAssignment = database.select().from(schema.sessionAssignments).all()
      .find((assignment) => assignment.accountId === threeDayPlayerId
        && assignment.seriesId === secondSeriesId)
    if (!secondAssignment) throw new Error("Expected the second active assignment.")
    const firstAssignment = database.select().from(schema.sessionAssignments).all()
      .find((assignment) => assignment.accountId === threeDayPlayerId
        && assignment.seriesId === seriesIds[0])
    if (!firstAssignment) throw new Error("Expected the first active assignment.")
    expect(() => endSessionAssignment({
      assignmentId: firstAssignment.id,
      coachId: coach.accountId,
      database,
      effectiveTo: "2026-08-10",
      now,
    })).toThrow("cannot be in the future")
    const assignmentEndNow = new Date("2026-08-10T06:00:00+05:30")
    expect(() => endSessionAssignment({
      assignmentId: firstAssignment.id,
      coachId: coach.accountId,
      database,
      effectiveTo: "2026-08-10",
      now: assignmentEndNow,
    })).toThrow("exactly 3")
    endSessionAssignment({
      assignmentId: secondAssignment.id,
      coachId: coach.accountId,
      database,
      effectiveTo: "2026-08-10",
      now: assignmentEndNow,
    })
    endSessionAssignment({
      assignmentId: firstAssignment.id,
      coachId: coach.accountId,
      database,
      effectiveTo: "2026-08-10",
      now: assignmentEndNow,
    })
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, threeDayPlayerId)).get()?.status).toBe("paused")
  })
})
