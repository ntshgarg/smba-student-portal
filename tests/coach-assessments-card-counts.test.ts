import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { isValidElement, type ReactNode } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-assessments-card-counts-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

const mocks = vi.hoisted(() => ({
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

describe("the coach dashboard's assessments card", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  const now = new Date("2026-08-15T04:30:00.000Z")
  let coachId: string

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
    const players = [addPlayer("First Player"), addPlayer("Second Player"), addPlayer("Third Player")]

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
    players.forEach((accountId) => {
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
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("counts who has ever been assessed against every active player", async () => {
    const { AssessmentsCard } = await import("@/components/coach/assessments-card")
    const { default: CoachDashboardPage } = await import("@/app/coach/page")

    const page = await CoachDashboardPage({ searchParams: Promise.resolve({}) })
    const card = findProps(page, AssessmentsCard)

    expect(card).toMatchObject({ assessedCount: 0, draftCount: 0, playerCount: 3 })
  // Importing the dashboard pulls in its whole card tree, which is slow to
  // transform on a loaded machine and has nothing to do with the assertion.
  }, 30_000)
})
