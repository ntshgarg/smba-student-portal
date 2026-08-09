import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-v2-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-finance-v2.db")

function valueFactory(prefix: string) {
  let next = 0
  return () => `${prefix}-${String(next += 1).padStart(5, "0")}`
}

function mutationId(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
}

describe("Financials V2 service", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")
  const ids = valueFactory("finance-v2")
  let academySerial = 2_000

  function createPlayer(label: string, monthlyFeePaise = 400_000) {
    const playerId = `finance-v2-player-${label}`
    const createdAt = new Date("2026-07-01T10:00:00+05:30")
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: `Phase Two ${label}`,
      normalizedName: `phase two ${label.toLowerCase()}`,
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: createdAt,
      approvedByAccountId: coachId,
      createdAt,
      updatedAt: createdAt,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: academySerial += 1,
      accountId: playerId,
      createdAt,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "active",
      joinedAt: createdAt,
      updatedAt: createdAt,
    }).run()
    database.insert(schema.feeAgreements).values({
      id: `${playerId}-active-fee-plan`,
      playerAccountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: monthlyFeePaise,
      currency: "INR",
      monthlyDueDay: 5,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "active",
      recordRevision: 0,
      createdByAccountId: coachId,
      createdAt,
      updatedByAccountId: coachId,
      updatedAt: createdAt,
    }).run()
    return playerId
  }

  function createCharge(input: {
    id: string
    playerId: string
    amountPaise: number
    dueDate: string
    billingPeriod: string
    feeReference: string
  }) {
    database.insert(schema.financialCharges).values({
      id: input.id,
      feeReference: input.feeReference,
      playerAccountId: input.playerId,
      type: "monthly_training",
      billingPeriod: input.billingPeriod,
      description: `Monthly training fee · ${input.billingPeriod}`,
      originalAmountPaise: input.amountPaise,
      currency: "INR",
      dueDate: input.dueDate,
      lifecycle: "issued",
      recordRevision: 0,
      issuedByAccountId: coachId,
      issuedAt: new Date(`${input.dueDate}T10:00:00+05:30`),
    }).run()
    return input.id
  }

  beforeAll(async () => {
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    database = client.initializeDatabase()
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "phase-two-service-activation",
    }, { coachId, createId: ids, database, now })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("allocates one receipt across Charges atomically with stable sequencing and idempotency", () => {
    const playerId = createPlayer("Allocations")
    const oldChargeId = createCharge({
      id: "phase2-allocation-old",
      playerId,
      amountPaise: 100_000,
      dueDate: "2026-06-05",
      billingPeriod: "2026-06",
      feeReference: "SMBA-2A4C6E8G",
    })
    const newChargeId = createCharge({
      id: "phase2-allocation-new",
      playerId,
      amountPaise: 300_000,
      dueDate: "2026-07-05",
      billingPeriod: "2026-07",
      feeReference: "SMBA-3A5C7E9G",
    })

    const preview = finance.previewPaymentAllocations({
      playerId,
      amountPaise: 250_000,
    }, { coachId, database, now })
    expect(preview.allocations).toMatchObject([
      { chargeId: oldChargeId, amountPaise: 100_000, expectedChargeRevision: 0 },
      { chargeId: newChargeId, amountPaise: 150_000, expectedChargeRevision: 0 },
    ])

    const input = {
      playerId,
      amountPaise: 250_000,
      receivedOn: "2026-08-10",
      method: "upi" as const,
      externalReference: "UPI-PHASE2-ONE",
      allocations: preview.allocations.map(({ chargeId, amountPaise, expectedChargeRevision }) => ({
        chargeId,
        amountPaise,
        expectedChargeRevision,
      })),
      mutationId: mutationId(1),
    }
    const first = finance.recordAllocatedPayment(input, {
      coachId,
      createId: ids,
      database,
      now,
    })
    expect(first).toMatchObject({
      reused: false,
      receipt: {
        receiptReference: "SMBA-R-2026-00001",
        amountPaise: 250_000,
        allocations: [
          { chargeId: oldChargeId, amountPaise: 100_000 },
          { chargeId: newChargeId, amountPaise: 150_000 },
        ],
      },
    })
    expect(finance.recordAllocatedPayment(input, {
      coachId,
      createId: ids,
      database,
      now,
    })).toMatchObject({ reused: true, receipt: { id: first.receipt.id } })
    expect(() => finance.createConcession({
      playerId,
      mode: "one_off",
      valueKind: "fixed",
      value: 1_000,
      reason: "Must not reuse a Payment mutation identifier",
      mutationId: input.mutationId,
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "IDEMPOTENCY_CONFLICT",
    }))
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "payment_recorded"),
      eq(schema.financialAuditEvents.entityId, first.receipt.id),
    )).all()).toHaveLength(1)

    expect(() => finance.recordAllocatedPayment({ ...input, method: "cash" }, {
      coachId,
      createId: ids,
      database,
      now,
    })).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }))
    expect(() => finance.recordAllocatedPayment({
      ...input,
      mutationId: mutationId(2),
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "BALANCE_CHANGED",
    }))
    expect(() => finance.recordAllocatedPayment({
      ...input,
      amountPaise: 250_001,
      mutationId: mutationId(3),
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
    }))

    const secondPreview = finance.previewPaymentAllocations({
      playerId,
      amountPaise: 10_000,
    }, { coachId, database, now })
    const secondInput = {
      playerId,
      amountPaise: 10_000,
      receivedOn: "2026-08-10",
      method: "cash" as const,
      allocations: secondPreview.allocations.map((allocation) => ({
        chargeId: allocation.chargeId,
        amountPaise: allocation.amountPaise,
        expectedChargeRevision: allocation.expectedChargeRevision,
      })),
      mutationId: mutationId(4),
    }
    // The receipt sequence is allocated inside the same transaction as the
    // ledger write. A failure after allocation must roll the sequence back.
    expect(() => finance.recordAllocatedPayment({
      ...secondInput,
      mutationId: mutationId(5),
    }, {
      coachId,
      createId: () => first.receipt.id,
      database,
      now,
    })).toThrow()
    const second = finance.recordAllocatedPayment({
      ...secondInput,
    }, { coachId, createId: ids, database, now })
    expect(second.receipt.receiptReference).toBe("SMBA-R-2026-00002")
    expect(database.select().from(schema.financeReferenceSequences).where(and(
      eq(schema.financeReferenceSequences.kind, "receipt"),
      eq(schema.financeReferenceSequences.year, 2026),
    )).get()?.lastValue).toBe(2)
  })

  it("replays a migrated V1 payment only when the original payload matches exactly", () => {
    const playerId = createPlayer("Legacy Retry")
    const chargeId = createCharge({
      id: "phase2-legacy-retry-charge",
      playerId,
      amountPaise: 90_000,
      dueDate: "2026-04-05",
      billingPeriod: "2026-04",
      feeReference: "SMBA-4B6D8F2H",
    })
    const paymentId = "phase2-legacy-retry-payment"
    const recordedAt = new Date("2026-04-04T10:00:00+05:30")
    database.insert(schema.payments).values({
      id: paymentId,
      chargeId,
      playerAccountId: playerId,
      receiptReference: "SMBA-R-2026-09001",
      amountPaise: 90_000,
      currency: "INR",
      receivedOn: "2026-04-04",
      method: "upi",
      externalReference: "LEGACY-UPI-REFERENCE",
      internalNote: "Migrated V1 payment",
      lifecycle: "recorded",
      idempotencyKey: "phase2-legacy-retry-key",
      payloadFingerprint: `phase1:${paymentId}`,
      recordRevision: 0,
      recordedByAccountId: coachId,
      recordedAt,
    }).run()
    database.insert(schema.paymentAllocations).values({
      id: `phase1-allocation-${paymentId}`,
      paymentId,
      chargeId,
      amountPaise: 90_000,
      createdByAccountId: coachId,
      createdAt: recordedAt,
    }).run()
    database.update(schema.financialCharges).set({ recordRevision: 1 })
      .where(eq(schema.financialCharges.id, chargeId)).run()

    const original = {
      chargeId,
      expectedChargeRevision: 0,
      amountPaise: 90_000,
      receivedOn: "2026-04-04",
      method: "upi" as const,
      externalReference: "LEGACY-UPI-REFERENCE",
      internalNote: "Migrated V1 payment",
      idempotencyKey: "phase2-legacy-retry-key",
    }
    expect(finance.recordPayment(original, {
      coachId,
      createId: ids,
      database,
      now,
    })).toMatchObject({ paymentId, reused: true })
    expect(() => finance.recordPayment({ ...original, method: "cash" }, {
      coachId,
      createId: ids,
      database,
      now,
    })).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }))
  })

  it("refunds newest covered Charges first, rejects invalid dates and over-refunds, and reverses safely", () => {
    const playerId = createPlayer("Refunds")
    const oldChargeId = createCharge({
      id: "phase2-refund-old",
      playerId,
      amountPaise: 100_000,
      dueDate: "2026-06-05",
      billingPeriod: "2026-06",
      feeReference: "SMBA-4A6C8E2G",
    })
    const newChargeId = createCharge({
      id: "phase2-refund-new",
      playerId,
      amountPaise: 250_000,
      dueDate: "2026-07-05",
      billingPeriod: "2026-07",
      feeReference: "SMBA-5A7C9E3G",
    })
    const paymentPreview = finance.previewPaymentAllocations({
      playerId,
      amountPaise: 300_000,
    }, { coachId, database, now })
    const payment = finance.recordAllocatedPayment({
      playerId,
      amountPaise: 300_000,
      receivedOn: "2026-08-10",
      method: "bank_transfer",
      allocations: paymentPreview.allocations.map((allocation) => ({
        chargeId: allocation.chargeId,
        amountPaise: allocation.amountPaise,
        expectedChargeRevision: allocation.expectedChargeRevision,
      })),
      mutationId: mutationId(10),
    }, { coachId, createId: ids, database, now })

    const refundPreview = finance.previewRefundAllocations({
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      amountPaise: 250_000,
    }, { coachId, database, now })
    const receiptAllocations = payment.receipt.allocations
    const newestAllocation = receiptAllocations.find((item) => item.chargeId === newChargeId)
    const oldestAllocation = receiptAllocations.find((item) => item.chargeId === oldChargeId)
    expect(refundPreview.allocations).toEqual([
      expect.objectContaining({
        paymentAllocationId: newestAllocation?.id,
        chargeId: newChargeId,
        amountPaise: 200_000,
      }),
      expect.objectContaining({
        paymentAllocationId: oldestAllocation?.id,
        chargeId: oldChargeId,
        amountPaise: 50_000,
      }),
    ])

    const validAllocations = refundPreview.allocations.map(({ paymentAllocationId, amountPaise }) => ({
      paymentAllocationId,
      amountPaise,
    }))
    expect(() => finance.recordRefund({
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      amountPaise: 250_000,
      refundedOn: "2026-08-09",
      method: "bank_transfer",
      allocations: validAllocations,
      mutationId: mutationId(11),
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
    }))

    expect(() => finance.previewRefundAllocations({
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      amountPaise: 300_001,
    }, { coachId, database, now })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }))

    const refundInput = {
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      amountPaise: 250_000,
      refundedOn: "2026-08-11",
      method: "bank_transfer" as const,
      externalReference: "REFUND-PHASE2-ONE",
      allocations: validAllocations,
      mutationId: mutationId(12),
    }
    const refunded = finance.recordRefund(refundInput, {
      coachId,
      createId: ids,
      database,
      now,
    })
    expect(refunded).toMatchObject({
      reused: false,
      refund: {
        refundReference: "SMBA-RF-2026-00001",
        amountPaise: 250_000,
      },
    })
    expect(finance.recordRefund(refundInput, {
      coachId,
      createId: ids,
      database,
      now,
    })).toMatchObject({ reused: true, refund: { id: refunded.refund.id } })
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "refund_recorded"),
      eq(schema.financialAuditEvents.entityId, refunded.refund.id),
    )).all()).toHaveLength(1)

    expect(() => finance.previewRefundAllocations({
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 1,
      amountPaise: 50_001,
    }, { coachId, database, now })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }))
    expect(() => finance.reversePayment({
      paymentId: payment.receipt.id,
      reason: "Cannot reverse while the Refund remains active",
      idempotencyKey: "phase2-payment-reversal-blocked",
    }, { coachId, createId: ids, database, now })).toThrow("Reverse active Refunds")

    const reversed = finance.reverseRefund({
      refundId: refunded.refund.id,
      expectedRefundRevision: 0,
      reason: "Refund was entered against the wrong receipt",
      mutationId: mutationId(13),
    }, { coachId, createId: ids, database, now })
    expect(reversed).toMatchObject({ reused: false, refund: { lifecycle: "reversed" } })
    expect(finance.reverseRefund({
      refundId: refunded.refund.id,
      expectedRefundRevision: 0,
      reason: "Refund was entered against the wrong receipt",
      mutationId: mutationId(13),
    }, { coachId, createId: ids, database, now })).toMatchObject({
      reused: true,
      refund: { id: refunded.refund.id, lifecycle: "reversed" },
    })
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "refund_reversed"),
      eq(schema.financialAuditEvents.entityId, refunded.refund.id),
    )).all()).toHaveLength(1)
    expect(database.select().from(schema.financeReferenceSequences).where(and(
      eq(schema.financeReferenceSequences.kind, "refund"),
      eq(schema.financeReferenceSequences.year, 2026),
    )).get()?.lastValue).toBe(1)
  })

  it("returns an authorized, date-bounded collection register without private ledger fields", () => {
    const playerId = createPlayer("Collections")
    const chargeId = createCharge({
      id: "phase2-collection-charge",
      playerId,
      amountPaise: 75_000,
      dueDate: "2026-08-05",
      billingPeriod: "2026-08",
      feeReference: "SMBA-6A8C2E4G",
    })
    const payment = finance.recordAllocatedPayment({
      playerId,
      amountPaise: 75_000,
      receivedOn: "2026-08-15",
      method: "cheque",
      externalReference: "CHEQUE-123",
      internalNote: "This must not appear in the collection export",
      allocations: [{ chargeId, amountPaise: 75_000, expectedChargeRevision: 0 }],
      mutationId: mutationId(20),
    }, { coachId, createId: ids, database, now })
    const allocation = payment.receipt.allocations[0]
    finance.recordRefund({
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      amountPaise: 25_000,
      refundedOn: "2026-08-16",
      method: "cheque",
      externalReference: "CHEQUE-REFUND-123",
      internalNote: "This also must remain private",
      allocations: [{ paymentAllocationId: allocation.id, amountPaise: 25_000 }],
      mutationId: mutationId(21),
    }, { coachId, createId: ids, database, now })

    const events = finance.listFinanceCollectionEvents({
      from: "2026-08-15",
      to: "2026-08-16",
    }, { coachId, database, now })
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.eventType)).toEqual(["refund", "payment"])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventDate: "2026-08-15",
        eventType: "payment",
        playerFullName: "Phase Two Collections",
        method: "cheque",
        amountPaise: 75_000,
        coveredFeeReferences: ["SMBA-6A8C2E4G"],
      }),
      expect.objectContaining({
        eventDate: "2026-08-16",
        eventType: "refund",
        playerFullName: "Phase Two Collections",
        method: "cheque",
        amountPaise: 25_000,
        coveredFeeReferences: ["SMBA-6A8C2E4G"],
      }),
    ]))
    events.forEach((event) => {
      expect(Object.keys(event).sort()).toEqual([
        "academyId",
        "amountPaise",
        "coveredFeeReferences",
        "eventDate",
        "eventType",
        "method",
        "playerFullName",
        "reference",
      ])
      expect(JSON.stringify(event)).not.toContain("private")
      expect(JSON.stringify(event)).not.toContain(playerId)
      expect(event.academyId).toMatch(/^SMBA#\d{4}$/)
    })

    expect(() => finance.listFinanceCollectionEvents({
      from: "2025-08-15",
      to: "2026-08-16",
    }, { coachId, database, now })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }))
    expect(() => finance.listFinanceCollectionEvents({
      from: "2026-08-15",
      to: "2026-08-16",
    }, { coachId: playerId, database, now })).toThrow(expect.objectContaining({
      code: "AUTHORIZATION",
    }))
  })

  it("exports only the Charge allocation actually covered by a partial Refund", () => {
    const playerId = createPlayer("Collection Refund Coverage")
    const olderChargeId = createCharge({
      id: "phase2-collection-multi-old",
      playerId,
      amountPaise: 100_000,
      dueDate: "2026-06-05",
      billingPeriod: "2026-06",
      feeReference: "SMBA-2C4E6G8J",
    })
    const newerChargeId = createCharge({
      id: "phase2-collection-multi-new",
      playerId,
      amountPaise: 100_000,
      dueDate: "2026-07-05",
      billingPeriod: "2026-07",
      feeReference: "SMBA-3C5E7G9J",
    })
    const payment = finance.recordAllocatedPayment({
      playerId,
      amountPaise: 200_000,
      receivedOn: "2026-08-17",
      method: "upi",
      allocations: [
        { chargeId: olderChargeId, amountPaise: 100_000, expectedChargeRevision: 0 },
        { chargeId: newerChargeId, amountPaise: 100_000, expectedChargeRevision: 0 },
      ],
      mutationId: mutationId(22),
    }, { coachId, createId: ids, database, now })
    const newerAllocation = payment.receipt.allocations
      .find((allocation) => allocation.chargeId === newerChargeId)
    expect(newerAllocation).toBeDefined()
    finance.recordRefund({
      paymentId: payment.receipt.id,
      expectedPaymentRevision: 0,
      amountPaise: 25_000,
      refundedOn: "2026-08-18",
      method: "upi",
      allocations: [{ paymentAllocationId: newerAllocation!.id, amountPaise: 25_000 }],
      mutationId: mutationId(23),
    }, { coachId, createId: ids, database, now })

    const events = finance.listFinanceCollectionEvents({
      from: "2026-08-17",
      to: "2026-08-18",
    }, { coachId, database, now })
    expect(events.find((event) => event.eventType === "payment")?.coveredFeeReferences)
      .toEqual(["SMBA-2C4E6G8J", "SMBA-3C5E7G9J"])
    expect(events.find((event) => event.eventType === "refund")?.coveredFeeReferences)
      .toEqual(["SMBA-3C5E7G9J"])
  })

  it("applies fixed and half-up percentage Concessions, caps credits, and reverses explicitly", () => {
    const playerId = createPlayer("Concession Ledger")
    const fixedChargeId = createCharge({
      id: "phase2-concession-fixed",
      playerId,
      amountPaise: 100_000,
      dueDate: "2026-05-05",
      billingPeriod: "2026-05",
      feeReference: "SMBA-7A9C3E5G",
    })
    const percentageChargeId = createCharge({
      id: "phase2-concession-percentage",
      playerId,
      amountPaise: 101,
      dueDate: "2026-06-05",
      billingPeriod: "2026-06",
      feeReference: "SMBA-8A2C4E6G",
    })
    const cappedChargeId = createCharge({
      id: "phase2-concession-capped",
      playerId,
      amountPaise: 20_000,
      dueDate: "2026-07-05",
      billingPeriod: "2026-07",
      feeReference: "SMBA-9A3C5E7G",
    })

    const fixedInput = {
      playerId,
      mode: "one_off" as const,
      valueKind: "fixed" as const,
      value: 30_000,
      reason: "Approved one-time fee concession",
      mutationId: mutationId(30),
    }
    const fixed = finance.createConcession(fixedInput, {
      coachId,
      createId: ids,
      database,
      now,
    })
    expect(fixed).toMatchObject({
      reused: false,
      concession: { mode: "one_off", valueKind: "fixed", value: 30_000, recordRevision: 0 },
    })
    expect(finance.createConcession(fixedInput, {
      coachId,
      createId: ids,
      database,
      now,
    })).toMatchObject({ reused: true, concession: { id: fixed.concession.id } })
    expect(() => finance.createConcession({ ...fixedInput, value: 35_000 }, {
      coachId,
      createId: ids,
      database,
      now,
    })).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }))

    const applied = finance.applyConcession({
      concessionId: fixed.concession.id,
      chargeId: fixedChargeId,
      expectedConcessionRevision: 0,
      expectedChargeRevision: 0,
      mutationId: mutationId(31),
    }, { coachId, createId: ids, database, now })
    expect(applied).toMatchObject({
      reused: false,
      concession: { recordRevision: 1 },
      charge: { effectiveAmountPaise: 70_000, outstandingPaise: 70_000 },
    })
    expect(database.select().from(schema.chargeAdjustments).where(and(
      eq(schema.chargeAdjustments.chargeId, fixedChargeId),
      eq(schema.chargeAdjustments.kind, "concession_credit"),
    )).all()).toEqual([
      expect.objectContaining({ amountPaise: 30_000 }),
    ])
    const linkedApplication = database.select().from(schema.concessionApplications).where(eq(
      schema.concessionApplications.id,
      applied.applicationId,
    )).get()
    expect(linkedApplication).toBeDefined()
    expect(() => finance.reverseChargeAdjustment({
      adjustmentId: linkedApplication!.chargeAdjustmentId,
      reason: "Generic corrections must not bypass the Concession lifecycle",
      idempotencyKey: "phase2-generic-concession-reversal-blocked",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "CONFLICT",
    }))
    expect(database.select().from(schema.concessionApplications).where(eq(
      schema.concessionApplications.id,
      applied.applicationId,
    )).get()).toMatchObject({ reversedAt: null })
    expect(database.select().from(schema.chargeAdjustments).where(eq(
      schema.chargeAdjustments.id,
      linkedApplication!.chargeAdjustmentId,
    )).get()).toMatchObject({ reversedAt: null })

    const percentage = finance.createConcession({
      playerId,
      mode: "one_off",
      valueKind: "percentage",
      value: 5_000,
      reason: "Approved fifty-percent concession",
      mutationId: mutationId(32),
    }, { coachId, createId: ids, database, now })
    const percentageApplied = finance.applyConcession({
      concessionId: percentage.concession.id,
      chargeId: percentageChargeId,
      expectedConcessionRevision: 0,
      expectedChargeRevision: 0,
      mutationId: mutationId(33),
    }, { coachId, createId: ids, database, now })
    expect(percentageApplied.charge).toMatchObject({
      originalAmountPaise: 101,
      effectiveAmountPaise: 50,
      outstandingPaise: 50,
    })
    expect(database.select().from(schema.concessionApplications).where(eq(
      schema.concessionApplications.id,
      percentageApplied.applicationId,
    )).get()?.amountPaise).toBe(51)

    const capped = finance.createConcession({
      playerId,
      mode: "one_off",
      valueKind: "fixed",
      value: 50_000,
      reason: "Approved full remaining-balance concession",
      mutationId: mutationId(34),
    }, { coachId, createId: ids, database, now })
    const cappedApplied = finance.applyConcession({
      concessionId: capped.concession.id,
      chargeId: cappedChargeId,
      expectedConcessionRevision: 0,
      expectedChargeRevision: 0,
      mutationId: mutationId(35),
    }, { coachId, createId: ids, database, now })
    expect(cappedApplied.charge).toMatchObject({
      effectiveAmountPaise: 0,
      outstandingPaise: 0,
    })
    expect(database.select().from(schema.concessionApplications).where(eq(
      schema.concessionApplications.id,
      cappedApplied.applicationId,
    )).get()?.amountPaise).toBe(20_000)

    const restored = finance.reverseConcessionApplication({
      applicationId: applied.applicationId,
      reason: "Concession was approved against the wrong month",
      mutationId: mutationId(36),
    }, { coachId, createId: ids, database, now })
    expect(restored).toMatchObject({
      reused: false,
      concession: { recordRevision: 2 },
      charge: { effectiveAmountPaise: 100_000, outstandingPaise: 100_000 },
    })
    expect(finance.reverseConcessionApplication({
      applicationId: applied.applicationId,
      reason: "Concession was approved against the wrong month",
      mutationId: mutationId(36),
    }, { coachId, createId: ids, database, now })).toMatchObject({ reused: true })
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "concession_application_reversed"),
      eq(schema.financialAuditEvents.entityId, applied.applicationId),
    )).all()).toHaveLength(1)

    const reversedDefinition = finance.reverseConcession({
      concessionId: fixed.concession.id,
      expectedConcessionRevision: 2,
      reason: "The approved concession is no longer required",
      mutationId: mutationId(37),
    }, { coachId, createId: ids, database, now })
    expect(reversedDefinition).toMatchObject({
      reused: false,
      concession: { lifecycle: "reversed", recordRevision: 3 },
    })
    expect(finance.reverseConcession({
      concessionId: fixed.concession.id,
      expectedConcessionRevision: 2,
      reason: "The approved concession is no longer required",
      mutationId: mutationId(37),
    }, { coachId, createId: ids, database, now })).toMatchObject({
      reused: true,
      concession: { lifecycle: "reversed" },
    })
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "concession_reversed"),
      eq(schema.financialAuditEvents.entityId, fixed.concession.id),
    )).all()).toHaveLength(1)

    // Ending a Concession definition stops future use without rewriting an
    // already-published ledger credit. Application correction remains an
    // independent, explicit operation even after the definition is ended.
    expect(finance.reverseConcession({
      concessionId: capped.concession.id,
      expectedConcessionRevision: 1,
      reason: "End this concession after its approved use",
      mutationId: mutationId(38),
    }, { coachId, createId: ids, database, now })).toMatchObject({
      concession: { lifecycle: "reversed" },
    })
    expect(finance.getPlayerFeeRecord(playerId, { database, now })?.monthlyCharges
      .find((charge) => charge.id === cappedChargeId)).toMatchObject({
      effectiveAmountPaise: 0,
      outstandingPaise: 0,
    })
    expect(finance.reverseConcessionApplication({
      applicationId: cappedApplied.applicationId,
      reason: "The historical application itself was incorrect",
      mutationId: mutationId(39),
    }, { coachId, createId: ids, database, now })).toMatchObject({
      charge: { effectiveAmountPaise: 20_000, outstandingPaise: 20_000 },
      concession: { lifecycle: "reversed" },
    })
  })

  it("rejects overlapping recurring Concessions and applies one credit per prepared month", () => {
    const playerId = createPlayer("Recurring Concession", 100_000)
    database.insert(schema.sessionSeries).values({
      id: "phase2-recurring-series",
      title: "Beginner_Weekday_6-7_AM",
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-01",
      endsOn: "2026-12-31",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: "phase2-recurring-assignment",
      accountId: playerId,
      seriesId: "phase2-recurring-series",
      effectiveFrom: "2026-08-01",
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()

    const recurring = finance.createConcession({
      playerId,
      mode: "recurring",
      valueKind: "percentage",
      value: 1_000,
      startsPeriod: "2026-09",
      endsPeriod: "2026-10",
      reason: "Approved recurring ten-percent concession",
      mutationId: mutationId(40),
    }, { coachId, createId: ids, database, now })
    expect(() => finance.createConcession({
      playerId,
      mode: "recurring",
      valueKind: "fixed",
      value: 10_000,
      startsPeriod: "2026-10",
      endsPeriod: "2026-12",
      reason: "Overlapping recurring concession",
      mutationId: mutationId(41),
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "CONFLICT",
    }))
    expect(finance.createConcession({
      playerId,
      mode: "recurring",
      valueKind: "fixed",
      value: 10_000,
      startsPeriod: "2026-11",
      endsPeriod: "2026-12",
      reason: "Non-overlapping future concession",
      mutationId: mutationId(42),
    }, { coachId, createId: ids, database, now })).toMatchObject({
      reused: false,
      concession: { startsPeriod: "2026-11" },
    })

    expect(finance.prepareMonthlyCharges({
      period: "2026-09",
      idempotencyKey: "phase2-prepare-recurring-september",
    }, {
      coachId,
      createFeeReference: () => "SMBA-2B4D6F8H",
      createId: ids,
      database,
      now,
    })).toMatchObject({ ready: 1, reused: false })
    const septemberCharge = finance.getPlayerFeeRecord(playerId, { database, now })
      ?.monthlyCharges.find((charge) => charge.billingPeriod === "2026-09")
    expect(septemberCharge).toMatchObject({
      originalAmountPaise: 100_000,
      effectiveAmountPaise: 90_000,
      outstandingPaise: 90_000,
    })
    expect(database.select().from(schema.concessionApplications).where(and(
      eq(schema.concessionApplications.concessionId, recurring.concession.id),
      eq(schema.concessionApplications.chargeId, septemberCharge?.id ?? "missing"),
    )).all()).toHaveLength(1)

    // A second preparation command must reuse the existing Charge and the
    // recurring application rather than append another ledger credit.
    expect(finance.prepareMonthlyCharges({
      period: "2026-09",
      idempotencyKey: "phase2-prepare-recurring-september-again",
    }, {
      coachId,
      createFeeReference: () => "SMBA-3B5D7F9H",
      createId: ids,
      database,
      now,
    })).toMatchObject({ alreadyPrepared: 1, reused: false })
    expect(database.select().from(schema.concessionApplications).where(and(
      eq(schema.concessionApplications.concessionId, recurring.concession.id),
      eq(schema.concessionApplications.chargeId, septemberCharge?.id ?? "missing"),
    )).all()).toHaveLength(1)
    expect(database.select().from(schema.chargeAdjustments).where(and(
      eq(schema.chargeAdjustments.chargeId, septemberCharge?.id ?? "missing"),
      eq(schema.chargeAdjustments.kind, "concession_credit"),
    )).all()).toHaveLength(1)
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "concession_applied"),
      eq(schema.financialAuditEvents.entityType, "concession_application"),
    )).all().filter((event) => {
      const metadata = JSON.parse(event.metadata) as { concessionId?: string }
      return metadata.concessionId === recurring.concession.id
    })).toHaveLength(1)
  })
})
