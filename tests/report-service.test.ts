import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-report-service-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("monthly report service", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let reports: typeof import("@/lib/reports/service")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const playerId = "10000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-03T10:00:00+05:30")

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    reports = await import("@/lib/reports/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })

    database.insert(schema.accounts).values({
      id: playerId,
      fullName: "Report Player",
      normalizedName: "report player",
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
      joinedAt: new Date("2026-07-01T00:00:00+05:30"),
      updatedAt: now,
    }).run()
    database.insert(schema.sessionSeries).values({
      id: "report-series",
      title: "Adult_Weekday_6-7_AM",
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-07-01",
      endsOn: "2026-07-31",
      status: "ended",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "report-occurrence",
      seriesId: "report-series",
      occurrenceDate: "2026-07-06",
      startsAt: new Date("2026-07-06T06:00:00+05:30"),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: "report-assignment",
      accountId: playerId,
      seriesId: "report-series",
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: "report-assignment-monday",
      assignmentId: "report-assignment",
      weekday: 1,
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: "report-attendance",
      accountId: playerId,
      occurrenceId: "report-occurrence",
      choice: "present",
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("allows an empty completed-month draft and rejects invalid report input", () => {
    const draft = reports.saveMonthlyReportDraft({
      month: "2026-07",
      playerId,
      reportText: "",
    }, { coachId, database, now })
    expect(draft.reportId).toBeTruthy()
    expect(database.select().from(schema.monthlyReports)
      .where(eq(schema.monthlyReports.id, draft.reportId)).get()?.draftText).toBe("")

    const invalidCases = [
      {
        input: { month: "2026-08", playerId, reportText: "Current month" },
        field: "month",
      },
      {
        input: { month: "2026-09", playerId, reportText: "Future month" },
        field: "month",
      },
      {
        input: { month: "not-a-month", playerId, reportText: "Invalid" },
        field: "month",
      },
      {
        input: { month: "2026-07", playerId, reportText: "x".repeat(5_001) },
        field: "reportText",
      },
    ] as const
    invalidCases.forEach(({ field, input }) => {
      expect(() => reports.saveMonthlyReportDraft(input, { coachId, database, now }))
        .toThrow(expect.objectContaining({ code: "INVALID_INPUT", field }))
    })

    expect(() => reports.publishMonthlyReport({
      month: "2026-07",
      playerId,
      publicationKey: "e3af506d-c229-4be5-88d4-f6469a153b0b",
      reportText: "   ",
    }, { coachId, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "reportText",
    }))
  })

  it("publishes immutable revisions atomically and reuses an idempotency key", () => {
    const firstKey = "11111111-1111-4111-8111-111111111111"
    const first = reports.publishMonthlyReport({
      month: "2026-07",
      playerId,
      publicationKey: firstKey,
      reportText: "The first published report.",
    }, { coachId, database, now })
    expect(first).toMatchObject({ reusedPublication: false, revision: 1 })

    const retry = reports.publishMonthlyReport({
      month: "2026-07",
      playerId,
      publicationKey: firstKey,
      reportText: "The first published report.",
    }, { coachId, database, now: new Date("2026-08-03T10:01:00+05:30") })
    expect(retry).toMatchObject({
      publicationId: first.publicationId,
      reportId: first.reportId,
      reusedPublication: true,
      revision: 1,
    })
    expect(database.select().from(schema.reportPublications)
      .where(eq(schema.reportPublications.reportId, first.reportId)).all()).toHaveLength(1)

    expect(() => reports.publishMonthlyReport({
      month: "2026-07",
      playerId,
      publicationKey: firstKey,
      reportText: "Different content.",
    }, { coachId, database, now })).toThrow(expect.objectContaining({
      code: "PUBLICATION_CONFLICT",
    }))

    const second = reports.publishMonthlyReport({
      month: "2026-07",
      playerId,
      publicationKey: "22222222-2222-4222-8222-222222222222",
      reportText: "A deliberate second revision.",
    }, { coachId, database, now: new Date("2026-08-03T10:02:00+05:30") })
    expect(second).toMatchObject({ reusedPublication: false, revision: 2 })
    const publications = database.select().from(schema.reportPublications)
      .where(eq(schema.reportPublications.reportId, first.reportId)).all()
    expect(publications.map((publication) => publication.reportText).sort()).toEqual([
      "A deliberate second revision.",
      "The first published report.",
    ])
    expect(JSON.parse(publications[0].attendanceSnapshot ?? "null")).toMatchObject({
      version: 4,
      referenceDate: "2026-08-03",
      referenceInstant: now.toISOString(),
      attended: 1,
      recorded: 1,
    })
  })

  it("rolls back the draft update when publication insertion fails", () => {
    const report = database.select().from(schema.monthlyReports).where(and(
      eq(schema.monthlyReports.accountId, playerId),
      eq(schema.monthlyReports.month, "2026-07"),
    )).get()
    if (!report) throw new Error("Report fixture was not created.")
    const existingPublicationId = database.select({ id: schema.reportPublications.id })
      .from(schema.reportPublications).get()?.id
    if (!existingPublicationId) throw new Error("Publication fixture was not created.")
    const ids = ["unused-report-id", existingPublicationId]
    const beforeCount = database.select().from(schema.reportPublications).all().length
    const beforeDraft = report.draftText

    expect(() => reports.publishMonthlyReport({
      month: "2026-07",
      playerId,
      publicationKey: "33333333-3333-4333-8333-333333333333",
      reportText: "This update must roll back.",
    }, {
      coachId,
      createId: () => ids.shift() ?? "unexpected-id",
      database,
      now: new Date("2026-08-03T10:03:00+05:30"),
    })).toThrow()

    expect(database.select().from(schema.monthlyReports)
      .where(eq(schema.monthlyReports.id, report.id)).get()?.draftText).toBe(beforeDraft)
    expect(database.select().from(schema.reportPublications).all()).toHaveLength(beforeCount)
  })

  it("requires explicit confirmation for review-required attendance adjustments", () => {
    database.update(schema.sessionAttendanceRecords).set({ choice: "absent" })
      .where(eq(schema.sessionAttendanceRecords.occurrenceId, "report-occurrence")).run()
    database.insert(schema.attendanceAdjustments).values({
      id: "review-adjustment",
      type: "makeup",
      playerId,
      sourceOccurrenceId: "report-occurrence",
      completedOn: "2026-07-09",
      publishedByAccountId: coachId,
      publishedAt: now,
      reviewRequiredAt: now,
    }).run()

    const input = {
      month: "2026-07",
      playerId,
      publicationKey: "44444444-4444-4444-8444-444444444444",
      reportText: "Adjustment-aware report.",
    }
    expect(() => reports.publishMonthlyReport(input, { coachId, database, now }))
      .toThrow(expect.objectContaining({ code: "ADJUSTMENT_REVIEW_REQUIRED" }))
    const published = reports.publishMonthlyReport({
      ...input,
      confirmAdjustmentReview: true,
    }, { coachId, database, now })
    expect(published.revision).toBe(3)
  })

  it("keeps legacy null keys compatible while enforcing unique non-null keys", () => {
    const reportId = database.select({ id: schema.monthlyReports.id })
      .from(schema.monthlyReports).get()?.id
    if (!reportId) throw new Error("Report fixture was not created.")
    database.insert(schema.reportPublications).values([
      {
        id: "legacy-null-key-one",
        reportId,
        revision: 10,
        reportText: "Legacy one",
        publishedByAccountId: coachId,
        publishedAt: now,
      },
      {
        id: "legacy-null-key-two",
        reportId,
        revision: 11,
        reportText: "Legacy two",
        publishedByAccountId: coachId,
        publishedAt: now,
      },
    ]).run()
    expect(database.select().from(schema.reportPublications)
      .where(eq(schema.reportPublications.reportId, reportId)).all()
      .filter((publication) => publication.publicationKey === null)).toHaveLength(2)

    expect(() => database.insert(schema.reportPublications).values({
      id: "duplicate-key",
      reportId,
      publicationKey: "11111111-1111-4111-8111-111111111111",
      revision: 12,
      reportText: "Duplicate key",
      publishedByAccountId: coachId,
      publishedAt: now,
    }).run()).toThrow()
  })

  it("excludes an academy session that has not started at the reference instant", async () => {
    const attendance = await import("@/lib/attendance/database")
    database.insert(schema.sessionSeries).values({
      id: "same-day-series",
      title: "Adult_Weekday_8-9_PM",
      programme: "Adult",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-03",
      endsOn: "2026-08-03",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "same-day-future-occurrence",
      seriesId: "same-day-series",
      occurrenceDate: "2026-08-03",
      startsAt: new Date("2026-08-03T20:00:00+05:30"),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: "same-day-assignment",
      accountId: playerId,
      seriesId: "same-day-series",
      effectiveFrom: "2026-08-03",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: "same-day-monday",
      assignmentId: "same-day-assignment",
      weekday: 1,
    }).run()

    const beforeStart = attendance.calculatePlayerAttendanceForMonth(
      playerId,
      "2026-08",
      "2026-08-03",
      "2026-08-03T19:00:00+05:30",
    )
    const afterStart = attendance.calculatePlayerAttendanceForMonth(
      playerId,
      "2026-08",
      "2026-08-03",
      "2026-08-03T20:01:00+05:30",
    )
    expect(beforeStart?.eligible).toBe(0)
    expect(afterStart?.eligible).toBe(1)
  })
})
