import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { isValidElement, type ReactNode } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-report-month-scope-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

const mocks = vi.hoisted(() => ({
  listCoachMonthlyReports: vi.fn(),
  redirect: vi.fn(),
  requireCoachPage: vi.fn(),
  requireHeadAdminAction: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/current-coach", () => ({
  HEAD_COACH_ONLY_NOTICE: "head-coach-only",
  requireCoachPage: mocks.requireCoachPage,
  requireHeadAdminAction: mocks.requireHeadAdminAction,
}))
// The real reader, watched rather than replaced: what matters is the month it
// is handed, and that the rows it comes back with still answer the question.
vi.mock("@/lib/coach/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/coach/database")>()
  mocks.listCoachMonthlyReports.mockImplementation(actual.listCoachMonthlyReports)
  return { ...actual, listCoachMonthlyReports: mocks.listCoachMonthlyReports }
})

function findProps(node: ReactNode | unknown, type: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    return node.reduce<Record<string, unknown> | null>(
      (found, child) => found ?? findProps(child, type),
      null,
    )
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node.props as Record<string, unknown>
  return findProps((node.props as { children?: ReactNode }).children, type)
}

/*
 * Both call sites read one month: the dashboard card counts the latest
 * completed month, and a report save reloads the row it just wrote. Reading
 * every month the academy has ever written -- each with a 5,000-character draft
 * and its published body -- is what was narrowed, so what has to be held is
 * that the month reaching the reader is still the right one. On the save path a
 * wrong month is not a slow page but a thrown "could not be reloaded" after the
 * write has already committed.
 */
describe("coach report reads scoped to one month", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  const now = new Date("2026-08-15T04:30:00.000Z")
  const reportMonth = "2026-07"
  let coachId: string
  let publishedPlayerId: string
  let staleMonthPlayerId: string
  let mutatingPlayerId: string

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const accountService = await import("@/lib/auth/account-service")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    const { assignSessionRecords, createSessionSeriesRecords } = await import(
      "@/lib/sessions/service"
    )
    database = prepareDatabase({ seed: true })

    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId
    mocks.requireCoachPage.mockResolvedValue({
      access: { accessLevel: "head_admin", coachAccountId: coachId, joinedOn: "2026-01-01" },
      identity: {
        academyId: "SMBA#0001",
        firstName: "Sathiya",
        fullName: "Sathiya Moorthy",
        initials: "SM",
        role: "coach",
        subjectId: coachId,
      },
    })
    mocks.requireHeadAdminAction.mockResolvedValue({
      academyId: "SMBA#0001",
      firstName: "Sathiya",
      fullName: "Sathiya Moorthy",
      initials: "SM",
      role: "coach",
      subjectId: coachId,
    })

    const addPlayer = (name: string) => {
      const accountId = accountService.registerAccount(name, "player")
      accountService.approveRegistration(accountId, coachId)
      database.update(schema.playerEnrollments).set({
        academyPlan: "weekday-3-day",
        batch: "Weekday",
        level: "Beginner",
        status: "active",
        trainingStartOn: "2026-06-01",
        updatedAt: now,
      }).where(eq(schema.playerEnrollments.accountId, accountId)).run()
      return accountId
    }
    publishedPlayerId = addPlayer("July Published")
    staleMonthPlayerId = addPlayer("June Published")
    mutatingPlayerId = addPlayer("Mutating Player")

    // A training profile only counts as active once it holds an assignment,
    // and the card counts active players.
    const seriesId = createSessionSeriesRecords({
      coachId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-08-03",
        endsOn: "2026-08-31",
        weekdays: [1, 3, 5],
        startTime: "18:00",
        durationMinutes: 60,
      },
    })
    ;[publishedPlayerId, staleMonthPlayerId, mutatingPlayerId].forEach((accountId) => {
      assignSessionRecords({
        coachId,
        database,
        effectiveFrom: "2026-08-03",
        now,
        playerId: accountId,
        seriesId,
        weekdays: [1, 3, 5],
      })
    })

    const publish = (playerId: string, month: string, id: string) => {
      database.insert(schema.monthlyReports).values({
        id,
        accountId: playerId,
        month,
        draftText: `${month} feedback.`,
        updatedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      }).run()
      database.insert(schema.reportPublications).values({
        id: `${id}-publication`,
        reportId: id,
        revision: 1,
        reportText: `${month} feedback.`,
        attendanceSnapshot: null,
        publishedByAccountId: coachId,
        publishedAt: now,
      }).run()
    }
    publish(publishedPlayerId, reportMonth, "july-report")
    // June is the month the card must not count and must no longer pay to read.
    publish(staleMonthPlayerId, "2026-06", "june-report")
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("counts the dashboard card from the completed month alone", async () => {
    const { ReportsCard } = await import("@/components/coach/reports-card")
    const { default: CoachDashboardPage } = await import("@/app/coach/page")

    const page = await CoachDashboardPage({ searchParams: Promise.resolve({}) })
    const reportsCard = findProps(page, ReportsCard)

    expect(mocks.listCoachMonthlyReports).toHaveBeenCalledWith(reportMonth)
    expect(reportsCard).toMatchObject({ completedCount: 1, month: reportMonth })
    // Three active players, one published for July: June's published report is
    // the row the unscoped read fetched only to drop.
    expect((reportsCard?.activePlayerIds as string[]).length).toBe(3)
  // Importing the dashboard pulls in its whole card tree, which is slow to
  // transform on a loaded machine and has nothing to do with the assertion.
  }, 30_000)

  it("reloads a saved draft from the month the coach submitted", async () => {
    const { saveReportDraftAction } = await import("@/app/coach/actions")
    mocks.listCoachMonthlyReports.mockClear()

    const result = await saveReportDraftAction({
      playerId: mutatingPlayerId,
      month: reportMonth,
      reportText: "Draft feedback for July.",
    })

    expect(mocks.listCoachMonthlyReports).toHaveBeenCalledWith(reportMonth)
    expect(result).toMatchObject({
      ok: true,
      report: { month: reportMonth, playerId: mutatingPlayerId, published: null },
    })
  })

  it("reloads a published report from the month the coach submitted", async () => {
    const { publishReportAction } = await import("@/app/coach/actions")
    mocks.listCoachMonthlyReports.mockClear()

    const result = await publishReportAction({
      playerId: mutatingPlayerId,
      month: "2026-06",
      publicationKey: "3f1a6f1e-6d0a-4a2b-9c8d-0b1e2f3a4b5c",
      reportText: "Published feedback for June.",
    })

    expect(mocks.listCoachMonthlyReports).toHaveBeenCalledWith("2026-06")
    expect(result).toMatchObject({
      ok: true,
      report: { month: "2026-06", published: { reportText: "Published feedback for June." } },
    })
  })
})
