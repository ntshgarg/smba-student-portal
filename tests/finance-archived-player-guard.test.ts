import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-archive-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "archive-guard.db")

function mutationId(value: number) {
  return `00000000-0000-4000-8002-${String(value).padStart(12, "0")}`
}

describe("Financials archived-player mutation guard", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")
  let nextSerial = 7_000
  let nextId = 0
  const createId = () => `archive-guard-id-${String(nextId += 1).padStart(4, "0")}`

  function createPlayer(label: string) {
    const playerId = `archive-${label}`
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: `${label} Player`,
      normalizedName: `${label.toLowerCase()} player`,
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      approvedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: nextSerial += 1,
      accountId: playerId,
      createdAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "active",
      joinedAt: now,
      updatedAt: now,
    }).run()
    const seriesId = `${playerId}-series`
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: `${label} Beginner Weekday`,
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-20",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: `${playerId}-assignment`,
      accountId: playerId,
      seriesId,
      effectiveFrom: "2026-08-20",
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    return playerId
  }

  function agreementInput(playerId: string, idempotencyKey: string) {
    return {
      playerId,
      academyPlan: "weekday-3-day" as const,
      level: "Beginner" as const,
      batch: "Weekday" as const,
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-08-01",
      monthlyDueDay: 5,
      idempotencyKey,
    }
  }

  function createCharge(
    playerId: string,
    agreementId: string,
    suffix: string,
    period: string,
  ) {
    const chargeId = `${playerId}-${suffix}`
    database.insert(schema.financialCharges).values({
      id: chargeId,
      feeReference: `SMBA-${suffix.toUpperCase().padEnd(8, "2").slice(0, 8)}`,
      playerAccountId: playerId,
      feeAgreementId: agreementId,
      type: "monthly_training",
      billingPeriod: period,
      description: `August fee ${suffix}`,
      originalAmountPaise: 400_000,
      currency: "INR",
      dueDate: `${period}-05`,
      lifecycle: "issued",
      recordRevision: 0,
      issuedByAccountId: coachId,
      issuedAt: now,
    }).run()
    return chargeId
  }

  function archivePlayer(playerId: string) {
    database.update(schema.accounts).set({
      archivedAt: now,
      archivedByAccountId: coachId,
      updatedAt: now,
    }).where(eq(schema.accounts.id, playerId)).run()
  }

  function ledgerCounts() {
    return {
      agreements: database.select().from(schema.feeAgreements).all().length,
      charges: database.select().from(schema.financialCharges).all().length,
      payments: database.select().from(schema.payments).all().length,
      allocations: database.select().from(schema.paymentAllocations).all().length,
      refunds: database.select().from(schema.refunds).all().length,
      refundAllocations: database.select().from(schema.refundAllocations).all().length,
      concessions: database.select().from(schema.concessions).all().length,
      concessionApplications: database.select().from(schema.concessionApplications).all().length,
      adjustments: database.select().from(schema.chargeAdjustments).all().length,
      audits: database.select().from(schema.financialAuditEvents).all().length,
    }
  }

  function expectUnavailable(action: () => unknown) {
    expect(action).toThrow(expect.objectContaining({ code: "PLAYER_UNAVAILABLE" }))
  }

  beforeAll(async () => {
    finance = await import("@/lib/finance/service")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "archive-guard-activation",
    }, { coachId, createId, database, now })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("rejects stale-tab and forged ledger mutations after the target player is archived", () => {
    const playerId = createPlayer("forged")
    const agreement = finance.createOrReplaceFeeAgreement(
      agreementInput(playerId, "archive-forged-agreement"),
      { coachId, createId, database, now },
    ).agreement
    const paymentChargeId = createCharge(playerId, agreement.id, "payment", "2026-08")

    const paymentInput = {
      playerId,
      amountPaise: 400_000,
      receivedOn: "2026-08-20",
      method: "upi" as const,
      allocations: [{
        chargeId: paymentChargeId,
        amountPaise: 400_000,
        expectedChargeRevision: 0,
      }],
      mutationId: mutationId(1),
    }
    const payment = finance.recordAllocatedPayment(paymentInput, {
      coachId, createId, database, now,
    })
    const paymentAllocation = database.select().from(schema.paymentAllocations)
      .where(eq(schema.paymentAllocations.paymentId, payment.receipt.id)).get()
    if (!paymentAllocation) throw new Error("The guard-test payment allocation is unavailable.")
    const refundInput = {
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      expectedChargeRevision: 1,
      expectedAgreementRevision: 0,
      amountPaise: 10_000,
      withdrawalEffectiveOn: "2026-08-20",
      refundedOn: "2026-08-20",
      method: "upi" as const,
      allocations: [{ paymentAllocationId: paymentAllocation.id, amountPaise: 10_000 }],
      mutationId: mutationId(2),
    }
    const refund = finance.recordRefund(refundInput, { coachId, createId, database, now })
    const continuingAgreement = finance.createOrReplaceFeeAgreement({
      ...agreementInput(playerId, "archive-forged-continuing-agreement"),
      effectiveFrom: "2026-09-01",
    }, { coachId, createId, database, now }).agreement
    const concessionChargeId = createCharge(
      playerId,
      continuingAgreement.id,
      "concession",
      "2026-09",
    )
    const adjustmentChargeId = createCharge(
      playerId,
      continuingAgreement.id,
      "adjustment",
      "2026-10",
    )
    const concession = finance.createConcession({
      playerId,
      mode: "one_off",
      valueKind: "fixed",
      value: 10_000,
      reason: "Guard test concession",
      mutationId: mutationId(3),
    }, { coachId, createId, database, now })
    const concessionApplication = finance.applyConcession({
      concessionId: concession.concession.id,
      chargeId: concessionChargeId,
      expectedConcessionRevision: 0,
      expectedChargeRevision: 0,
      mutationId: mutationId(4),
    }, { coachId, createId, database, now })
    finance.applyChargeAdjustment({
      chargeId: adjustmentChargeId,
      kind: "manual_credit",
      amountPaise: 5_000,
      reason: "Guard test adjustment",
      idempotencyKey: "archive-forged-adjustment",
    }, { coachId, createId, database, now })
    const adjustment = database.select().from(schema.chargeAdjustments)
      .where(eq(schema.chargeAdjustments.chargeId, adjustmentChargeId)).get()
    if (!adjustment) throw new Error("The guard-test Adjustment is unavailable.")

    archivePlayer(playerId)
    const before = ledgerCounts()
    const actions: Array<[string, () => unknown]> = [
      ["replace fee plan", () => finance.createOrReplaceFeeAgreement({
        ...agreementInput(playerId, "archive-forged-replacement"),
        effectiveFrom: "2026-11-01",
        expectedAgreementRevision: 0,
      }, { coachId, createId, database, now })],
      ["end fee plan", () => finance.endFeeAgreement({
        agreementId: continuingAgreement.id,
        effectiveThroughPeriod: "2026-09",
        reason: "Forged end",
        expectedRevision: 0,
        idempotencyKey: "archive-forged-end",
      }, { coachId, createId, database, now })],
      ["historical setup", () => finance.setupExistingPlayerFinance({
        ...agreementInput(playerId, "archive-forged-setup"),
        registrationStatus: "unresolved",
      }, { coachId, createId, database, now })],
      ["registration issue", () => finance.issueRegistrationChargeForApprovedPlayer({
        approvedAt: now,
        coachId,
        createId,
        database,
        playerId,
      })],
      ["payment preview", () => finance.previewPaymentAllocations({
        playerId,
        amountPaise: 1_000,
      }, { coachId, database, now })],
      ["allocated payment", () => finance.recordAllocatedPayment({
        playerId,
        amountPaise: 1_000,
        receivedOn: "2026-08-20",
        method: "cash",
        allocations: [{
          chargeId: adjustmentChargeId,
          amountPaise: 1_000,
          expectedChargeRevision: 1,
        }],
        mutationId: mutationId(10),
      }, { coachId, createId, database, now })],
      ["single-charge payment", () => finance.recordPayment({
        chargeId: adjustmentChargeId,
        expectedChargeRevision: 1,
        amountPaise: 1_000,
        receivedOn: "2026-08-20",
        method: "cash",
        idempotencyKey: "archive-forged-payment",
      }, { coachId, createId, database, now })],
      ["payment reversal", () => finance.reversePayment({
        paymentId: payment.receipt.id,
        reason: "Forged reversal",
        idempotencyKey: "archive-forged-payment-reversal",
      }, { coachId, createId, database, now })],
      ["refund preview", () => finance.previewRefundAllocations({
        paymentId: payment.receipt.id,
        expectedPaymentRevision: 1,
        amountPaise: 1_000,
        withdrawalEffectiveOn: "2026-08-20",
      }, { coachId, database, now })],
      ["refund", () => finance.recordRefund({
        ...refundInput,
        amountPaise: 1_000,
        allocations: [{ paymentAllocationId: paymentAllocation.id, amountPaise: 1_000 }],
        expectedPaymentRevision: 1,
        mutationId: mutationId(11),
      }, { coachId, createId, database, now })],
      ["refund reversal", () => finance.reverseRefund({
        refundId: refund.refund.id,
        expectedRefundRevision: 0,
        reason: "Forged Refund reversal",
        mutationId: mutationId(12),
      }, { coachId, createId, database, now })],
      ["concession", () => finance.createConcession({
        playerId,
        mode: "one_off",
        valueKind: "fixed",
        value: 1_000,
        reason: "Forged concession",
        mutationId: mutationId(13),
      }, { coachId, createId, database, now })],
      ["concession application", () => finance.applyConcession({
        concessionId: concession.concession.id,
        chargeId: concessionChargeId,
        expectedConcessionRevision: 1,
        expectedChargeRevision: 1,
        mutationId: mutationId(14),
      }, { coachId, createId, database, now })],
      ["concession application reversal", () => finance.reverseConcessionApplication({
        applicationId: concessionApplication.applicationId,
        reason: "Forged application reversal",
        mutationId: mutationId(15),
      }, { coachId, createId, database, now })],
      ["concession reversal", () => finance.reverseConcession({
        concessionId: concession.concession.id,
        expectedConcessionRevision: 1,
        reason: "Forged Concession reversal",
        mutationId: mutationId(16),
      }, { coachId, createId, database, now })],
      ["adjustment", () => finance.applyChargeAdjustment({
        chargeId: adjustmentChargeId,
        kind: "manual_credit",
        amountPaise: 1_000,
        reason: "Forged adjustment",
        idempotencyKey: "archive-forged-adjustment-two",
      }, { coachId, createId, database, now })],
      ["adjustment reversal", () => finance.reverseChargeAdjustment({
        adjustmentId: adjustment.id,
        reason: "Forged Adjustment reversal",
        idempotencyKey: "archive-forged-adjustment-reversal",
      }, { coachId, createId, database, now })],
      ["charge void", () => finance.voidCharge({
        chargeId: adjustmentChargeId,
        expectedChargeRevision: 1,
        reason: "Forged void",
        idempotencyKey: "archive-forged-void",
      }, { coachId, createId, database, now })],
      ["registration reconciliation", () => finance.resolveExistingRegistrationFee({
        playerId,
        status: "pending",
        idempotencyKey: "archive-forged-registration-resolution",
      }, { coachId, createId, database, now })],
    ]

    actions.forEach(([, action]) => expectUnavailable(action))
    expect(ledgerCounts()).toEqual(before)
  })

  it("keeps exact idempotent retries replayable after archival without new ledger writes", () => {
    const playerId = createPlayer("replay")
    const planInput = agreementInput(playerId, "archive-replay-agreement")
    const agreement = finance.createOrReplaceFeeAgreement(planInput, {
      coachId, createId, database, now,
    }).agreement
    const paymentChargeId = createCharge(playerId, agreement.id, "replaypay", "2026-08")

    const paymentInput = {
      playerId,
      amountPaise: 400_000,
      receivedOn: "2026-08-20",
      method: "upi" as const,
      allocations: [{
        chargeId: paymentChargeId,
        amountPaise: 400_000,
        expectedChargeRevision: 0,
      }],
      mutationId: mutationId(30),
    }
    const payment = finance.recordAllocatedPayment(paymentInput, {
      coachId, createId, database, now,
    })
    const paymentAllocation = database.select().from(schema.paymentAllocations)
      .where(eq(schema.paymentAllocations.paymentId, payment.receipt.id)).get()
    if (!paymentAllocation) throw new Error("The replay-test allocation is unavailable.")
    const refundInput = {
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      expectedChargeRevision: 1,
      expectedAgreementRevision: 0,
      amountPaise: 10_000,
      withdrawalEffectiveOn: "2026-08-20",
      refundedOn: "2026-08-20",
      method: "upi" as const,
      allocations: [{ paymentAllocationId: paymentAllocation.id, amountPaise: 10_000 }],
      mutationId: mutationId(31),
    }
    const refund = finance.recordRefund(refundInput, { coachId, createId, database, now })
    const refundReversalInput = {
      refundId: refund.refund.id,
      expectedRefundRevision: 0,
      reason: "Replay Refund reversal",
      mutationId: mutationId(32),
    }
    finance.reverseRefund(refundReversalInput, { coachId, createId, database, now })
    const paymentReversalInput = {
      paymentId: payment.receipt.id,
      reason: "Replay payment reversal",
      idempotencyKey: "archive-replay-payment-reversal",
    }
    finance.reversePayment(paymentReversalInput, { coachId, createId, database, now })
    const endingAgreement = finance.createOrReplaceFeeAgreement({
      ...agreementInput(playerId, "archive-replay-ending-agreement"),
      effectiveFrom: "2026-09-01",
    }, { coachId, createId, database, now }).agreement
    const concessionChargeId = createCharge(
      playerId,
      endingAgreement.id,
      "replayconc",
      "2026-09",
    )
    const adjustmentChargeId = createCharge(
      playerId,
      endingAgreement.id,
      "replayadj",
      "2026-10",
    )
    const voidChargeId = createCharge(
      playerId,
      endingAgreement.id,
      "replayvoid",
      "2026-11",
    )

    const concessionInput = {
      playerId,
      mode: "one_off" as const,
      valueKind: "fixed" as const,
      value: 10_000,
      reason: "Replay concession",
      mutationId: mutationId(33),
    }
    const concession = finance.createConcession(concessionInput, {
      coachId, createId, database, now,
    })
    const applicationInput = {
      concessionId: concession.concession.id,
      chargeId: concessionChargeId,
      expectedConcessionRevision: 0,
      expectedChargeRevision: 0,
      mutationId: mutationId(34),
    }
    const application = finance.applyConcession(applicationInput, {
      coachId, createId, database, now,
    })
    const applicationReversalInput = {
      applicationId: application.applicationId,
      reason: "Replay application reversal",
      mutationId: mutationId(35),
    }
    finance.reverseConcessionApplication(applicationReversalInput, {
      coachId, createId, database, now,
    })
    const concessionReversalInput = {
      concessionId: concession.concession.id,
      expectedConcessionRevision: 2,
      reason: "Replay Concession reversal",
      mutationId: mutationId(36),
    }
    finance.reverseConcession(concessionReversalInput, { coachId, createId, database, now })

    const adjustmentInput = {
      chargeId: adjustmentChargeId,
      kind: "manual_credit" as const,
      amountPaise: 5_000,
      reason: "Replay adjustment",
      idempotencyKey: "archive-replay-adjustment",
    }
    finance.applyChargeAdjustment(adjustmentInput, { coachId, createId, database, now })
    const adjustment = database.select().from(schema.chargeAdjustments)
      .where(eq(schema.chargeAdjustments.chargeId, adjustmentChargeId)).get()
    if (!adjustment) throw new Error("The replay-test Adjustment is unavailable.")
    const adjustmentReversalInput = {
      adjustmentId: adjustment.id,
      reason: "Replay Adjustment reversal",
      idempotencyKey: "archive-replay-adjustment-reversal",
    }
    finance.reverseChargeAdjustment(adjustmentReversalInput, {
      coachId, createId, database, now,
    })
    const voidInput = {
      chargeId: voidChargeId,
      expectedChargeRevision: 0,
      reason: "Replay void",
      idempotencyKey: "archive-replay-void",
    }
    finance.voidCharge(voidInput, { coachId, createId, database, now })
    const endInput = {
      agreementId: endingAgreement.id,
      effectiveThroughPeriod: "2026-11",
      reason: "Replay plan end",
      expectedRevision: 0,
      idempotencyKey: "archive-replay-end",
    }
    finance.endFeeAgreement(endInput, { coachId, createId, database, now })

    archivePlayer(playerId)
    const before = ledgerCounts()
    expect(finance.createOrReplaceFeeAgreement(planInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(finance.recordAllocatedPayment(paymentInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(finance.recordRefund(refundInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(finance.reverseRefund(refundReversalInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    finance.reversePayment(paymentReversalInput, { coachId, createId, database, now })
    expect(finance.createConcession(concessionInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(finance.applyConcession(applicationInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(finance.reverseConcessionApplication(applicationReversalInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(finance.reverseConcession(concessionReversalInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    finance.applyChargeAdjustment(adjustmentInput, { coachId, createId, database, now })
    finance.reverseChargeAdjustment(adjustmentReversalInput, {
      coachId, createId, database, now,
    })
    finance.voidCharge(voidInput, { coachId, createId, database, now })
    expect(finance.endFeeAgreement(endInput, {
      coachId, createId, database, now,
    }).reused).toBe(true)
    expect(ledgerCounts()).toEqual(before)
  })
})
