import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-report-repository-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("report repository ownership and revision selection", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let coachId: string
  let firstPlayerId: string
  let secondPlayerId: string

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    database = client.initializeDatabase()

    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    const firstRegistrationId = accountService.registerAccount("First Report Player", "player")
    const secondRegistrationId = accountService.registerAccount("Second Report Player", "player")
    accountService.approveRegistration(firstRegistrationId, coachId)
    accountService.approveRegistration(secondRegistrationId, coachId)
    firstPlayerId = firstRegistrationId
    secondPlayerId = secondRegistrationId

    const now = new Date("2026-08-03T04:30:00.000Z")
    database.update(schema.playerEnrollments).set({
      batch: "Weekday",
      level: "Beginner",
      status: "active",
      updatedAt: now,
    }).where(eq(schema.playerEnrollments.accountId, firstPlayerId)).run()
    database.update(schema.playerEnrollments).set({
      batch: "Weekend",
      level: "Adult",
      status: "active",
      updatedAt: now,
    }).where(eq(schema.playerEnrollments.accountId, secondPlayerId)).run()

    database.insert(schema.monthlyReports).values([
      {
        id: "first-published-report",
        accountId: firstPlayerId,
        month: "2026-06",
        draftText: "Latest first-player draft.",
        updatedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "first-draft-only-report",
        accountId: firstPlayerId,
        month: "2026-07",
        draftText: "Unpublished draft.",
        updatedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "second-published-report",
        accountId: secondPlayerId,
        month: "2026-07",
        draftText: "Second-player draft.",
        updatedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    const attendanceSnapshot = JSON.stringify({
      version: 1,
      month: "2026-06",
      referenceDate: "2026-08-03",
      eligible: 4,
      recorded: 4,
      attended: 3,
      absent: 1,
      pending: 0,
      percentage: 75,
    })
    database.insert(schema.reportPublications).values([
      {
        id: "first-publication-revision-one",
        reportId: "first-published-report",
        revision: 1,
        reportText: "Superseded first-player feedback.",
        attendanceSnapshot,
        publishedByAccountId: coachId,
        publishedAt: new Date("2026-07-01T04:30:00.000Z"),
      },
      {
        id: "first-publication-revision-two",
        reportId: "first-published-report",
        revision: 2,
        reportText: "Latest first-player feedback.",
        attendanceSnapshot,
        publishedByAccountId: coachId,
        publishedAt: new Date("2026-07-02T04:30:00.000Z"),
      },
      {
        id: "second-publication-revision-one",
        reportId: "second-published-report",
        revision: 1,
        reportText: "Second-player feedback.",
        attendanceSnapshot: attendanceSnapshot.replace("2026-06", "2026-07"),
        publishedByAccountId: coachId,
        publishedAt: new Date("2026-08-01T04:30:00.000Z"),
      },
    ]).run()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("lists only the authenticated player's published reports at their latest revision", async () => {
    const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")
    const reports = await new SqlitePortalRepository().listReports(firstPlayerId)

    expect(reports).toHaveLength(1)
    expect(reports[0]).toEqual({
      id: "first-published-report",
      month: "2026-06",
      monthLabel: "June 2026",
      publishedAt: "2026-07-02T04:30:00.000Z",
      reportText: "Latest first-player feedback.",
    })
    expect(reports[0]).not.toHaveProperty("coachName")
    expect(reports[0]).not.toHaveProperty("attendance")
    expect(reports[0]).not.toHaveProperty("development")
    expect(reports[0]).not.toHaveProperty("primaryContact")
    expect(reports[0]).not.toHaveProperty("academyId")
  })

  it("loads only the dashboard report summary needed by the player card", async () => {
    const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")
    const dashboard = await new SqlitePortalRepository().getDashboard(firstPlayerId)

    expect(dashboard?.latestReport).toEqual({ monthLabel: "June 2026" })
    expect(dashboard?.latestReport).not.toHaveProperty("reportText")
    expect(dashboard?.latestReport).not.toHaveProperty("coachName")
    expect(dashboard?.latestReport).not.toHaveProperty("attendance")
    expect(dashboard?.latestReport).not.toHaveProperty("development")
    expect(dashboard?.latestReport).not.toHaveProperty("primaryContact")
    expect(dashboard?.latestReport).not.toHaveProperty("academyId")
  })

  it("rejects cross-player report lookup while preserving direct owner lookup", async () => {
    const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")
    const repository = new SqlitePortalRepository()

    await expect(repository.getReport(firstPlayerId, "second-published-report")).resolves.toBeNull()
    const report = await repository.getReport(secondPlayerId, "second-published-report")

    expect(report).toMatchObject({
      id: "second-published-report",
      reportText: "Second-player feedback.",
    })
    expect(report).toHaveProperty("coachName")
    expect(report).toHaveProperty("attendance")
    expect(report).toHaveProperty("development")
  })

  it("loads only the latest publication for coach records and retains unpublished drafts", async () => {
    const { listCoachMonthlyReports } = await import("@/lib/coach/database")
    const reports = listCoachMonthlyReports()

    expect(reports.find((report) => report.id === "first-published-report")?.published).toMatchObject({
      reportText: "Latest first-player feedback.",
      revision: 2,
    })
    expect(reports.find((report) => report.id === "first-draft-only-report")?.published).toBeNull()
  })
})
