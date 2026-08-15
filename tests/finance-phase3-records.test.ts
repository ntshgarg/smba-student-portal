import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-phase3-"))
const databasePath = path.join(temporaryDirectory, "finance-phase3.db")
process.env.DB_FILE_NAME = databasePath

function valueFactory(prefix: string) {
  let next = 0
  return () => `${prefix}-${String(next += 1).padStart(5, "0")}`
}

describe("Financials Phase 3 records and fee-plan lifecycle", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let repository: typeof import("@/lib/finance/repository")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")
  const ids = valueFactory("phase3")
  let serial = 3_000

  function createPlayer(
    label: string,
    options: { archived?: boolean } = {},
  ) {
    const id = `phase3-player-${label.toLowerCase()}`
    const createdAt = new Date("2026-07-01T10:00:00+05:30")
    database.insert(schema.accounts).values({
      id,
      fullName: `${label} Records`,
      normalizedName: `${label.toLowerCase()} records`,
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: createdAt,
      approvedByAccountId: coachId,
      archivedAt: options.archived ? now : null,
      archivedByAccountId: options.archived ? coachId : null,
      createdAt,
      updatedAt: createdAt,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: serial += 1,
      accountId: id,
      createdAt,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "active",
      joinedAt: createdAt,
      updatedAt: createdAt,
    }).run()
    return id
  }

  function createAgreement(playerId: string, id = `${playerId}-agreement`) {
    database.insert(schema.feeAgreements).values({
      id,
      playerAccountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 400_000,
      currency: "INR",
      monthlyDueDay: 5,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      status: "active",
      recordRevision: 0,
      createdByAccountId: coachId,
      createdAt: now,
      updatedByAccountId: coachId,
      updatedAt: now,
    }).run()
    return id
  }

  function addMatchingAssignment(playerId: string, suffix: string) {
    const seriesId = `phase3-series-${suffix}`
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: `${suffix} Beginner Weekday`,
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-09-01",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: `phase3-assignment-${suffix}`,
      accountId: playerId,
      seriesId,
      effectiveFrom: "2026-09-01",
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
  }

  beforeAll(async () => {
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    repository = await import("@/lib/finance/repository")
    database = client.initializeDatabase()
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "phase3-finance-activation",
    }, { coachId, createId: ids, database, now })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("derives paginated fee-register rows and summaries from shared ledger facts", () => {
    const ashaId = createPlayer("Asha")
    const binaId = createPlayer("Bina")
    createPlayer("Chitra", { archived: true })
    const agreementId = createAgreement(ashaId)
    createAgreement(binaId)
    const chargeId = "phase3-charge-asha-august"
    database.insert(schema.financialCharges).values({
      id: chargeId,
      feeReference: "SMBA-2A4C6E8G",
      playerAccountId: ashaId,
      feeAgreementId: agreementId,
      type: "monthly_training",
      billingPeriod: "2026-08",
      description: "Monthly training fee · August 2026",
      originalAmountPaise: 400_000,
      currency: "INR",
      dueDate: "2026-08-05",
      lifecycle: "issued",
      recordRevision: 2,
      issuedByAccountId: coachId,
      issuedAt: now,
    }).run()
    database.insert(schema.chargeAdjustments).values([
      {
        id: "phase3-credit",
        chargeId,
        kind: "manual_credit",
        amountPaise: 50_000,
        reason: "Approved fee adjustment",
        createdByAccountId: coachId,
        createdAt: now,
      },
      {
        id: "phase3-debit",
        chargeId,
        kind: "manual_debit",
        amountPaise: 25_000,
        reason: "Additional training fee",
        createdByAccountId: coachId,
        createdAt: now,
      },
    ]).run()
    database.insert(schema.payments).values({
      id: "phase3-payment-active",
      playerAccountId: ashaId,
      receiptReference: "SMBA-R-2026-00020",
      amountPaise: 200_000,
      currency: "INR",
      receivedOn: "2026-08-10",
      method: "upi",
      lifecycle: "recorded",
      idempotencyKey: "phase3-payment-active-key",
      payloadFingerprint: "phase3-payment-active-fingerprint",
      recordRevision: 1,
      recordedByAccountId: coachId,
      recordedAt: now,
    }).run()
    database.insert(schema.paymentAllocations).values({
      id: "phase3-allocation-active",
      paymentId: "phase3-payment-active",
      chargeId,
      amountPaise: 200_000,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.refunds).values({
      id: "phase3-refund-active",
      refundReference: "SMBA-RF-2026-00004",
      paymentId: "phase3-payment-active",
      playerAccountId: ashaId,
      amountPaise: 50_000,
      currency: "INR",
      refundedOn: "2026-08-12",
      method: "upi",
      lifecycle: "recorded",
      idempotencyKey: "phase3-refund-active-key",
      payloadFingerprint: "phase3-refund-active-fingerprint",
      recordRevision: 0,
      recordedByAccountId: coachId,
      recordedAt: now,
    }).run()
    database.insert(schema.refundAllocations).values({
      id: "phase3-refund-allocation-active",
      refundId: "phase3-refund-active",
      paymentAllocationId: "phase3-allocation-active",
      amountPaise: 50_000,
      createdAt: now,
    }).run()

    const first = finance.getFeeRegister({
      mode: "monthly",
      period: "2026-08",
      limit: 1,
    }, { coachId, database, now })
    expect(first.rows).toEqual([expect.objectContaining({
      playerId: ashaId,
      creditAdjustmentsPaise: 50_000,
      debitAdjustmentsPaise: 25_000,
      effectiveAmountPaise: 375_000,
      receivedPaise: 150_000,
      outstandingPaise: 225_000,
      status: "partially_paid",
    })])
    expect(first.summary).toMatchObject({
      totalRows: 2,
      originalAmountPaise: 400_000,
      effectiveAmountPaise: 375_000,
      receivedPaise: 150_000,
      outstandingPaise: 225_000,
      statusCounts: { partially_paid: 1, not_prepared: 1 },
    })
    expect(first.nextCursor).toBe(ashaId)
    expect(finance.getFeeRegister({
      mode: "monthly",
      period: "2026-08",
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    }, { coachId, database, now }).rows).toEqual([
      expect.objectContaining({ playerId: binaId, status: "not_prepared" }),
    ])
    expect(finance.getFeeRegister({
      mode: "monthly",
      period: "2026-08",
      query: "SMBA#3001",
    }, { coachId, database, now }).rows).toHaveLength(1)
    expect(finance.getFeeRegister({
      mode: "registration",
    }, { coachId, database, now }).rows[0]).toMatchObject({ status: "setup_required" })
  })

  it("provides a lifecycle-aware collections day book and readable activity", () => {
    const ashaId = "phase3-player-asha"
    const chargeId = "phase3-charge-asha-august"
    database.insert(schema.payments).values({
      id: "phase3-payment-reversed",
      playerAccountId: ashaId,
      receiptReference: "SMBA-R-2026-00021",
      amountPaise: 25_000,
      currency: "INR",
      receivedOn: "2026-08-11",
      method: "cash",
      lifecycle: "reversed",
      idempotencyKey: "phase3-payment-reversed-key",
      payloadFingerprint: "phase3-payment-reversed-fingerprint",
      recordRevision: 1,
      recordedByAccountId: coachId,
      recordedAt: now,
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: "Duplicate receipt",
    }).run()
    database.insert(schema.paymentAllocations).values({
      id: "phase3-allocation-reversed",
      paymentId: "phase3-payment-reversed",
      chargeId,
      amountPaise: 25_000,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.financialAuditEvents).values([
      {
        id: "phase3-audit-payment",
        actorAccountId: coachId,
        eventType: "payment_recorded",
        entityType: "payment",
        entityId: "phase3-payment-active",
        metadata: JSON.stringify({ amountPaise: 200_000 }),
        occurredAt: now,
      },
      {
        id: "phase3-audit-adjustment",
        actorAccountId: coachId,
        eventType: "adjustment_created",
        entityType: "adjustment",
        entityId: "phase3-credit",
        metadata: JSON.stringify({ chargeId, amountPaise: 50_000 }),
        occurredAt: new Date(now.getTime() + 1_000),
      },
    ]).run()

    const dayBook = finance.getCollectionsDayBook({
      from: "2026-08-01",
      to: "2026-08-31",
      includeReversed: true,
    }, { coachId, database })
    expect(dayBook.events.map((event) => event.reference)).toEqual([
      "SMBA-RF-2026-00004",
      "SMBA-R-2026-00021",
      "SMBA-R-2026-00020",
    ])
    expect(dayBook.summary).toMatchObject({
      grossReceivedPaise: 200_000,
      refundsPaise: 50_000,
      netCollectionsPaise: 150_000,
      byMethod: { upi: 150_000, cash: 0 },
    })
    expect(finance.getCollectionsDayBook({
      from: "2026-08-01",
      to: "2026-08-31",
      query: "RF-2026-00004",
    }, { coachId, database }).events).toHaveLength(1)

    const activity = finance.getFinancialActivity({
      eventTypes: ["adjustment_created", "payment_recorded"],
    }, { coachId, database })
    expect(activity.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "payment_recorded",
        action: "Payment recorded",
        playerId: ashaId,
        reference: "SMBA-R-2026-00020",
        amountPaise: 200_000,
      }),
      expect.objectContaining({
        eventType: "adjustment_created",
        action: "Fee adjustment recorded",
        playerId: ashaId,
        reference: "SMBA-2A4C6E8G",
        reason: "Approved fee adjustment",
      }),
    ]))
    expect(finance.listFinanceActivityCoaches({ coachId, database }))
      .toEqual([{ id: coachId, name: "Sathiya Moorthy" }])
    expect(() => finance.getFeeRegister({
      mode: "monthly",
      period: "2026-08",
    }, { coachId: ashaId, database, now })).toThrow(expect.objectContaining({
      code: "AUTHORIZATION",
    }))
  })

  it("ends a fee plan transactionally and permits only a non-overlapping restart", () => {
    const playerId = createPlayer("Deepa")
    const agreementId = createAgreement(playerId)
    const laterChargeId = "phase3-deepa-september"
    database.insert(schema.financialCharges).values({
      id: laterChargeId,
      feeReference: "SMBA-3A5C7E9G",
      playerAccountId: playerId,
      feeAgreementId: agreementId,
      type: "monthly_training",
      billingPeriod: "2026-09",
      description: "Monthly training fee · September 2026",
      originalAmountPaise: 400_000,
      currency: "INR",
      dueDate: "2026-09-05",
      lifecycle: "issued",
      recordRevision: 0,
      issuedByAccountId: coachId,
      issuedAt: now,
    }).run()
    const endInput = {
      agreementId,
      effectiveThroughPeriod: "2026-08",
      reason: "Player completed the current fee term",
      expectedRevision: 0,
      idempotencyKey: "phase3-end-deepa-agreement",
    }
    expect(() => finance.endFeeAgreement({ ...endInput, expectedRevision: 1 }, {
      coachId,
      createId: ids,
      database,
      now,
    })).toThrow(expect.objectContaining({ code: "CONFLICT" }))
    expect(() => finance.endFeeAgreement(endInput, {
      coachId,
      createId: ids,
      database,
      now,
    })).toThrow(expect.objectContaining({ code: "CONFLICT" }))

    finance.voidCharge({
      chargeId: laterChargeId,
      expectedChargeRevision: 0,
      reason: "Issued beyond the player’s final fee month",
      idempotencyKey: "phase3-void-deepa-september",
    }, { coachId, createId: ids, database, now })
    const ended = finance.endFeeAgreement(endInput, {
      coachId,
      createId: ids,
      database,
      now,
    })
    expect(ended).toMatchObject({
      reused: false,
      agreement: {
        id: agreementId,
        status: "ended",
        effectiveTo: "2026-08-31",
        recordRevision: 1,
      },
    })
    expect(finance.endFeeAgreement(endInput, {
      coachId,
      createId: ids,
      database,
      now,
    })).toMatchObject({ reused: true, agreement: { id: agreementId } })
    expect(() => finance.endFeeAgreement({
      ...endInput,
      reason: "A different replay payload",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "IDEMPOTENCY_CONFLICT",
    }))
    expect(database.select().from(schema.financialAuditEvents).where(and(
      eq(schema.financialAuditEvents.eventType, "fee_agreement_ended"),
      eq(schema.financialAuditEvents.entityId, agreementId),
    )).all()).toHaveLength(1)
    expect(repository.listMonthlyPreparationCandidates(database, "2026-09")
      .some(({ agreement }) => agreement.id === agreementId)).toBe(false)

    addMatchingAssignment(playerId, "deepa")
    const restart = finance.createOrReplaceFeeAgreement({
      playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-09-01",
      idempotencyKey: "phase3-restart-deepa-agreement",
    }, { coachId, createId: ids, database, now })
    expect(restart).toMatchObject({ reused: false, agreement: { effectiveFrom: "2026-09-01" } })

    const historicalPlayer = createPlayer("Esha")
    addMatchingAssignment(historicalPlayer, "esha")
    database.insert(schema.feeAgreements).values({
      id: "phase3-esha-ended",
      playerAccountId: historicalPlayer,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 400_000,
      currency: "INR",
      monthlyDueDay: 5,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-08-31",
      status: "ended",
      recordRevision: 1,
      createdByAccountId: coachId,
      createdAt: now,
      updatedByAccountId: coachId,
      updatedAt: now,
    }).run()
    expect(() => finance.createOrReplaceFeeAgreement({
      playerId: historicalPlayer,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-08-01",
      idempotencyKey: "phase3-overlap-esha-agreement",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "CONFLICT",
    }))
  })

  it("installs only the Phase 3 query indexes", () => {
    const sqlite = new Database(databasePath, { readonly: true })
    const indexes = sqlite.prepare(`
      select name from sqlite_master
      where type = 'index' and name in (
        'financial_charges_register_idx',
        'payments_received_lifecycle_idx',
        'refunds_date_lifecycle_idx',
        'financial_audit_type_occurred_idx'
      ) order by name
    `).all().map((row) => (row as { name: string }).name)
    sqlite.close()
    expect(indexes).toEqual([
      "financial_audit_type_occurred_idx",
      "financial_charges_register_idx",
      "payments_received_lifecycle_idx",
      "refunds_date_lifecycle_idx",
    ])
  })
})
