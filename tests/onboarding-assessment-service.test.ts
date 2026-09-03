import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-onboarding-assessment-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "assessment.db")

describe("coach-confirmed onboarding assessment", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let attendanceDomain: typeof import("@/lib/attendance/domain")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let onboardingService: typeof import("@/lib/coach/onboarding-service")
  let playerRecord: typeof import("@/lib/attendance/player-record")
  let schema: typeof import("@/lib/db/schema")
  let sessionsService: typeof import("@/lib/sessions/service")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-18T10:00:00+05:30")
  let nextId = 0
  const id = (prefix: string) => `${prefix}-${String(nextId += 1).padStart(4, "0")}`

  function approvedPlayer(name: string) {
    const playerId = accountService.registerAccount(name, "player")
    accountService.approveRegistration(playerId, coachId, { now })
    return playerId
  }

  function assessment(playerId: string, expectedRevision: number, trainingStartOn: string) {
    return onboardingService.saveOnboardingAssessment({
      coachId,
      database,
      input: {
        academyPlan: "weekday-3-day",
        batch: "Weekday",
        expectedRevision,
        level: "Beginner",
        playerId,
        trainingStartOn,
      },
      now,
    })
  }

  function assignment(playerId: string, effectiveFrom: string) {
    const seriesId = id("series")
    const assignmentId = id("assignment")
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      batch: "Weekday",
      createdAt: now,
      createdByAccountId: coachId,
      programme: "Beginner",
      startsOn: "2026-07-01",
      status: "active",
      title: "Assessment test series",
      venue: "SMBA Court",
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      assignedAt: now,
      assignedByAccountId: coachId,
      effectiveFrom,
      effectiveTo: null,
      seriesId,
    }).run()
    database.insert(schema.sessionRecurrenceRules).values({
      id: id("recurrence"),
      seriesId,
      weekday: 1,
      startTime: "18:00",
      durationMinutes: 90,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: id("weekday"),
      assignmentId,
      weekday: 1,
    }).run()
    return { assignmentId, seriesId }
  }

  function occurrence(seriesId: string, occurrenceDate: string) {
    const occurrenceId = id("occurrence")
    database.insert(schema.sessionOccurrences).values({
      id: occurrenceId,
      seriesId,
      occurrenceDate,
      startsAt: new Date(`${occurrenceDate}T18:00:00+05:30`),
      durationMinutes: 90,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    return occurrenceId
  }

  function markAttendance(
    playerId: string,
    occurrenceId: string,
    choice: "absent" | "present",
  ) {
    database.insert(schema.sessionAttendanceRecords).values({
      id: id("attendance"),
      accountId: playerId,
      occurrenceId,
      choice,
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  /* What the player's own July calendar counts, off the real read model. */
  function julyAttendance(playerId: string) {
    const record = playerRecord.getPlayerAttendanceRecord(playerId, now)
    if (!record) throw new Error("Expected an attendance record for the player.")
    return attendanceDomain.calculateMonthlyAttendance({
      assignments: record.assignments,
      joinedOn: record.joinedOn,
      month: "2026-07",
      occurrences: record.occurrences,
      records: record.records,
      referenceDate: record.referenceDate,
    })
  }

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    attendanceDomain = await import("@/lib/attendance/domain")
    onboardingService = await import("@/lib/coach/onboarding-service")
    playerRecord = await import("@/lib/attendance/player-record")
    schema = await import("@/lib/db/schema")
    sessionsService = await import("@/lib/sessions/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("accepts a coach-confirmed date before registration and permits a future start", () => {
    const backdatedId = approvedPlayer("Backdated Assessment")
    expect(assessment(backdatedId, 0, "2026-06-10")).toEqual({
      playerId: backdatedId,
      recordRevision: 1,
      trainingStartOn: "2026-06-10",
    })
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, backdatedId)).get())
      .toMatchObject({
        trainingStartConfirmedAt: now,
        trainingStartConfirmedByAccountId: coachId,
        trainingStartOn: "2026-06-10",
      })

    const futureId = approvedPlayer("Future Assessment")
    expect(assessment(futureId, 0, "2026-09-01")).toMatchObject({
      trainingStartOn: "2026-09-01",
    })
  })

  it("refuses a confirmed date beyond the backfill window", () => {
    const playerId = approvedPlayer("Implausible Assessment")

    expect(() => assessment(playerId, 0, "2023-08-18")).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "trainingStartOn",
    }))
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({ recordRevision: 0, trainingStartConfirmedAt: null })
    expect(assessment(playerId, 0, "2024-09-02")).toMatchObject({
      trainingStartOn: "2024-09-02",
    })
  })

  it("requires an unfinished assignment reset before moving the date later", () => {
    const playerId = approvedPlayer("Reset Assignment")
    assessment(playerId, 0, "2026-07-01")
    assignment(playerId, "2026-07-15")

    expect(() => assessment(playerId, 1, "2026-08-01")).toThrow(expect.objectContaining({
      code: "BUSINESS_RULE",
      field: "trainingStartOn",
    }))
    expect(onboardingService.resetOnboardingSessionAssignment({
      coachId,
      database,
      playerId,
      now,
    })).toEqual({ playerId, removedAssignments: 1 })
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, playerId)).all()).toHaveLength(0)
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({
        recordRevision: 2,
        status: "unassigned",
        trainingStartConfirmedAt: null,
        trainingStartConfirmedByAccountId: null,
        trainingStartOn: "2026-07-01",
      })
    expect(assessment(playerId, 2, "2026-08-01")).toMatchObject({
      recordRevision: 3,
      trainingStartOn: "2026-08-01",
    })
  })

  it("refuses reset when academy records depend on the assignment", () => {
    const playerId = approvedPlayer("Dependent Assignment")
    assessment(playerId, 0, "2026-08-01")
    assignment(playerId, "2026-08-01")
    database.insert(schema.feeAgreements).values({
      id: id("agreement"),
      playerAccountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 350_000,
      currency: "INR",
      monthlyDueDay: 5,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      status: "active",
      recordRevision: 0,
      createdByAccountId: coachId,
      createdAt: now,
      updatedByAccountId: coachId,
      updatedAt: now,
    }).run()

    expect(() => onboardingService.resetOnboardingSessionAssignment({
      coachId,
      database,
      playerId,
      now,
    })).toThrow(expect.objectContaining({ code: "BUSINESS_RULE" }))
  })

  /*
   * Ending an assignment from the calendar is not resetting it: the row keeps its
   * effectiveFrom and the days it rostered, and any attendance already marked
   * against those days keeps counting. The guard above used to read only the open
   * assignments, so a player whose single assignment had been ended looked to it
   * like a player with no assignment at all, and the training start date was free
   * to move past days that already carried attendance. Nothing refused it and
   * nothing recorded it -- the rows simply stopped being eligible, because
   * eligibility is `eligibilityDate >= trainingStartOn`.
   */
  it("refuses to move the date past an ended assignment, keeping its attendance eligible", () => {
    const playerId = approvedPlayer("Ended Assignment")
    assessment(playerId, 0, "2026-07-01")
    const { assignmentId, seriesId } = assignment(playerId, "2026-07-01")
    markAttendance(playerId, occurrence(seriesId, "2026-07-06"), "present")
    markAttendance(playerId, occurrence(seriesId, "2026-07-13"), "absent")
    expect(julyAttendance(playerId)).toMatchObject({
      absent: 1,
      attended: 1,
      eligible: 2,
      percentage: 50,
      recorded: 2,
    })

    sessionsService.endSessionAssignment({
      assignmentId,
      coachId,
      database,
      effectiveTo: "2026-07-20",
      now,
    })
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.id, assignmentId)).get())
      .toMatchObject({ effectiveTo: "2026-07-20" })

    // Ending the assignment bumps the enrollment revision from 1 to 2.
    expect(() => assessment(playerId, 2, "2026-08-01")).toThrow(expect.objectContaining({
      code: "BUSINESS_RULE",
      field: "trainingStartOn",
    }))
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({ recordRevision: 2, trainingStartOn: "2026-07-01" })
    expect(julyAttendance(playerId)).toMatchObject({
      absent: 1,
      attended: 1,
      eligible: 2,
      percentage: 50,
      recorded: 2,
    })

    // Moving the date earlier is not what invalidates attendance, and stays open.
    expect(assessment(playerId, 2, "2026-06-15")).toMatchObject({
      recordRevision: 3,
      trainingStartOn: "2026-06-15",
    })
    expect(julyAttendance(playerId)).toMatchObject({ eligible: 2, recorded: 2 })
  })

  it("refuses to reclassify a player whose assignment has been ended", () => {
    const playerId = approvedPlayer("Ended Assignment Reclassification")
    assessment(playerId, 0, "2026-07-01")
    const { assignmentId } = assignment(playerId, "2026-07-01")
    sessionsService.endSessionAssignment({
      assignmentId,
      coachId,
      database,
      effectiveTo: "2026-07-20",
      now,
    })

    expect(() => onboardingService.saveOnboardingAssessment({
      coachId,
      database,
      input: {
        academyPlan: "weekday-5-day",
        batch: "Weekday",
        expectedRevision: 2,
        level: "Beginner",
        playerId,
        trainingStartOn: "2026-07-01",
      },
      now,
    })).toThrow(expect.objectContaining({
      code: "BUSINESS_RULE",
      field: "academyPlan",
    }))

    // The reset is still the way back, and it clears ended assignments too.
    expect(onboardingService.resetOnboardingSessionAssignment({
      coachId,
      database,
      playerId,
      now,
    })).toEqual({ playerId, removedAssignments: 1 })
    expect(assessment(playerId, 3, "2026-08-01")).toMatchObject({
      trainingStartOn: "2026-08-01",
    })
  })

  it("keeps the confirmed date immutable after completion", () => {
    const playerId = approvedPlayer("Completed Assessment")
    assessment(playerId, 0, "2026-08-01")
    database.update(schema.playerEnrollments).set({
      onboardingCompletedAt: now,
      onboardingCompletedByAccountId: coachId,
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()

    expect(() => assessment(playerId, 1, "2026-08-02")).toThrow(expect.objectContaining({
      code: "BUSINESS_RULE",
      field: "trainingStartOn",
    }))
  })
})
