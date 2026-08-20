import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

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
  }: {
    assignmentFrom: string
    name: string
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
      startsOn: assignmentFrom,
      status: "active",
      title: `${name} series`,
      venue: "SMBA Court",
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: ids(),
      accountId: playerId,
      assignedAt: onboardingNow,
      assignedByAccountId: coachId,
      effectiveFrom: assignmentFrom,
      seriesId,
    }).run()
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
        originalAmountPaise: 350_000,
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
  })

  it("defers a future first month to that month’s normal bulk issue", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      name: "Future Month Player",
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
    expect(september).toMatchObject({ ready: 2 })
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).all()).toHaveLength(1)
  })

  it("rolls back every finance record when the selected month has no matching session", () => {
    const playerId = createAssessedPlayer({
      assignmentFrom: "2026-09-01",
      name: "Invalid Month Player",
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
})
