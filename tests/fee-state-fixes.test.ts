import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-fee-state-fixes-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * The fee problems the state-machine audit of 12 Nov 2026 found, each pinned
 * at the sequence of head-coach actions that used to produce it.
 */
describe("fee changes reach the fee the family is billed", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let changes: typeof import("@/lib/training/changes")
  let fees: typeof import("@/lib/training/fees")
  let finance: typeof import("@/lib/finance/service")
  let summaries: typeof import("@/lib/training/member-summaries")
  let plan: typeof import("@/lib/training/this-month-fee-plan")
  let sessions: typeof import("@/lib/sessions/service")
  let coachId: string
  let morning: string
  let evening: string
  let ending: string

  // Monday 5 October 2026, mid-morning in India; October's fees are issued.
  const now = new Date("2026-10-05T05:00:00.000Z")
  const players = {
    ender: "21000000-0000-4000-8000-0000000000b1",
    firstDay: "21000000-0000-4000-8000-0000000000b2",
    full: "21000000-0000-4000-8000-0000000000b3",
    leaver: "21000000-0000-4000-8000-0000000000b4",
    percent: "21000000-0000-4000-8000-0000000000b5",
    stayer: "21000000-0000-4000-8000-0000000000b6",
    twice: "21000000-0000-4000-8000-0000000000b7",
    changer: "21000000-0000-4000-8000-0000000000b8",
    markedLeaver: "21000000-0000-4000-8000-0000000000b9",
  }
  let nextMutation = 0
  const mutationId = () => `00000000-0000-4000-8000-${String(nextMutation += 1).padStart(12, "0")}`
  const context = (at = now) => ({ coachId, database, now: at })
  const fiveDay = { academyPlan: "weekday-5-day" as const, batch: "Weekday" as const, level: "Beginner" as const }
  const threeDay = { academyPlan: "weekday-3-day" as const, batch: "Weekday" as const, level: "Beginner" as const }

  function addPlayer(id: string, name: string, serial: number, seriesId: string) {
    database.insert(schema.accounts).values({
      id,
      fullName: name,
      normalizedName: name.toLowerCase(),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({ serial, accountId: id, createdAt: now }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      ...fiveDay,
      status: "active",
      trainingStartOn: "2026-07-01",
      onboardingCompletedAt: now,
      updatedAt: now,
    }).run()
    const assignmentId = `assignment-${id}`
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: id,
      seriesId,
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    for (const weekday of [1, 2, 3, 4, 5]) {
      database.insert(schema.sessionAssignmentWeekdays).values({
        id: `${assignmentId}-${weekday}`,
        assignmentId,
        weekday,
      }).run()
    }
  }

  function octoberCharge(playerId: string) {
    return database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-10"),
    )).get()!
  }

  function due(playerId: string, period = "2026-10") {
    const record = finance.getPlayerFeeRecord(playerId, { database, now })
    return record?.monthlyCharges.find((charge) => charge.billingPeriod === period)?.outstandingPaise
  }

  function giveConcession(playerId: string, percent: number) {
    const concession = finance.createConcession({
      mode: "recurring",
      mutationId: mutationId(),
      playerId,
      reason: "Concession from the head coach",
      startsPeriod: "2026-10",
      value: percent * 100,
      valueKind: "percentage",
    }, context())
    finance.applyConcession({
      chargeId: octoberCharge(playerId).id,
      concessionId: concession.concession.id,
      expectedChargeRevision: octoberCharge(playerId).recordRevision,
      expectedConcessionRevision: concession.concession.recordRevision,
      mutationId: mutationId(),
    }, context())
  }

  function changeThisMonth(playerId: string, profile: typeof fiveDay | typeof threeDay, monthlyFeePaise: number) {
    const result = changes.changeScheduleThisMonth({
      ...profile,
      monthlyFeePaise,
      playerId,
      seriesId: profile.academyPlan === "weekday-3-day" ? evening : morning,
      startsOn: "2026-10-05",
      weekdays: profile.academyPlan === "weekday-3-day" ? [1, 3, 5] : [1, 2, 3, 4, 5],
    }, context())
    if ("ok" in result && result.ok === false) throw new Error(JSON.stringify(result))
    return result as import("@/lib/training/changes").ChangeThisMonthResult
  }

  function previewedThisMonth(playerId: string, newFeePaise: number) {
    const fee = summaries.listMemberTrainingSummaries([playerId], { database, now }).summaries[playerId].fee
    return plan.planThisMonthFeeCorrection(fee!.thisMonth!.basis!, newFeePaise).newAmountPaise
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    changes = await import("@/lib/training/changes")
    fees = await import("@/lib/training/fees")
    finance = await import("@/lib/finance/service")
    summaries = await import("@/lib/training/member-summaries")
    plan = await import("@/lib/training/this-month-fee-plan")
    sessions = await import("@/lib/sessions/service")
    const accountService = await import("@/lib/auth/account-service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    const series = (startTime: string) => sessions.createSessionSeriesRecords({
      coachId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-07-01",
        endsOn: "2027-03-31",
        weekdays: [1, 2, 3, 4, 5],
        startTime,
        durationMinutes: 60,
      },
    })
    morning = series("06:00")
    evening = series("16:00")
    ending = series("18:00")

    addPlayer(players.ender, "Esha Rao", 9101, ending)
    addPlayer(players.firstDay, "Farhan Ali", 9102, morning)
    addPlayer(players.full, "Gita Menon", 9103, morning)
    addPlayer(players.leaver, "Hari Nair", 9104, morning)
    addPlayer(players.percent, "Isha Das", 9105, morning)
    addPlayer(players.stayer, "Jay Patel", 9106, morning)
    addPlayer(players.twice, "Kiran Shah", 9107, morning)
    addPlayer(players.changer, "Lata Rao", 9108, morning)
    addPlayer(players.markedLeaver, "Mira Iyer", 9109, morning)

    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-fee-state-fixes" }, context())
    for (const playerId of Object.values(players)) {
      finance.createOrReplaceFeeAgreement({
        ...fiveDay,
        agreedMonthlyFeePaise: 400_000,
        effectiveFrom: "2026-07-01",
        idempotencyKey: `plan-${playerId}`,
        playerId,
      }, context())
    }
    finance.prepareMonthlyCharges({ period: "2026-10", idempotencyKey: "prepare-october-fixes" }, context())
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("will not issue next month's fees before that month begins", () => {
    expect(() => finance.prepareMonthlyCharges({
      period: "2026-11",
      idempotencyKey: "prepare-november-early",
    }, context())).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      message: "November 2026 fees can be issued from the 1st of that month.",
    }))
    expect(database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-11")).all()).toHaveLength(0)
  })

  it("lands a second change in the same month on the fee the coach confirmed", () => {
    expect(due(players.twice)).toBe(400_000)
    expect(previewedThisMonth(players.twice, 250_000)).toBe(250_000)
    expect(changeThisMonth(players.twice, threeDay, 250_000).newAmountPaise).toBe(250_000)

    // Changing back used to scale ₹4,000 against the ₹2,500 plan and leave ₹2,100.
    expect(previewedThisMonth(players.twice, 400_000)).toBe(400_000)
    expect(changeThisMonth(players.twice, fiveDay, 400_000).newAmountPaise).toBe(400_000)
    expect(due(players.twice)).toBe(400_000)
  })

  it("keeps a percentage concession at its share of the new fee", () => {
    giveConcession(players.percent, 20)
    expect(due(players.percent)).toBe(320_000)

    // 20% off ₹3,000 is ₹2,400; the old sum left ₹2,200 and the form promised another figure.
    expect(previewedThisMonth(players.percent, 300_000)).toBe(240_000)
    expect(changeThisMonth(players.percent, threeDay, 300_000).newAmountPaise).toBe(240_000)
    expect(due(players.percent)).toBe(240_000)

    expect(previewedThisMonth(players.percent, 450_000)).toBe(360_000)
    expect(changeThisMonth(players.percent, fiveDay, 450_000).newAmountPaise).toBe(360_000)
    expect(due(players.percent)).toBe(360_000)
  })

  it("leaves a full concession owing nothing whichever way the fee moves", () => {
    giveConcession(players.full, 100)
    expect(due(players.full)).toBe(0)

    expect(previewedThisMonth(players.full, 300_000)).toBe(0)
    changeThisMonth(players.full, threeDay, 300_000)
    expect(due(players.full)).toBe(0)

    // Raising the fee used to add the whole increase to a fee that was meant to be free.
    expect(previewedThisMonth(players.full, 450_000)).toBe(0)
    changeThisMonth(players.full, fiveDay, 450_000)
    expect(due(players.full)).toBe(0)
  })

  it("still offers the unused-days refund after \"They have left already\" with fees stopped", () => {
    const charge = octoberCharge(players.leaver)
    const payment = finance.recordAllocatedPayment({
      allocations: [{ amountPaise: 400_000, chargeId: charge.id, expectedChargeRevision: charge.recordRevision }],
      amountPaise: 400_000,
      method: "cash",
      mutationId: mutationId(),
      playerId: players.leaver,
      receivedOn: "2026-10-02",
    }, context())
    changes.endTrainingNow({ playerId: players.leaver, stopFees: true }, context())
    const ended = database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, players.leaver)).get()!
    expect(ended).toMatchObject({ effectiveTo: "2026-10-31", status: "ended" })

    const record = finance.getCoachFinancePlayerRecord(players.leaver, context())
    expect(record?.coachManagement?.receipts[0]?.canRefund).toBe(true)
    const preview = finance.previewRefundAllocations({
      amountPaise: 100_000,
      expectedPaymentRevision: 0,
      paymentId: payment.receipt.id,
      withdrawalEffectiveOn: "2026-10-05",
    }, context())
    finance.recordRefund({
      allocations: preview.allocations.map(({ amountPaise, paymentAllocationId }) => ({ amountPaise, paymentAllocationId })),
      amountPaise: 100_000,
      expectedAgreementRevision: preview.allocations[0]!.expectedAgreementRevision,
      expectedChargeRevision: preview.allocations[0]!.expectedChargeRevision,
      expectedPaymentRevision: 0,
      method: "cash",
      mutationId: mutationId(),
      paymentId: payment.receipt.id,
      refundedOn: "2026-10-05",
      withdrawalEffectiveOn: "2026-10-05",
    }, context())
    // The plan's end moves back to the day the family left.
    expect(database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.id, ended.id)).get()?.effectiveTo).toBe("2026-10-05")
  })

  it("offers the unused-days refund the same day to a player who left after today's attendance was marked", () => {
    const charge = octoberCharge(players.markedLeaver)
    const payment = finance.recordAllocatedPayment({
      allocations: [{ amountPaise: 400_000, chargeId: charge.id, expectedChargeRevision: charge.recordRevision }],
      amountPaise: 400_000,
      method: "cash",
      mutationId: mutationId(),
      playerId: players.markedLeaver,
      receivedOn: "2026-10-02",
    }, context())
    const todaySession = database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.seriesId, morning),
      eq(schema.sessionOccurrences.occurrenceDate, "2026-10-05"),
    )).get()!
    database.insert(schema.sessionAttendanceRecords).values({
      accountId: players.markedLeaver,
      choice: "present",
      createdAt: now,
      id: "marked-leaver-today",
      markedByAccountId: coachId,
      occurrenceId: todaySession.id,
      updatedAt: now,
    }).run()
    changes.endTrainingNow({ playerId: players.markedLeaver, stopFees: true }, context())
    // Today's mark stays, so the place covers today and ends tomorrow.
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, players.markedLeaver)).get()?.effectiveTo).toBe("2026-10-06")

    expect(() => finance.previewRefundAllocations({
      amountPaise: 100_000,
      expectedPaymentRevision: 0,
      paymentId: payment.receipt.id,
      withdrawalEffectiveOn: "2026-10-05",
    }, context())).not.toThrow()
  })

  it("still offers the unused-days refund after a level or plan change this month", () => {
    changeThisMonth(players.changer, threeDay, 300_000)
    const charge = octoberCharge(players.changer)
    finance.recordAllocatedPayment({
      allocations: [{ amountPaise: 300_000, chargeId: charge.id, expectedChargeRevision: charge.recordRevision }],
      amountPaise: 300_000,
      method: "cash",
      mutationId: mutationId(),
      playerId: players.changer,
      receivedOn: "2026-10-05",
    }, context())
    changes.endTrainingNow({ playerId: players.changer, stopFees: true }, context())
    const record = finance.getCoachFinancePlayerRecord(players.changer, context())
    expect(record?.coachManagement?.receipts[0]?.canRefund).toBe(true)
  })

  it("does not offer a withdrawal refund when a newer fee plan replaced the old one", () => {
    const charge = octoberCharge(players.stayer)
    finance.recordAllocatedPayment({
      allocations: [{ amountPaise: 400_000, chargeId: charge.id, expectedChargeRevision: charge.recordRevision }],
      amountPaise: 400_000,
      method: "cash",
      mutationId: mutationId(),
      playerId: players.stayer,
      receivedOn: "2026-10-02",
    }, context())
    expect(fees.changeMonthlyFee({
      idempotencyKey: "stayer-new-fee",
      monthlyFeePaise: 450_000,
      playerId: players.stayer,
    }, context())).toMatchObject({ startsOn: "2026-11-01" })
    const record = finance.getCoachFinancePlayerRecord(players.stayer, context())
    expect(record?.coachManagement?.receipts[0]?.canRefund).toBe(false)
  })

  it("tells the coach a fee change made on the 1st takes that month", () => {
    const secondNovember = new Date("2026-11-02T05:00:00.000Z")
    expect(summaries.listMemberTrainingSummaries([players.firstDay], { database, now: secondNovember })
      .summaries[players.firstDay].fee?.feeChangeStartsOn).toBe("2026-12-01")

    const firstNovember = new Date("2026-11-01T05:00:00.000Z")
    expect(summaries.listMemberTrainingSummaries([players.firstDay], { database, now: firstNovember })
      .summaries[players.firstDay].fee?.feeChangeStartsOn).toBe("2026-11-01")
    expect(fees.changeMonthlyFee({
      idempotencyKey: "first-day-new-fee",
      monthlyFeePaise: 450_000,
      playerId: players.firstDay,
    }, context(firstNovember))).toMatchObject({ startsOn: "2026-11-01" })

    // A slip fixed the same morning corrects that month, instead of waiting for next month.
    expect(fees.changeMonthlyFee({
      idempotencyKey: "first-day-fixed-fee",
      monthlyFeePaise: 350_000,
      playerId: players.firstDay,
    }, context(firstNovember))).toMatchObject({ startsOn: "2026-11-01" })
    const plans = database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, players.firstDay)).all()
    expect(plans.filter((agreement) => agreement.effectiveFrom >= "2026-11-01"))
      .toEqual([expect.objectContaining({ agreedMonthlyFeePaise: 350_000, status: "active" })])
  })

  it("bills the days trained before a schedule was ended, even if the month was not yet issued", () => {
    // Tuesday 10 November, before the 18:00 session.
    const tenthNovember = new Date("2026-11-10T05:00:00.000Z")
    sessions.endSessionSeriesRecords({ coachId, database, now: tenthNovember, seriesId: ending, stopFees: false })

    const prepared = finance.prepareMonthlyCharges({
      period: "2026-11",
      idempotencyKey: "prepare-november-after-ending",
    }, context(tenthNovember))
    expect(prepared.awaitingAssignment).toBe(0)
    const november = database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, players.ender),
      eq(schema.financialCharges.billingPeriod, "2026-11"),
    )).all()
    expect(november).toEqual([expect.objectContaining({ originalAmountPaise: 400_000 })])

    // The month after the schedule ended has no training, so no fee.
    const december = finance.getCoachMonthlyPreparationPreview("2026-12", context(tenthNovember))
    expect(december.awaitingAssignment).toBeGreaterThan(0)
  })
})
