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
  const otherCoachId = "attendance-adjustments-other-head-coach"
  const now = new Date("2026-08-20T12:00:00+05:30")

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    adjustments = await import("@/lib/attendance/adjustments")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    database.insert(schema.accounts).values({
      id: otherCoachId,
      fullName: "Other Head Coach",
      normalizedName: "other head coach",
      requestedRole: "coach",
      role: "coach",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: 999,
      accountId: otherCoachId,
      createdAt: now,
    }).run()
    database.insert(schema.coachProfiles).values({
      accountId: otherCoachId,
      accessLevel: "head_admin",
      joinedOn: "2026-08-01",
      createdAt: now,
      updatedAt: now,
    }).run()
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
    const completionAssignmentId = `${prefix}-completion-assignment`

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
      trainingStartOn: "2026-08-01",
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
    database.insert(schema.sessionAssignments).values([
      {
        id: assignmentId,
        accountId: playerId,
        seriesId: sourceSeriesId,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        assignedByAccountId: coachId,
        assignedAt: now,
      },
      {
        id: completionAssignmentId,
        accountId: playerId,
        seriesId: completionSeriesId,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        assignedByAccountId: coachId,
        assignedAt: now,
      },
    ]).run()
    database.insert(schema.sessionAssignmentWeekdays).values([
      {
        id: `${prefix}-assignment-weekday`,
        assignmentId,
        weekday: new Date(`${sourceDate}T00:00:00.000Z`).getUTCDay(),
      },
      {
        id: `${prefix}-completion-assignment-weekday`,
        assignmentId: completionAssignmentId,
        weekday: new Date(`${completedOn}T00:00:00.000Z`).getUTCDay(),
      },
    ]).run()
    database.insert(schema.sessionAttendanceRecords).values([
      {
        id: `${prefix}-attendance`,
        accountId: playerId,
        occurrenceId: sourceOccurrenceId,
        choice: "absent",
        markedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${prefix}-completion-attendance`,
        accountId: playerId,
        occurrenceId: completionOccurrenceId,
        choice: "present",
        markedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    return { completedOn, completionOccurrenceId, playerId, sourceOccurrenceId }
  }

  function addAbsentSource(prefix: string, playerId: string, sourceDate: string) {
    const seriesId = `${prefix}-series`
    const occurrenceId = `${prefix}-occurrence`
    const assignmentId = `${prefix}-assignment`
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: `${prefix} source`,
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: occurrenceId,
      seriesId,
      occurrenceDate: sourceDate,
      startsAt: new Date(`${sourceDate}T08:00:00+05:30`),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      seriesId,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: `${prefix}-weekday`,
      assignmentId,
      weekday: new Date(`${sourceDate}T00:00:00.000Z`).getUTCDay(),
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: `${prefix}-attendance`,
      accountId: playerId,
      occurrenceId,
      choice: "absent",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    return occurrenceId
  }

  it("publishes, lists and soft-voids one auditable make-up", () => {
    const fixture = createScenario("lifecycle")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
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
    expect(adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      reason: "Tournament",
    })).toEqual(published)
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      reason: "Different reason",
    })).toThrow("different published adjustment")
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
    expect(adjustments.voidAttendanceAdjustment({
      adjustmentId: published.id,
      coachId,
      database,
      now: new Date("2026-08-22T12:00:00+05:30"),
    })).toEqual(voided)
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
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
    })
    expect(replacement.id).not.toBe(published.id)
  })

  it("revalidates archival in the write transaction while preserving exact retries", () => {
    const raced = createScenario("archival-race")
    const transaction = database.transaction.bind(database)
    database.transaction = ((callback, config) => {
      database.update(schema.accounts).set({ archivedAt: now })
        .where(eq(schema.accounts.id, raced.playerId)).run()
      return transaction(callback, config)
    }) as typeof database.transaction

    try {
      expect(() => adjustments.publishMakeupAttendanceAdjustment({
        coachId,
        database,
        now,
        completionOccurrenceId: raced.completionOccurrenceId,
        playerId: raced.playerId,
        sourceOccurrenceId: raced.sourceOccurrenceId,
      })).toThrowError(expect.objectContaining({
        code: "NOT_FOUND",
        field: "playerId",
      }))
    } finally {
      database.transaction = transaction
    }
    expect(adjustments.listActiveAttendanceAdjustments(raced.playerId, database)).toEqual([])

    const retry = createScenario("archival-retry")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: retry.completionOccurrenceId,
      playerId: retry.playerId,
      sourceOccurrenceId: retry.sourceOccurrenceId,
    })
    database.update(schema.accounts).set({ archivedAt: now })
      .where(eq(schema.accounts.id, retry.playerId)).run()
    expect(adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now: new Date("2026-08-20T12:01:00+05:30"),
      completionOccurrenceId: retry.completionOccurrenceId,
      playerId: retry.playerId,
      sourceOccurrenceId: retry.sourceOccurrenceId,
    })).toEqual(published)
    expect(adjustments.listActiveAttendanceAdjustments(retry.playerId, database)).toEqual([published])
  })

  it("prevents one attended completion occurrence from reconciling two absences", () => {
    const fixture = createScenario("completion-reuse")
    const secondSourceDate = "2026-08-11"
    database.insert(schema.sessionSeries).values({
      id: "completion-reuse-second-source-series",
      title: "Completion reuse second source",
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "completion-reuse-second-source",
      seriesId: "completion-reuse-second-source-series",
      occurrenceDate: secondSourceDate,
      startsAt: new Date(`${secondSourceDate}T08:00:00+05:30`),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: "completion-reuse-second-source-assignment",
      accountId: fixture.playerId,
      seriesId: "completion-reuse-second-source-series",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: "completion-reuse-second-source-weekday",
      assignmentId: "completion-reuse-second-source-assignment",
      weekday: new Date(`${secondSourceDate}T00:00:00.000Z`).getUTCDay(),
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: "completion-reuse-second-source-attendance",
      accountId: fixture.playerId,
      occurrenceId: "completion-reuse-second-source",
      choice: "absent",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()

    const first = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
    })
    expect(first.completionOccurrenceId).toBe(fixture.completionOccurrenceId)
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: "completion-reuse-second-source",
    })).toThrow("already linked")
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)).toEqual([first])
  })

  it("does not reuse a date claimed by an unresolved legacy adjustment", () => {
    const fixture = createScenario("legacy-completion-date")
    const secondSourceOccurrenceId = addAbsentSource(
      "legacy-completion-date-second-source",
      fixture.playerId,
      "2026-08-11",
    )
    database.insert(schema.attendanceAdjustments).values({
      id: "legacy-completion-date-adjustment",
      type: "makeup",
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
      completedOn: fixture.completedOn,
      completionOccurrenceId: null,
      reason: null,
      publishedByAccountId: coachId,
      publishedAt: now,
      reviewRequiredAt: now,
      voidedByAccountId: null,
      voidedAt: null,
    }).run()

    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: secondSourceOccurrenceId,
    })).toThrowError(expect.objectContaining({
      code: "CONFLICT",
      field: "completionOccurrenceId",
      message: expect.stringContaining("legacy adjustment"),
    }))
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database))
      .toHaveLength(1)
  })

  it("returns a stable void retry and rejects a conflicting actor", () => {
    const fixture = createScenario("void-retry")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      completionOccurrenceId: fixture.completionOccurrenceId,
      database,
      now,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
    })
    const voided = adjustments.voidAttendanceAdjustment({
      adjustmentId: published.id,
      coachId: otherCoachId,
      database,
      now,
    })
    expect(adjustments.voidAttendanceAdjustment({
      adjustmentId: published.id,
      coachId: otherCoachId,
      database,
      now: new Date("2026-08-21T12:00:00+05:30"),
    })).toEqual(voided)
    expect(() => adjustments.voidAttendanceAdjustment({
      adjustmentId: published.id,
      coachId,
      database,
      now: new Date("2026-08-21T12:00:00+05:30"),
    })).toThrow("already voided by another coach")
  })

  it("requires an exact eligible, started and saved-present completion occurrence", () => {
    const sameDay = createScenario("validation-same-day", {
      completedOn: "2026-08-10",
      sourceDate: "2026-08-10",
    })
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: sameDay.completionOccurrenceId,
      playerId: sameDay.playerId,
      sourceOccurrenceId: sameDay.sourceOccurrenceId,
    })).toThrow("must be after")

    const tooLate = createScenario("validation-too-late", {
      completedOn: "2026-08-20",
      sourceDate: "2026-08-05",
    })
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: tooLate.completionOccurrenceId,
      playerId: tooLate.playerId,
      sourceOccurrenceId: tooLate.sourceOccurrenceId,
    })).toThrow("within 14 days")

    const missing = createScenario("validation-missing")
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: "missing-completion-occurrence",
      playerId: missing.playerId,
      sourceOccurrenceId: missing.sourceOccurrenceId,
    })).toThrow("Choose a completed attendance session")

    const future = createScenario("validation-future", { completedOn: "2026-08-21" })
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: future.completionOccurrenceId,
      playerId: future.playerId,
      sourceOccurrenceId: future.sourceOccurrenceId,
    })).toThrow("Choose a completed attendance session")

    const absentCompletion = createScenario("validation-completion-absent")
    database.update(schema.sessionAttendanceRecords).set({ choice: "absent" }).where(and(
      eq(schema.sessionAttendanceRecords.accountId, absentCompletion.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, absentCompletion.completionOccurrenceId),
    )).run()
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: absentCompletion.completionOccurrenceId,
      playerId: absentCompletion.playerId,
      sourceOccurrenceId: absentCompletion.sourceOccurrenceId,
    })).toThrow("saved Present")

    const unassignedCompletion = createScenario("validation-completion-unassigned")
    database.update(schema.sessionAssignments).set({
      effectiveTo: unassignedCompletion.completedOn,
    }).where(eq(
      schema.sessionAssignments.id,
      "validation-completion-unassigned-completion-assignment",
    )).run()
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: unassignedCompletion.completionOccurrenceId,
      playerId: unassignedCompletion.playerId,
      sourceOccurrenceId: unassignedCompletion.sourceOccurrenceId,
    })).toThrow("not from an assigned session day")

    const reason = createScenario("validation-reason")
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: reason.completionOccurrenceId,
      playerId: reason.playerId,
      sourceOccurrenceId: reason.sourceOccurrenceId,
      reason: "x".repeat(161),
    })).toThrow("within 160 characters")

    const sourceNotAbsent = createScenario("validation-source-present")
    database.update(schema.sessionAttendanceRecords).set({ choice: "present" }).where(and(
      eq(schema.sessionAttendanceRecords.accountId, sourceNotAbsent.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, sourceNotAbsent.sourceOccurrenceId),
    )).run()
    expect(() => adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: sourceNotAbsent.completionOccurrenceId,
      playerId: sourceNotAbsent.playerId,
      sourceOccurrenceId: sourceNotAbsent.sourceOccurrenceId,
    })).toThrow("Only a saved absence")
  })

  it("reviews the exact completion occurrence rather than any presence on that date", () => {
    const fixture = createScenario("review")
    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
    })

    database.update(schema.sessionAttendanceRecords).set({ choice: "cleared" }).where(and(
      eq(schema.sessionAttendanceRecords.accountId, fixture.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, fixture.completionOccurrenceId),
    )).run()
    database.insert(schema.sessionSeries).values({
      id: "review-unrelated-completion-series",
      title: "Review unrelated completion",
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: fixture.completedOn,
      endsOn: fixture.completedOn,
      status: "ended",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "review-unrelated-completion-occurrence",
      seriesId: "review-unrelated-completion-series",
      occurrenceDate: fixture.completedOn,
      startsAt: new Date(`${fixture.completedOn}T09:00:00+05:30`),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: "review-unrelated-completion-attendance",
      accountId: fixture.playerId,
      occurrenceId: "review-unrelated-completion-occurrence",
      choice: "present",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()

    expect(adjustments.reconcileAttendanceAdjustmentReviewState({
      completedOn: fixture.completedOn,
      database,
      lostFinalPresence: true,
      now,
      playerId: fixture.playerId,
    })).toBe(1)
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeInstanceOf(Date)

    database.update(schema.sessionAttendanceRecords).set({ choice: "present" }).where(and(
      eq(schema.sessionAttendanceRecords.accountId, fixture.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, fixture.completionOccurrenceId),
    )).run()
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
    const { saveSessionAttendanceRecords } = await import("@/lib/sessions/service")
    const saveChoice = (
      occurrenceId: string,
      choice: "present" | "absent" | "cleared",
      expectedChoice: "present" | "absent" | "cleared",
    ) => (
      saveSessionAttendanceRecords({
        database,
        coachId,
        now,
        referenceDate: "2026-08-20",
        changes: [{ playerId: fixture.playerId, occurrenceId, choice, expectedChoice }],
      })
    )

    const published = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: fixture.completionOccurrenceId,
      playerId: fixture.playerId,
      sourceOccurrenceId: fixture.sourceOccurrenceId,
    })

    saveChoice(fixture.completionOccurrenceId, "cleared", "present")
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeInstanceOf(Date)

    saveChoice(fixture.completionOccurrenceId, "present", "cleared")
    expect(adjustments.listActiveAttendanceAdjustments(fixture.playerId, database)[0]
      .reviewRequiredAt).toBeNull()

    expect(() => saveChoice(fixture.sourceOccurrenceId, "present", "absent"))
      .toThrow("Void the attendance adjustment")
    expect(database.select().from(schema.sessionAttendanceRecords).where(and(
      eq(schema.sessionAttendanceRecords.accountId, fixture.playerId),
      eq(schema.sessionAttendanceRecords.occurrenceId, fixture.sourceOccurrenceId),
    )).get()?.choice).toBe("absent")
    expect(published.voidedAt).toBeNull()
  })

  /*
   * One save now reconciles the whole register in one batch instead of once per
   * (player, date), and `saveAttendanceRegisterAction` accepts whatever changes
   * a client sends -- several players across several dates. Batching two `in`
   * lists is a cross product, so this pins the three ways it could smear one
   * player's answer onto another: the pair it was asked about, the presence it
   * judges that pair by, and whether that pair lost its final presence.
   */
  it("reconciles a multi-player register without crossing players or dates", async () => {
    const { saveSessionAttendanceRecords } = await import("@/lib/sessions/service")
    const flagged = createScenario("register-flagged", {
      completedOn: "2026-08-12",
      sourceDate: "2026-08-10",
    })
    const cleared = createScenario("register-cleared", {
      completedOn: "2026-08-13",
      sourceDate: "2026-08-11",
    })
    const flaggedAdjustment = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: flagged.completionOccurrenceId,
      playerId: flagged.playerId,
      sourceOccurrenceId: flagged.sourceOccurrenceId,
    })
    const clearedAdjustment = adjustments.publishMakeupAttendanceAdjustment({
      coachId,
      database,
      now,
      completionOccurrenceId: cleared.completionOccurrenceId,
      playerId: cleared.playerId,
      sourceOccurrenceId: cleared.sourceOccurrenceId,
    })

    // Take the completion presence away so this adjustment starts the register
    // already needing review, and the register can be seen to clear it.
    saveSessionAttendanceRecords({
      database,
      coachId,
      now,
      referenceDate: "2026-08-20",
      changes: [{
        playerId: cleared.playerId,
        occurrenceId: cleared.completionOccurrenceId,
        choice: "cleared",
        expectedChoice: "present",
      }],
    })
    expect(database.select().from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, clearedAdjustment.id)).get()?.reviewRequiredAt)
      .toBeInstanceOf(Date)

    /*
     * The bystander: a second adjustment for the cleared player, on the other
     * player's date. The register never asks about that pair, so it must not be
     * written -- and it is the legacy shape, judged by any presence on the
     * completed date, so an unfiltered cross product would find the presence
     * seeded below and wrongly clear it.
     */
    const bystanderSourceOccurrenceId = addAbsentSource(
      "register-bystander-source",
      cleared.playerId,
      "2026-08-09",
    )
    database.insert(schema.sessionSeries).values({
      id: "register-bystander-series",
      title: "Register bystander",
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "register-bystander-occurrence",
      seriesId: "register-bystander-series",
      occurrenceDate: "2026-08-12",
      startsAt: new Date("2026-08-12T09:00:00+05:30"),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: "register-bystander-attendance",
      accountId: cleared.playerId,
      occurrenceId: "register-bystander-occurrence",
      choice: "present",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    const bystanderReviewRequiredAt = new Date("2026-08-14T12:00:00+05:30")
    database.insert(schema.attendanceAdjustments).values({
      id: "register-bystander-adjustment",
      type: "makeup",
      playerId: cleared.playerId,
      sourceOccurrenceId: bystanderSourceOccurrenceId,
      completedOn: "2026-08-12",
      completionOccurrenceId: null,
      reason: null,
      publishedByAccountId: coachId,
      publishedAt: now,
      reviewRequiredAt: bystanderReviewRequiredAt,
      voidedByAccountId: null,
      voidedAt: null,
    }).run()

    // One register, two players, two dates, opposite outcomes: the flagged
    // player loses the presence its adjustment rests on, the cleared player
    // gets its presence back.
    expect(saveSessionAttendanceRecords({
      database,
      coachId,
      now,
      referenceDate: "2026-08-20",
      changes: [
        {
          playerId: flagged.playerId,
          occurrenceId: flagged.completionOccurrenceId,
          choice: "cleared",
          expectedChoice: "present",
        },
        {
          playerId: cleared.playerId,
          occurrenceId: cleared.completionOccurrenceId,
          choice: "present",
          expectedChoice: "cleared",
        },
      ],
    })).toEqual({ applied: 2 })

    const readAdjustment = (id: string) => database.select()
      .from(schema.attendanceAdjustments)
      .where(eq(schema.attendanceAdjustments.id, id)).get()
    expect(readAdjustment(flaggedAdjustment.id)?.reviewRequiredAt).toEqual(now)
    expect(readAdjustment(clearedAdjustment.id)?.reviewRequiredAt).toBeNull()
    expect(readAdjustment("register-bystander-adjustment")?.reviewRequiredAt)
      .toEqual(bystanderReviewRequiredAt)
  })
})
