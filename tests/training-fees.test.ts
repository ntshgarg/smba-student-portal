import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-training-fees-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("fee changes and concessions from the player's record", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let fees: typeof import("@/lib/training/fees")
  let changes: typeof import("@/lib/training/changes")
  let summaries: typeof import("@/lib/training/member-summaries")
  let coachId: string
  let evening: string

  const now = new Date("2026-10-05T05:00:00.000Z")
  const playerId = "30000000-0000-4000-8000-0000000000b1"
  const otherId = "30000000-0000-4000-8000-0000000000b2"
  const context = () => ({ coachId, database, now })

  function addPlayer(id: string, name: string, serial: number) {
    database.insert(schema.accounts).values({
      id, fullName: name, normalizedName: name.toLowerCase(), requestedRole: "player", role: "player",
      approvalStatus: "approved", approvedAt: now, createdAt: now, updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({ serial, accountId: id, createdAt: now }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id, level: "Beginner", batch: "Weekday", academyPlan: "weekday-3-day", status: "active",
      trainingStartOn: "2026-07-01", onboardingCompletedAt: now, updatedAt: now,
    }).run()
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    fees = await import("@/lib/training/fees")
    changes = await import("@/lib/training/changes")
    summaries = await import("@/lib/training/member-summaries")
    const finance = await import("@/lib/finance/service")
    const accountService = await import("@/lib/auth/account-service")
    const sessions = await import("@/lib/sessions/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    coachId = accountService.findApprovedAccountByAcademyId("SMBA#0001")!.accountId
    evening = sessions.createSessionSeriesRecords({
      coachId, database, now,
      input: {
        programme: "Beginner", batch: "Weekday", venue: "SMBA Court", startsOn: "2026-07-01",
        endsOn: "2027-03-31", weekdays: [1, 3, 5], startTime: "16:00", durationMinutes: 60,
      },
    })
    for (const [id, name, serial] of [[playerId, "Kavya Rao", 9101], [otherId, "Dev Nair", 9102]] as const) {
      addPlayer(id, name, serial)
      database.insert(schema.sessionAssignments).values({
        id: `assignment-${id}`, accountId: id, seriesId: evening, effectiveFrom: "2026-07-01",
        effectiveTo: null, assignedByAccountId: coachId, assignedAt: now,
      }).run()
      for (const weekday of [1, 3, 5]) {
        database.insert(schema.sessionAssignmentWeekdays).values({
          id: `weekday-${id}-${weekday}`, assignmentId: `assignment-${id}`, weekday,
        }).run()
      }
    }
    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-training-fees" }, context())
    for (const id of [playerId, otherId]) {
      finance.createOrReplaceFeeAgreement({
        academyPlan: "weekday-3-day", agreedMonthlyFeePaise: 350_000, batch: "Weekday",
        effectiveFrom: "2026-07-01", idempotencyKey: `plan-fee-${id}`, level: "Beginner", playerId: id,
      }, context())
    }
    finance.prepareMonthlyCharges({ period: "2026-10", idempotencyKey: "prepare-fees-october" }, context())
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("starts a new fee next month and leaves this month's fee alone", () => {
    expect(fees.changeMonthlyFee({ idempotencyKey: "member-fee:one-change", monthlyFeePaise: 400_000, playerId }, context()))
      .toEqual({ startsOn: "2026-11-01" })
    const plans = database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()
      .sort((first, second) => first.effectiveFrom.localeCompare(second.effectiveFrom))
    expect(plans.map((plan) => [plan.effectiveFrom, plan.effectiveTo, plan.agreedMonthlyFeePaise]))
      .toEqual([["2026-07-01", "2026-10-31", 350_000], ["2026-11-01", null, 400_000]])
  })

  it("changes the waiting amount when a new fee is already set for next month", () => {
    fees.changeMonthlyFee({ idempotencyKey: "member-fee:two-change", monthlyFeePaise: 420_000, playerId }, context())
    const plans = database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()
    expect(plans).toHaveLength(2)
    expect(plans.find((plan) => plan.status === "active")?.agreedMonthlyFeePaise).toBe(420_000)
  })

  it("leaves the fee to a scheduled training change that carries its own", () => {
    changes.scheduleTrainingChange({
      academyPlan: "weekday-3-day", batch: "Weekday", level: "Beginner", monthlyFeePaise: 300_000,
      playerId: otherId, seriesId: evening, weekdays: [1, 3, 5],
    }, context())
    expect(() => fees.changeMonthlyFee({ idempotencyKey: "member-fee:blocked", monthlyFeePaise: 380_000, playerId: otherId }, context()))
      .toThrowError(/Edit that change instead/u)
  })

  it("gives a concession from next month, for one month or as a percentage, and stops it", () => {
    const one = fees.giveConcession({
      duration: "one", mutationId: "4b0b3f7e-2d0c-4d77-9a5e-1f8a7f1f0a01", playerId, value: 50_000, valueKind: "fixed",
    }, context())
    expect(one).toMatchObject({ endsPeriod: "2026-11", startsPeriod: "2026-11" })
    const row = database.select().from(schema.concessions)
      .where(eq(schema.concessions.id, one.concessionId)).get()
    expect(row).toMatchObject({ mode: "recurring", reason: "Concession from the head coach", value: 50_000 })

    fees.stopConcession({
      concessionId: one.concessionId, expectedRevision: row!.recordRevision,
      mutationId: "4b0b3f7e-2d0c-4d77-9a5e-1f8a7f1f0a02",
    }, context())
    expect(database.select().from(schema.concessions)
      .where(eq(schema.concessions.id, one.concessionId)).get()?.lifecycle).toBe("reversed")

    const percent = fees.giveConcession({
      duration: "months", months: 3, mutationId: "4b0b3f7e-2d0c-4d77-9a5e-1f8a7f1f0a03",
      playerId, value: 10, valueKind: "percentage",
    }, context())
    expect(percent).toMatchObject({ endsPeriod: "2027-01", startsPeriod: "2026-11" })
    expect(database.select().from(schema.concessions)
      .where(eq(schema.concessions.id, percent.concessionId)).get()?.value).toBe(1_000)
  })

  it("summarises each player's fee and waiting change for the directory", () => {
    const result = summaries.listMemberTrainingSummaries([playerId, otherId], { database, now })
    expect(result).toMatchObject({ financeActive: true, nextMonthStart: "2026-11-01", today: "2026-10-05" })
    expect(result.summaries[playerId].fee).toMatchObject({
      monthlyFeePaise: 350_000,
      nextMonthFeePaise: 420_000,
      concession: { valueKind: "percentage", value: 1_000 },
    })
    expect(result.summaries[playerId].fee?.thisMonth?.amountPaise).toBeGreaterThan(0)
    expect(result.summaries[otherId].scheduled).toMatchObject({ effectiveOn: "2026-11-01", kind: "change" })
    expect(result.summaries[otherId].fee?.nextMonthFeePaise).toBe(300_000)
  })
})
