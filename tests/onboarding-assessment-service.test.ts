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

  function assessment(playerId: string, expectedRevision: number) {
    return onboardingService.saveOnboardingAssessment({
      coachId,
      database,
      input: {
        academyPlan: "weekday-3-day",
        batch: "Weekday",
        expectedRevision,
        level: "Beginner",
        playerId,
      },
      now,
    })
  }

  /*
   * The training start date is chosen here now, with the schedule that bounds
   * it. `confirmTrainingStart` is what the onboarding Session step passes and
   * the Schedules screen does not.
   */
  function assignWithStart(playerId: string, seriesId: string, effectiveFrom: string) {
    return sessionsService.assignSessionRecords({
      coachId,
      confirmTrainingStart: true,
      database,
      effectiveFrom,
      now,
      playerId,
      seriesId,
      weekdays: [1, 2, 3],
    })
  }

  /* A schedule offering the three weekdays a weekday-3-day plan needs. */
  function series(startsOn: string, endsOn: string | null = null) {
    const seriesId = id("series")
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      batch: "Weekday",
      createdAt: now,
      createdByAccountId: coachId,
      endsOn,
      programme: "Beginner",
      startsOn,
      status: "active",
      title: "Assignment test series",
      venue: "SMBA Court",
    }).run()
    for (const weekday of [1, 2, 3]) {
      database.insert(schema.sessionRecurrenceRules).values({
        id: id("recurrence"),
        seriesId,
        weekday,
        startTime: "18:00",
        durationMinutes: 90,
      }).run()
    }
    return seriesId
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

  it("confirms the training start when the session is assigned, not at assessment", () => {
    /*
     * The date used to be typed on the Assessment step, where the schedule it has
     * to sit inside is not yet known -- so a coach could pick a day before the
     * sessions existed. It buys nothing (assignment, attendance and the fee
     * timeline are all floored at the schedule anyway) except a first monthly fee
     * dated before the player's first ever session.
     */
    const playerId = approvedPlayer("Assigned Start")
    expect(assessment(playerId, 0)).toEqual({ playerId, recordRevision: 1 })
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({ trainingStartConfirmedAt: null })

    assignWithStart(playerId, series("2026-07-01"), "2026-07-15")
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({
        trainingStartConfirmedAt: now,
        trainingStartConfirmedByAccountId: coachId,
        trainingStartOn: "2026-07-15",
      })
  })

  it("refuses a start before the schedule the player is joining", () => {
    const playerId = approvedPlayer("Early Start")
    assessment(playerId, 0)

    expect(() => assignWithStart(playerId, series("2026-07-01"), "2026-06-20"))
      .toThrow(expect.objectContaining({ code: "BUSINESS_RULE", field: "effectiveFrom" }))
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({ trainingStartConfirmedAt: null })
  })

  it("still refuses a start beyond the backfill window", () => {
    // The schedule bound makes this hard to reach in practice, but it is the rule
    // the rest of the codebase states and redateConfirmedTrainingStart enforces.
    const playerId = approvedPlayer("Implausible Start")
    assessment(playerId, 0)

    expect(() => assignWithStart(playerId, series("2023-01-01"), "2023-08-18"))
      .toThrow(expect.objectContaining({ code: "INVALID_INPUT", field: "effectiveFrom" }))
  })

  it("leaves the confirmed start alone when the flag is not passed", () => {
    /*
     * assignSessionRecords is shared with the Schedules screen, which passes no
     * confirmTrainingStart. Without that split, adding a schedule to an onboarded
     * player would silently rewrite the billing anchor every issued fee hangs
     * off, bypassing redateConfirmedTrainingStart entirely.
     */
    const playerId = approvedPlayer("Schedules Screen Assign")
    assessment(playerId, 0)

    sessionsService.assignSessionRecords({
      coachId,
      database,
      // Not the flagged path, so the old floor stands: the seeded approval date.
      effectiveFrom: "2026-08-20",
      now,
      playerId,
      seriesId: series("2026-07-01"),
      weekdays: [1, 2, 3],
    })

    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({ trainingStartConfirmedAt: null })
  })

  it("clears the confirmed start when the assignment is reset", () => {
    const playerId = approvedPlayer("Reset Assignment")
    assessment(playerId, 0)
    assignWithStart(playerId, series("2026-07-01"), "2026-07-15")

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
        status: "unassigned",
        trainingStartConfirmedAt: null,
        trainingStartConfirmedByAccountId: null,
      })
  })

  it("refuses reset when academy records depend on the assignment", () => {
    const playerId = approvedPlayer("Dependent Assignment")
    assessment(playerId, 0)
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
  it("refuses a start later than an ended assignment, keeping its attendance eligible", () => {
    /*
     * The guard moved with the date it protects. Ending an assignment does not
     * unmake the days it rostered the player for: eligibility is
     * `eligibilityDate >= trainingStartOn`, so confirming a later start would
     * make already-recorded present days vanish from the player's month, with the
     * rows still in the table and nothing said to the coach.
     */
    const playerId = approvedPlayer("Ended Assignment")
    assessment(playerId, 0)
    const seriesId = series("2026-07-01")
    assignWithStart(playerId, seriesId, "2026-07-01")
    const assignmentId = database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, playerId)).get()!.id
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

    expect(() => assignWithStart(playerId, series("2026-08-01"), "2026-08-01"))
      .toThrow(expect.objectContaining({ code: "BUSINESS_RULE", field: "effectiveFrom" }))
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get())
      .toMatchObject({ trainingStartOn: "2026-07-01" })
    expect(julyAttendance(playerId)).toMatchObject({
      absent: 1,
      attended: 1,
      eligible: 2,
      percentage: 50,
      recorded: 2,
    })
  })

  it("refuses to reclassify a player whose assignment has been ended", () => {
    const playerId = approvedPlayer("Ended Assignment Reclassification")
    assessment(playerId, 0)
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
    expect(assessment(playerId, 3)).toEqual({ playerId, recordRevision: 4 })
  })

  it("keeps the confirmed date immutable after completion", () => {
    const playerId = approvedPlayer("Completed Assessment")
    assessment(playerId, 0)
    database.update(schema.playerEnrollments).set({
      onboardingCompletedAt: now,
      onboardingCompletedByAccountId: coachId,
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()

    expect(() => assessment(playerId, 1)).toThrow(expect.objectContaining({
      code: "BUSINESS_RULE",
      field: "trainingStartOn",
    }))
  })
})
