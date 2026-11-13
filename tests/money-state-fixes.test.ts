import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-money-state-fixes-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * The fee plan, refund, receipt and fee status problems the state-machine
 * audit of 12 Nov 2026 found (M111-M130), each pinned at the head-coach
 * actions that used to produce it, and the head coach's decision of 13 Nov
 * 2026: a withdrawal refund is recorded only after the player's training has
 * been ended in Members, and reversing one puts everything back.
 */
describe("fee plans, withdrawal refunds, receipts and fee status", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let changes: typeof import("@/lib/training/changes")
  let fees: typeof import("@/lib/training/fees")
  let finance: typeof import("@/lib/finance/service")
  let documents: typeof import("@/lib/finance/documents")
  let viewModel: typeof import("@/components/coach/financials/view-model")
  let coachId: string
  let morning: string

  // Monday 5 October 2026, mid-morning in India; October's fees are issued.
  const now = new Date("2026-10-05T05:00:00.000Z")
  const players = {
    breaker: "31000000-0000-4000-8000-0000000000c1",
    changer: "31000000-0000-4000-8000-0000000000c2",
    concession: "31000000-0000-4000-8000-0000000000c3",
    firstDay: "31000000-0000-4000-8000-0000000000c4",
    keeper: "31000000-0000-4000-8000-0000000000c5",
    noPlan: "31000000-0000-4000-8000-0000000000c6",
    partial: "31000000-0000-4000-8000-0000000000c7",
    split: "31000000-0000-4000-8000-0000000000c8",
    stopper: "31000000-0000-4000-8000-0000000000c9",
    waived: "31000000-0000-4000-8000-0000000000ca",
    legacy: "31000000-0000-4000-8000-0000000000cb",
    returner: "31000000-0000-4000-8000-0000000000cc",
    rejoiner: "31000000-0000-4000-8000-0000000000cd",
  }
  const serials: Record<string, number> = {}
  let nextMutation = 0
  const mutationId = () => `00000000-0000-4000-8000-${String(nextMutation += 1).padStart(12, "0")}`
  const context = (at = now) => ({ coachId, database, now: at })
  const fiveDay = { academyPlan: "weekday-5-day" as const, batch: "Weekday" as const, level: "Beginner" as const }

  function addPlayer(id: string, name: string, serial: number) {
    serials[id] = serial
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
      seriesId: morning,
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

  const academyId = (playerId: string) => `SMBA#${String(serials[playerId]).padStart(4, "0")}`

  function charge(playerId: string, period: string) {
    return database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, period),
      eq(schema.financialCharges.lifecycle, "issued"),
    )).get()!
  }

  function plan(playerId: string) {
    return database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()
  }

  function pay(playerId: string, amountPaise: number, receivedOn: string, at = now) {
    const october = charge(playerId, receivedOn.slice(0, 7))
    return finance.recordAllocatedPayment({
      allocations: [{ amountPaise, chargeId: october.id, expectedChargeRevision: october.recordRevision }],
      amountPaise,
      method: "cash",
      mutationId: mutationId(),
      playerId,
      receivedOn,
    }, context(at))
  }

  function coachRecord(playerId: string, at = now) {
    const record = finance.getCoachFinancePlayerRecord(playerId, context(at))
    if (!record) throw new Error("The player's fee record is unavailable.")
    return record
  }

  function refund(paymentId: string, amountPaise: number, withdrawalEffectiveOn: string, at = now) {
    const preview = finance.previewRefundAllocations({
      amountPaise,
      expectedPaymentRevision: 0,
      paymentId,
      withdrawalEffectiveOn,
    }, context(at))
    return finance.recordRefund({
      allocations: preview.allocations.map(({ amountPaise: share, paymentAllocationId }) => ({
        amountPaise: share,
        paymentAllocationId,
      })),
      amountPaise,
      expectedAgreementRevision: preview.allocations[0]!.expectedAgreementRevision,
      expectedChargeRevision: preview.allocations[0]!.expectedChargeRevision,
      expectedPaymentRevision: 0,
      method: "cash",
      mutationId: mutationId(),
      paymentId,
      refundedOn: withdrawalEffectiveOn,
      withdrawalEffectiveOn,
    }, context(at))
  }

  function reverse(refundId: string, at = now) {
    return finance.reverseRefund({
      expectedRefundRevision: 0,
      mutationId: mutationId(),
      reason: "Recorded by mistake",
      refundId,
    }, context(at))
  }

  function deskRow(playerId: string, period: string, at = now) {
    return finance.getCoachFinanceRapidDesk({
      period,
      query: academyId(playerId),
      scope: "all",
    }, context(at)).players.find((player) => player.playerId === playerId)
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    changes = await import("@/lib/training/changes")
    fees = await import("@/lib/training/fees")
    finance = await import("@/lib/finance/service")
    documents = await import("@/lib/finance/documents")
    viewModel = await import("@/components/coach/financials/view-model")
    const sessions = await import("@/lib/sessions/service")
    const accountService = await import("@/lib/auth/account-service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    morning = sessions.createSessionSeriesRecords({
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
        startTime: "06:00",
        durationMinutes: 60,
      },
    })

    Object.entries(players).forEach(([label, id], index) => {
      addPlayer(id, `Money ${label}`, 9301 + index)
    })

    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-money-fixes" }, context())
    for (const playerId of Object.values(players)) {
      if (playerId === players.noPlan) continue
      finance.createOrReplaceFeeAgreement({
        ...fiveDay,
        agreedMonthlyFeePaise: 400_000,
        effectiveFrom: "2026-07-01",
        idempotencyKey: `plan-${playerId}`,
        playerId,
      }, context())
    }
    finance.prepareMonthlyCharges({ period: "2026-10", idempotencyKey: "prepare-october-money" }, context())
  }, 60_000)

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("refuses a withdrawal refund while the player is still training, and says where to end it", () => {
    const payment = pay(players.keeper, 400_000, "2026-10-02")
    const before = coachRecord(players.keeper).coachManagement!.receipts[0]!
    expect(before).toMatchObject({ canRefund: false, refundNeedsTrainingEnded: true })

    const refusal = expect.objectContaining({
      code: "CONFLICT",
      message: expect.stringContaining("End this player’s training in Members first"),
    })
    expect(() => finance.previewRefundAllocations({
      amountPaise: 50_000,
      expectedPaymentRevision: 0,
      paymentId: payment.receipt.id,
      withdrawalEffectiveOn: "2026-10-04",
    }, context())).toThrow(refusal)
    expect(() => finance.recordRefund({
      allocations: [{ amountPaise: 50_000, paymentAllocationId: payment.receipt.allocations[0]!.id }],
      amountPaise: 50_000,
      expectedAgreementRevision: 0,
      expectedChargeRevision: 1,
      expectedPaymentRevision: 0,
      method: "cash",
      mutationId: mutationId(),
      paymentId: payment.receipt.id,
      refundedOn: "2026-10-04",
      withdrawalEffectiveOn: "2026-10-04",
    }, context())).toThrow(refusal)
    expect(plan(players.keeper)[0]).toMatchObject({ effectiveTo: null, status: "active" })
  })

  it("puts a stopped plan back to the end of its month when the refund is reversed", () => {
    const payment = pay(players.stopper, 400_000, "2026-10-02")
    changes.endTrainingNow({ playerId: players.stopper, stopFees: true }, context())
    expect(plan(players.stopper)[0]).toMatchObject({ effectiveTo: "2026-10-31", status: "ended" })
    const ending = viewModel.toPlayerFinancialLedgerView(coachRecord(players.stopper)).feePlan
    expect(ending).toMatchObject({ effectiveTo: "2026-10-31", standing: "ending" })

    const recorded = refund(payment.receipt.id, 50_000, "2026-10-04")
    expect(plan(players.stopper)[0]).toMatchObject({ effectiveTo: "2026-10-04", status: "ended" })
    // A player who has left is not "onboarding in progress".
    const left = viewModel.toPlayerFinancialLedgerView(coachRecord(players.stopper))
    expect(left.feePlan).toMatchObject({ agreedMonthlyFeePaise: 400_000, standing: "ended" })

    const planEntries = database.select().from(schema.financialAuditEvents)
      .where(eq(schema.financialAuditEvents.entityId, plan(players.stopper)[0]!.id)).all()
    expect(planEntries.filter((entry) => entry.eventType === "fee_agreement_ended")
      .some((entry) => entry.metadata.includes("Ended by mid-term withdrawal refund"))).toBe(true)
    expect(coachRecord(players.stopper).coachManagement!.refunds[0]).toMatchObject({
      restoresFeePlan: true,
    })

    reverse(recorded.refund.id)
    expect(plan(players.stopper)[0]).toMatchObject({ effectiveTo: "2026-10-31", status: "ended" })
  })

  it("sends the coach to cancel a booked start, not to End training, before a refund", () => {
    const payment = pay(players.returner, 400_000, "2026-10-02")
    changes.endTrainingNow({ playerId: players.returner, stopFees: true }, context())
    // A return booked for 1 November, with no place now: Members offers no End
    // training for this player, and the server refuses it.
    const bookedId = "booked-return-returner"
    database.insert(schema.trainingChanges).values({
      id: bookedId,
      playerAccountId: players.returner,
      kind: "change",
      effectiveOn: "2026-11-01",
      status: "scheduled",
      ...fiveDay,
      seriesId: morning,
      weekdays: "[1,2,3,4,5]",
      monthlyFeePaise: 400_000,
      createdByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    expect(coachRecord(players.returner).coachManagement!.receipts[0]).toMatchObject({
      canRefund: false,
      refundNeedsTrainingEnded: true,
    })
    expect(() => finance.previewRefundAllocations({
      amountPaise: 50_000,
      expectedPaymentRevision: 0,
      paymentId: payment.receipt.id,
      withdrawalEffectiveOn: "2026-10-04",
    }, context())).toThrow(expect.objectContaining({
      code: "CONFLICT",
      message: expect.stringContaining("Cancel scheduled change"),
    }))

    changes.cancelTrainingChange({ changeId: bookedId }, context())
    expect(coachRecord(players.returner).coachManagement!.receipts[0]).toMatchObject({
      canRefund: true,
    })
  })

  it("says the fee plan stays ended when a newer plan stops a reversal putting it back", () => {
    const payment = pay(players.rejoiner, 400_000, "2026-10-02")
    changes.endTrainingNow({ playerId: players.rejoiner, stopFees: false }, context())
    const recorded = refund(payment.receipt.id, 50_000, "2026-10-04")
    expect(coachRecord(players.rejoiner).coachManagement!.refunds[0]).toMatchObject({
      restoresFeePlan: true,
    })
    // Back from 1 November on a new fee plan.
    finance.createOrReplaceFeeAgreement({
      ...fiveDay,
      agreedMonthlyFeePaise: 450_000,
      effectiveFrom: "2026-11-01",
      idempotencyKey: "plan-rejoiner-november",
      playerId: players.rejoiner,
    }, context())
    // The confirmation used to promise the plan back, and the reversal then
    // quietly left it ended.
    expect(coachRecord(players.rejoiner).coachManagement!.refunds[0]).toMatchObject({
      restoresFeePlan: false,
    })
    expect(reverse(recorded.refund.id)).toMatchObject({ feePlanRestored: false })
    expect(plan(players.rejoiner).find((row) => row.effectiveFrom === "2026-07-01"))
      .toMatchObject({ effectiveTo: "2026-10-04", status: "ended" })
  })

  it("lists a refund drawn from two receipts under both, each with its own share", () => {
    const first = pay(players.split, 150_000, "2026-10-01")
    const second = pay(players.split, 250_000, "2026-10-02")
    changes.endTrainingNow({ playerId: players.split, stopFees: false }, context())
    refund(first.receipt.id, 200_000, "2026-10-03")

    const receipts = coachRecord(players.split).coachManagement!.receipts
    const firstReceipt = receipts.find((item) => item.id === first.receipt.id)!
    const secondReceipt = receipts.find((item) => item.id === second.receipt.id)!
    expect(firstReceipt.refundedPaise).toBe(150_000)
    expect(firstReceipt.refunds).toEqual([
      expect.objectContaining({ amountPaise: 200_000, receiptAmountPaise: 150_000 }),
    ])
    // The second receipt used to show ₹500 refunded and no refund at all.
    expect(secondReceipt.refundedPaise).toBe(50_000)
    expect(secondReceipt.refunds).toEqual([
      expect.objectContaining({ amountPaise: 200_000, receiptAmountPaise: 50_000 }),
    ])
    expect(documents.getReceiptDocument(second.receipt.id, context())).toMatchObject({
      refundedPaise: 50_000,
      refunds: [expect.objectContaining({ amountPaise: 200_000, receiptAmountPaise: 50_000 })],
      status: "partially_refunded",
    })
  })

  it("shows the fee in force now, not a waiting fee change, as the agreed fee", () => {
    expect(fees.changeMonthlyFee({
      idempotencyKey: "changer-new-fee",
      monthlyFeePaise: 450_000,
      playerId: players.changer,
    }, context())).toMatchObject({ startsOn: "2026-11-01" })
    const record = coachRecord(players.changer)
    expect(record.feePlans.current?.agreedMonthlyFeePaise).toBe(400_000)
    expect(record.feePlans.upcoming?.agreedMonthlyFeePaise).toBe(450_000)
    expect(viewModel.toPlayerFinancialLedgerView(record).feePlan).toMatchObject({
      agreedMonthlyFeePaise: 400_000,
      standing: "ending",
      upcoming: { agreedMonthlyFeePaise: 450_000, effectiveFrom: "2026-11-01" },
    })
  })

  it("keeps a player whose registration fee was voided payable", () => {
    const registration = finance.resolveExistingRegistrationFee({
      idempotencyKey: "waived-registration",
      playerId: players.waived,
      status: "pending",
    }, context())
    finance.voidCharge({
      chargeId: registration.id,
      expectedChargeRevision: registration.recordRevision,
      idempotencyKey: "void-waived-registration",
      reason: "Registration waived",
    }, context())

    // October is still owed; the desk used to drop the player as "setup
    // required", so "Record payment" led to an empty desk.
    expect(deskRow(players.waived, "2026-10")).toMatchObject({ paymentEligible: true, status: "pending" })
    const record = coachRecord(players.waived)
    expect(finance.canRecordPaymentAtDesk(record, context())).toBe(true)
    expect(finance.getCoachFinanceRapidDesk({
      period: "2026-10",
      playerId: players.waived,
      query: academyId(players.waived),
    }, context()).selectedLedger?.playerId).toBe(players.waived)
  })

  it("reverses a voided fee's concession, so the one-off concession can go on its replacement", () => {
    const concession = finance.createConcession({
      mode: "one_off",
      mutationId: mutationId(),
      playerId: players.concession,
      reason: "One-off discount",
      value: 50_000,
      valueKind: "fixed",
    }, context())
    const october = charge(players.concession, "2026-10")
    const applied = finance.applyConcession({
      chargeId: october.id,
      concessionId: concession.concession.id,
      expectedChargeRevision: october.recordRevision,
      expectedConcessionRevision: concession.concession.recordRevision,
      mutationId: mutationId(),
    }, context())
    finance.voidCharge({
      chargeId: october.id,
      expectedChargeRevision: applied.charge.recordRevision,
      idempotencyKey: "void-concession-october",
      reason: "Issued at the wrong fee",
    }, context())
    expect(database.select().from(schema.concessionApplications)
      .where(eq(schema.concessionApplications.id, applied.applicationId)).get()?.reversedAt)
      .toBeInstanceOf(Date)

    finance.prepareMonthlyCharges({ period: "2026-10", idempotencyKey: "reissue-october-concession" }, context())
    const replacement = charge(players.concession, "2026-10")
    expect(replacement.id).not.toBe(october.id)
    const concessionNow = database.select().from(schema.concessions)
      .where(eq(schema.concessions.id, concession.concession.id)).get()!
    expect(finance.applyConcession({
      chargeId: replacement.id,
      concessionId: concession.concession.id,
      expectedChargeRevision: replacement.recordRevision,
      expectedConcessionRevision: concessionNow.recordRevision,
      mutationId: mutationId(),
    }, context()).charge.outstandingPaise).toBe(350_000)
  })

  it("lists a player who finished onboarding and trains with no fee plan as needing setup", () => {
    const workspace = finance.getCoachFinanceWorkspace({ period: "2026-10", view: "attention" }, context())
    expect(workspace.players.find((player) => player.playerId === players.noPlan))
      .toMatchObject({ paymentEligible: false, status: "setup_required" })
    expect(finance.getCoachFinanceDashboardSummary("2026-10", context()).attentionCount)
      .toBe(workspace.summary.attentionCount)
  })

  it("marks a part-paid fee overdue once its due date has passed", () => {
    pay(players.partial, 100_000, "2026-10-02")
    expect(deskRow(players.partial, "2026-10")).toMatchObject({ status: "partially_paid" })
    const lateOctober = new Date("2026-10-20T05:00:00.000Z")
    expect(deskRow(players.partial, "2026-10", lateOctober)).toMatchObject({
      outstandingPaise: 300_000,
      status: "overdue",
    })
    expect(finance.getPlayerFeeRecord(players.partial, { database, now: lateOctober })?.status)
      .toBe("overdue")
  })

  it("says a fee is not issued only for a player Issue fees would issue one for", () => {
    pay(players.changer, 400_000, "2026-10-02")
    // On a break with the fee plan kept: fee issuing passes them over.
    changes.endTrainingNow({ playerId: players.breaker, stopFees: false }, context())
    const secondNovember = new Date("2026-11-02T05:00:00.000Z")
    const register = finance.getFeeRegister({ mode: "monthly", period: "2026-11", limit: 100 }, context(secondNovember))
    // The register used to list them as "Not issued" every month.
    expect(register.rows.find((row) => row.playerId === players.breaker)).toBeUndefined()
    expect(register.rows.find((row) => row.playerId === players.changer)?.status).toBe("not_prepared")
    expect(deskRow(players.breaker, "2026-11", secondNovember)?.status).not.toBe("not_prepared")
    expect(deskRow(players.changer, "2026-11", secondNovember)?.status).toBe("not_prepared")
  })

  it("shows a player who trains with no fee plan as Setup required even with fees from before", () => {
    // A withdrawal refund recorded before 13 Nov 2026 while the player stayed
    // on a schedule: the fee plan ended on the withdrawal date, and October's
    // fee was already paid.
    pay(players.legacy, 400_000, "2026-10-02")
    const [legacyPlan] = plan(players.legacy)
    database.update(schema.feeAgreements)
      .set({ effectiveTo: "2026-10-04", status: "ended" })
      .where(eq(schema.feeAgreements.id, legacyPlan!.id)).run()
    // October is still covered by the plan.
    expect(deskRow(players.legacy, "2026-10")?.status).toBe("paid")

    const secondNovember = new Date("2026-11-02T05:00:00.000Z")
    // Their paid fees used to read "Paid", leaving them off every list.
    expect(deskRow(players.legacy, "2026-11", secondNovember)).toMatchObject({
      feePlanEnded: true,
      status: "setup_required",
    })
    const workspace = finance.getCoachFinanceWorkspace(
      { period: "2026-11", view: "attention" },
      context(secondNovember),
    )
    expect(workspace.players.map((player) => player.playerId)).toContain(players.legacy)
    expect(finance.getCoachFinanceDashboardSummary("2026-11", context(secondNovember)).attentionCount)
      .toBe(workspace.summary.attentionCount)
    // The dashboard count leads to the fee register, which lists them.
    const register = finance.getFeeRegister(
      { mode: "monthly", period: "2026-11", limit: 100 },
      context(secondNovember),
    )
    expect(register.rows.find((row) => row.playerId === players.legacy))
      .toMatchObject({ chargeId: null, status: "setup_required" })
    expect(finance.getFeeRegister(
      { mode: "monthly", period: "2026-11", limit: 100, statuses: ["setup_required"] },
      context(secondNovember),
    ).rows.map((row) => row.playerId)).toContain(players.legacy)
    // A player on a break with the fee plan kept is not missing a plan.
    expect(register.rows.find((row) => row.playerId === players.breaker)).toBeUndefined()

    const record = coachRecord(players.legacy, secondNovember)
    expect(record.status).toBe("setup_required")
  })

  it("does not offer a refund on the 1st, when every withdrawal date would be refused", () => {
    const firstNovember = new Date("2026-11-01T05:00:00.000Z")
    finance.prepareMonthlyCharges({ period: "2026-11", idempotencyKey: "prepare-november-money" }, context(firstNovember))
    pay(players.firstDay, 400_000, "2026-11-01", firstNovember)
    changes.endTrainingNow({ playerId: players.firstDay, stopFees: false }, context(firstNovember))
    expect(coachRecord(players.firstDay, firstNovember).coachManagement!.receipts
      .find((receipt) => receipt.receivedOn === "2026-11-01")).toMatchObject({
      canRefund: false,
      refundNeedsTrainingEnded: false,
      refundWindow: null,
    })
  })
})
