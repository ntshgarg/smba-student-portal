import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { calculateProratedSessionFee } from "@/lib/finance/domain"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-onboarding-finance-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

function valueFactory(prefix: string) {
  let next = 0
  return () => `${prefix}-${String(next += 1).padStart(4, "0")}`
}

describe("onboarding finance issuance", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const ids = valueFactory("onboarding-finance")
  const feeReferences = [
    "SMBA-23456789",
    "SMBA-3456789A",
    "SMBA-456789AB",
    "SMBA-56789ABC",
    "SMBA-6789ABCD",
    "SMBA-789ABCDE",
    "SMBA-89ABCDEF",
    "SMBA-9ABCDEFG",
  ]
  const references = () => feeReferences.shift() ?? "SMBA-ABCDEFGH"
  const onboardingNow = new Date("2026-08-18T10:00:00+05:30")

  function createAssessedPlayer({
    assignmentFrom,
    name,
    occurrences = [],
  }: {
    assignmentFrom: string
    name: string
    occurrences?: Array<{
      date: string
      startTime?: string
      status?: "scheduled" | "cancelled"
    }>
  }) {
    const playerId = accountService.registerAccount(name, "player")
    accountService.approveRegistration(playerId, coachId, { now: onboardingNow })
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      batch: "Weekday",
      level: "Beginner",
      status: "active",
      updatedAt: onboardingNow,
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()
    const seriesId = ids()
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      batch: "Weekday",
      createdAt: onboardingNow,
      createdByAccountId: coachId,
      programme: "Beginner",
      startsOn: occurrences[0]?.date ?? assignmentFrom,
      status: "active",
      title: `${name} series`,
      venue: "SMBA Court",
    }).run()
    const assignmentId = ids()
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      assignedAt: onboardingNow,
      assignedByAccountId: coachId,
      effectiveFrom: assignmentFrom,
      seriesId,
    }).run()
    const weekdays = [...new Set(occurrences.map(({ date }) => (
      new Date(`${date}T00:00:00.000Z`).getUTCDay()
    )))]
    if (weekdays.length) {
      database.insert(schema.sessionAssignmentWeekdays).values(weekdays.map((weekday) => ({
        id: ids(),
        assignmentId,
        weekday,
      }))).run()
    }
    if (occurrences.length) {
      database.insert(schema.sessionOccurrences).values(occurrences.map((occurrence) => ({
        id: ids(),
        createdAt: onboardingNow,
        durationMinutes: 60,
        occurrenceDate: occurrence.date,
        seriesId,
        startsAt: new Date(`${occurrence.date}T${occurrence.startTime ?? "06:00"}:00+05:30`),
        status: occurrence.status ?? "scheduled",
        venue: "SMBA Court",
      }))).run()
    }
    return playerId
  }

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      idempotencyKey: "activate-onboarding-finance",
      trackingMonth: "2026-08",
    }, { coachId, createId: ids, database, now: onboardingNow })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("atomically issues registration and the current first month without duplicates", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-15",
      name: "Current Month Player",
      occurrences: [
        "03", "05", "07", "10", "12", "14", "17", "19", "21", "24", "26", "28",
      ].map((day) => ({ date: `2026-08-${day}` })),
    })
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)

    const input = {
      academyPlan: "weekday-3-day" as const,
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday" as const,
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-current-month-onboarding",
      level: "Beginner" as const,
      playerId,
    }
    const completed = finance.completePlayerOnboardingFinance(input, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })
    expect(completed).toMatchObject({
      firstMonthlyChargeId: expect.any(String),
      firstMonthlyFeePaise: 145_800,
      firstMonthlyRemainingSessions: 5,
      firstMonthlyTotalSessions: 12,
      registrationChargeId: expect.any(String),
      reused: false,
    })
    expect(finance.getPlayerFeeRecord(playerId, { database, now: onboardingNow })).toMatchObject({
      registrationCharge: {
        dueDate: "2026-08-18",
        originalAmountPaise: 100_000,
      },
      monthlyCharges: [expect.objectContaining({
        billingPeriod: "2026-08",
        dueDate: "2026-08-21",
        originalAmountPaise: 145_800,
      })],
    })

    expect(finance.completePlayerOnboardingFinance(input, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })).toMatchObject({ reused: true })
    expect(finance.prepareMonthlyCharges({
      idempotencyKey: "issue-august-after-onboarding",
      period: "2026-08",
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })).toMatchObject({ alreadyPrepared: 1, createdChargeIds: [], ready: 0 })
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(2)

    finance.prepareMonthlyCharges({
      idempotencyKey: "issue-september-after-prorated-onboarding",
      period: "2026-09",
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: new Date("2026-09-01T10:00:00+05:30"),
    })
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).get()?.originalAmountPaise).toBe(350_000)
  })

  it("defers a future first month to that month’s normal bulk issue", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      name: "Future Month Player",
      occurrences: ["02", "04", "07"].map((day) => ({ date: `2026-09-${day}` })),
    })
    const completed = finance.completePlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-09-01",
      idempotencyKey: "complete-future-month-onboarding",
      level: "Beginner",
      playerId,
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })
    expect(completed).toMatchObject({ firstMonthlyChargeId: null })
    expect(finance.getPlayerFeeRecord(playerId, { database, now: onboardingNow }))
      .toMatchObject({ registrationCharge: expect.any(Object), monthlyCharges: [] })

    const september = finance.prepareMonthlyCharges({
      idempotencyKey: "issue-september-fees",
      period: "2026-09",
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: new Date("2026-09-01T10:00:00+05:30"),
    })
    expect(september).toMatchObject({ alreadyPrepared: 1, ready: 1 })
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).all()).toHaveLength(1)
  })

  it("rolls back every finance record when the selected month has no matching session", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      name: "Invalid Month Player",
      occurrences: [{ date: "2026-09-02" }],
    })
    expect(() => finance.completePlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "reject-invalid-first-month",
      level: "Beginner",
      playerId,
    }, {
      coachId,
      createFeeReference: references,
      createId: ids,
      database,
      now: onboardingNow,
    })).toThrow(expect.objectContaining({ code: "SETUP_REQUIRED", field: "effectiveFrom" }))
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
  })

  it("counts a later same-day session and excludes cancelled training days", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Same Day Player",
      occurrences: [
        { date: "2026-08-04" },
        { date: "2026-08-11" },
        { date: "2026-08-18", startTime: "18:00" },
        { date: "2026-08-25", status: "cancelled" },
      ],
    })
    const completed = finance.completePlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-same-day-onboarding",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow })

    expect(completed).toMatchObject({
      firstMonthlyFeePaise: 116_700,
      firstMonthlyRemainingSessions: 1,
      firstMonthlyTotalSessions: 3,
    })
  })

  it("creates no joining-month fee when no sessions remain and starts the plan next month", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "After Sessions Player",
      occurrences: [{ date: "2026-08-04" }, { date: "2026-08-11" }],
    })
    const completed = finance.completePlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "complete-after-sessions-onboarding",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow })

    expect(completed).toMatchObject({
      firstMonthlyChargeId: null,
      firstMonthlyFeePaise: 0,
      firstMonthlyRemainingSessions: 0,
      firstMonthlyTotalSessions: 2,
    })
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).get()?.effectiveFrom).toBe("2026-09-01")
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.type, "monthly_training"),
    )).all()).toHaveLength(0)
  })

  it("rolls back onboarding finance when the assigned calendar has no scheduled sessions", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-08-01",
      name: "Missing Calendar Player",
    })
    expect(() => finance.completePlayerOnboardingFinance({
      academyPlan: "weekday-3-day",
      agreedMonthlyFeePaise: 350_000,
      batch: "Weekday",
      effectiveFrom: "2026-08-01",
      idempotencyKey: "reject-missing-calendar",
      level: "Beginner",
      playerId,
    }, { coachId, createFeeReference: references, createId: ids, database, now: onboardingNow }))
      .toThrow(expect.objectContaining({ code: "SETUP_REQUIRED", field: "effectiveFrom" }))
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
    expect(database.select().from(schema.financialCharges).where(eq(
      schema.financialCharges.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
  })

  it("rounds the joining-month fraction to the nearest whole rupee", () => {
    expect(calculateProratedSessionFee(350_000, 5, 12)).toBe(145_800)
    expect(calculateProratedSessionFee(350_000, 12, 12)).toBe(350_000)
    expect(calculateProratedSessionFee(350_000, 0, 12)).toBe(0)
    expect(() => calculateProratedSessionFee(350_000, 13, 12)).toThrow(
      "Invalid session fee proration.",
    )
  })
})
