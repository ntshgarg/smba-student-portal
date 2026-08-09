import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-adjustments-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("attendance adjustments", () => {
  let adjustments: typeof import("@/lib/attendance/adjustments")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T12:00:00+05:30")

  beforeAll(async () => {
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    adjustments = await import("@/lib/attendance/adjustments")
    database = client.initializeDatabase()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  function createScenario(prefix: string, {
    completedOn = "2026-08-12",
    sourceDate = "2026-08-10",
  }: {
    completedOn?: string
    sourceDate?: string
  } = {}) {
    const playerId = `${prefix}-player`
    const sourceSeriesId = `${prefix}-source-series`
    const sourceOccurrenceId = `${prefix}-source-occurrence`
    const assignmentId = `${prefix}-assignment`
    const completionSeriesId = `${prefix}-completion-series`
    const completionOccurrenceId = `${prefix}-completion-occurrence`

    database.insert(schema.accounts).values({
      id: playerId,
      fullName: `${prefix} Player`,
      normalizedName: `${prefix} player`,
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      level: "Adult",
      batch: "Weekday",
      academyPlan: "weekday-3-day",
      status: "active",
      joinedAt: new Date("2026-08-01T00:00:00+05:30"),
      updatedAt: now,
    }).run()
    database.insert(schema.sessionSeries).values([
      {
        id: sourceSeriesId,
        title: `${prefix} source`,
        programme: "Adult",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        status: "active",
        createdByAccountId: coachId,
        createdAt: now,
      },
      {
        id: completionSeriesId,
        title: `${prefix} completion`,
        programme: "Adult",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        status: "active",
        createdByAccountId: coachId,
        createdAt: now,
      },
    ]).run()
    database.insert(schema.sessionOccurrences).values([
      {
        id: sourceOccurrenceId,
        seriesId: sourceSeriesId,
        occurrenceDate: sourceDate,
        startsAt: new Date(`${sourceDate}T06:00:00+05:30`),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled",
        createdAt: now,
      },
      {
        id: completionOccurrenceId,
        seriesId: completionSeriesId,
        occurrenceDate: completedOn,
        startsAt: new Date(`${completedOn}T07:00:00+05:30`),
        durationMinutes: 60,
        venue: "SMBA Court",
        status: "scheduled",
        createdAt: now,
      },
    ]).run()
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      seriesId: sourceSeriesId,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: `${prefix}-assignment-weekday`,
      assignmentId,
      weekday: new Date(`${sourceDate}T00:00:00.000Z`).getUTCDay(),
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: `${prefix}-attendance`,
      accountId: playerId,
      occurrenceId: sourceOccurrenceId,
      choice: "absent",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()

    return { completedOn, completionOccurrenceId, playerId, sourceOccurrenceId }
  }

  it("publishes, lists and soft-voids one auditable make-up", () => {
    const fixture = createScenario("lifecycle")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
      reason: "  Tournament  ",
    })

    expect(published).toMatchObject({
      type: "makeup",
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
      completionOccurrenceId: fixture.completionOccurrenceId,
      reason: "Tournament",
      reviewRequiredAt: null,
      voidedAt: null,
    })
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database))
      .toEqual([published])
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
    })).toThrow("already has a published adjustment")
    expect(database.select().from(schema.sessionAttendanceRecords).where(and(
      eq(schema.sessionAttendanceRecords.accountId, fixture.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, fixture.sourceOccurrenceId),
    )).get()?.choice).toBe("absent")

    const voided = adjustments.voidAttendanceAdjustment({
      adjustmentId: published.id,
      coachId,
      database,
      now: new Date("2026-08-21T12:00:00+05:30"),
    })
    expect(voided).toMatchObject({ voidedByAccountId: coachId })
    expect(voided.voidedAt).toBeInstanceOf(Date)
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)).toEqual([])
    expect(adjustments.listAttendanceAdjustments({
      database,
      includeVoided: true,
      playerId: fixture.playerId,
    })).toHaveLength(1)

    const replacement = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
    })
    expect(replacement.id).not.toBe(published.id)
  })

  it("keeps completion occurrence optional when several sessions happened that day", () => {
    const fixture = createScenario("ambiguous")
    database.insert(schema.sessionSeries).values([
      {
        id: "ambiguous-second-completion-series",
        title: "Ambiguous second completion",
        programme: "Adult",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        status: "active",
        createdByAccountId: coachId,
        createdAt: now,
      },
      {
        id: "ambiguous-second-source-series",
        title: "Ambiguous second source",
        programme: "Adult",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        status: "active",
        createdByAccountId: coachId,
        createdAt: now,
      },
    ]).run()
    database.insert(schema.sessionOccurrences).values({
      id: "ambiguous-second-completion",
      seriesId: "ambiguous-second-completion-series",
      occurrenceDate: fixture.completedOn,
      startsAt: new Date(`${fixture.completedOn}T09:00:00+05:30`),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()

    const secondSourceDate = "2026-08-11"
    database.insert(schema.sessionOccurrences).values({
      id: "ambiguous-second-source",
      seriesId: "ambiguous-second-source-series",
      occurrenceDate: secondSourceDate,
      startsAt: new Date(`${secondSourceDate}T08:00:00+05:30`),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: "ambiguous-second-source-assignment",
      accountId: fixture.playerId,
      seriesId: "ambiguous-second-source-series",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: "ambiguous-second-source-weekday",
      assignmentId: "ambiguous-second-source-assignment",
      weekday: new Date(`${secondSourceDate}T00:00:00.000Z`).getUTCDay(),
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: "ambiguous-second-source-attendance",
      accountId: fixture.playerId,
      occurrenceId: "ambiguous-second-source",
      choice: "absent",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()

    expect(adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
    }).completionOccurrenceId).toBeNull()
    expect(adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: "ambiguous-second-source",
      completedOn: fixture.completedOn,
    }).completionOccurrenceId).toBeNull()
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)).toHaveLength(2)
  })

  it("rejects invalid source and completion dates", () => {
    const fixture = createScenario("validation")
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: "2026-08-10",
    })).toThrow("must be after")
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: "2026-08-25",
    })).toThrow("within 14 days")
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: "2026-08-13",
    })).toThrow("No completed academy session")
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
      reason: "x".repeat(161),
    })).toThrow("within 160 characters")

    database.update(schema.sessionAttendanceRecords).set({ choice: "present" }).where(and(
      eq(schema.sessionAttendanceRecords.accountId, fixture.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, fixture.sourceOccurrenceId),
    )).run()
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
    })).toThrow("Only a saved absence")
  })

  it("marks only a lost ordinary presence for review and clears it when presence returns", () => {
    const fixture = createScenario("review")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
    })

    expect(adjustments.reconcileAttendanceAdjustmentReviewState({
      completedOn: fixture.completedOn,
      database,
      lostFinalPresence: false,
      now,
      playerId: fixture.playerId,
    })).toBe(0)
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeNull()

    expect(adjustments.reconcileAttendanceAdjustmentReviewState({
      completedOn: fixture.completedOn,
      database,
      lostFinalPresence: true,
      now,
      playerId: fixture.playerId,
    })).toBe(1)
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeInstanceOf(Date)

    database.insert(schema.sessionAttendanceRecords).values({
      id: "review-completion-attendance",
      accountId: fixture.playerId,
      occurrenceId: fixture.completionOccurrenceId,
      choice: "present",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    expect(adjustments.reconcileAttendanceAdjustmentReviewState({
      completedOn: fixture.completedOn,
      database,
      lostFinalPresence: false,
      now,
      playerId: fixture.playerId,
    })).toBe(1)
    expect(database.select().from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, published.id)).get()?.reviewRequiredAt).toBeNull()
  })

  it("reconciles review state through attendance saves and protects the source absence", async () => {
    const fixture = createScenario("attendance-save")
    database.insert(schema.sessionAssignments).values({
      id: "attendance-save-completion-assignment",
      accountId: fixture.playerId,
      seriesId: "attendance-save-completion-series",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: "attendance-save-completion-weekday",
      assignmentId: "attendance-save-completion-assignment",
      weekday: new Date(`${fixture.completedOn}T00:00:00.000Z`).getUTCDay(),
    }).run()

    const { saveSessionAttendanceRecords } = await import("@/lib/sessions/service")
    const saveChoice = (occurrenceId: string, choice: "present" | "absent" | "cleared") => (
      saveSessionAttendanceRecords({
        database,
        coachId,
        now,
        referenceDate: "2026-08-20",
        changes: [{ playerId: fixture.playerId, occurrenceId, choice }],
      })
    )

    saveChoice(fixture.completionOccurrenceId, "present")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
    })

    saveChoice(fixture.completionOccurrenceId, "cleared")
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeInstanceOf(Date)

    saveChoice(fixture.completionOccurrenceId, "present")
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeNull()

    expect(() => saveChoice(fixture.sourceOccurrenceId, "present"))
      .toThrow("Void the attendance adjustment")
    expect(database.select().from(schema.sessionAttendanceRecords).where(and(
      eq(schema.sessionAttendanceRecords.accountId, fixture.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, fixture.sourceOccurrenceId),
    )).get()?.choice).toBe("absent")
    expect(published.voidedAt).toBeNull()
  })
})
