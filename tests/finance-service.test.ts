import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

function valueFactory(prefix: string) {
  let next = 0
  return () => `${prefix}-${String(next += 1).padStart(4, "0")}`
}

function referenceFactory() {
  const values = [
    "SMBA-7K4M2P8Q",
    "SMBA-3N5R7T9W",
    "SMBA-4C6D8F2G",
    "SMBA-5H7J9K3M",
    "SMBA-6N8P2Q4R",
    "SMBA-7S9T3V5W",
    "SMBA-8X2Y4Z6A",
    "SMBA-9B3C5D7E",
  ]
  return () => values.shift() ?? `SMBA-${"A".repeat(8)}`
}

describe("Financials V1 service", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-08T10:00:00+05:30")
  const ids = valueFactory("finance")
  const references = referenceFactory()
  let legacyPlayerId = ""
  let unresolvedPlayerId = ""
  let activePlayerId = ""
  let monthlyChargeId = ""

  function addMatchingAssignment({
    batch,
    effectiveFrom,
    endsOn = null,
    playerId,
    programme,
    suffix,
  }: {
    batch: "Weekday" | "Weekend"
    effectiveFrom: string
    endsOn?: string | null
    playerId: string
    programme: "Beginner" | "Intermediate" | "Advanced" | "Adult"
    suffix: string
  }) {
    const seriesId = `finance-series-${suffix}`
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: `${programme}_${batch}_${suffix}`,
      programme,
      batch,
      venue: "SMBA Court",
      startsOn: effectiveFrom,
      endsOn,
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: `finance-assignment-${suffix}`,
      accountId: playerId,
      seriesId,
      effectiveFrom,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
  }

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    finance = await import("@/lib/finance/service")
    database = client.initializeDatabase()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("keeps approval unchanged before cutover and activates finance irreversibly", () => {
    legacyPlayerId = accountService.registerAccount("Legacy Player", "player")
    accountService.approveRegistration(legacyPlayerId, coachId, { now })
    unresolvedPlayerId = accountService.registerAccount("Unresolved Player", "player")
    accountService.approveRegistration(unresolvedPlayerId, coachId, { now })
    expect(database.select().from(schema.financialCharges).all()).toHaveLength(0)

    expect(() => finance.activateFinance({
      trackingMonth: "2026-09",
      idempotencyKey: "activate-future-month",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "period",
    }))

    const activation = finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "activate-2026-08",
    }, { coachId, createId: ids, database, now })
    expect(activation).toMatchObject({ reused: false, activation: { trackingMonth: "2026-08" } })
    expect(finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "another-activation-key",
    }, { coachId, createId: ids, database, now }).reused).toBe(true)
    expect(() => finance.activateFinance({
      trackingMonth: "2026-09",
      idempotencyKey: "activate-2026-09",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "ALREADY_ACTIVE",
    }))
  })

  it("issues the registration Charge atomically for approvals after activation", () => {
    activePlayerId = accountService.registerAccount("Active Player", "player")
    accountService.approveRegistration(activePlayerId, coachId, {
      now,
      createFinanceId: ids,
      createFeeReference: references,
    })
    const charge = database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, activePlayerId),
      eq(schema.financialCharges.type, "registration"),
    )).get()
    expect(charge).toMatchObject({
      feeReference: "SMBA-7K4M2P8Q",
      originalAmountPaise: 100_000,
      dueDate: "2026-08-08",
      lifecycle: "issued",
    })
    expect(database.select().from(schema.financialAuditEvents)
      .where(eq(schema.financialAuditEvents.entityId, charge?.id ?? "missing")).all())
      .toHaveLength(1)
  })

  it("issues and records a legacy registration fee without creating a monthly fee plan", () => {
    const playerId = "registration-only-legacy-player"
    const approvedAt = new Date("2026-08-01T10:00:00+05:30")
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: "Registration Only Player",
      normalizedName: "registration only player",
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt,
      approvedByAccountId: coachId,
      createdAt: approvedAt,
      updatedAt: approvedAt,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: 9_999,
      accountId: playerId,
      createdAt: approvedAt,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "active",
      joinedAt: approvedAt,
      updatedAt: approvedAt,
    }).run()

    const registration = finance.resolveExistingRegistrationFee({
      playerId,
      status: "pending",
      idempotencyKey: "registration-only-resolution",
    }, {
      coachId,
      createFeeReference: () => "SMBA-2D4F6H8J",
      createId: ids,
      database,
      now,
    })
    expect(registration).toMatchObject({
      dueDate: "2026-08-01",
      outstandingPaise: 100_000,
      status: "overdue",
    })
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      playerId,
    )).all()).toHaveLength(0)
    expect(finance.recordPayment({
      chargeId: registration.id,
      expectedChargeRevision: registration.recordRevision,
      amountPaise: 100_000,
      receivedOn: "2026-08-08",
      method: "cash",
      idempotencyKey: "registration-only-offline-payment",
    }, { coachId, createId: ids, database, now })).toMatchObject({
      reused: false,
      charge: { status: "paid", outstandingPaise: 0 },
    })
    expect(finance.getPlayerFeeRecord(playerId, { database, now })?.receipts[0]?.allocations)
      .toEqual([expect.objectContaining({
        chargeId: registration.id,
        chargeType: "registration",
        billingPeriod: null,
      })])
  })

  it("sets up an existing player and reads a persisted legacy credit as paid", () => {
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekend-standard",
      level: "Adult",
      batch: "Weekend",
    }).where(eq(schema.playerEnrollments.accountId, legacyPlayerId)).run()
    addMatchingAssignment({
      batch: "Weekend",
      effectiveFrom: "2026-12-01",
      playerId: legacyPlayerId,
      programme: "Adult",
      suffix: "legacy",
    })

    const record = finance.setupExistingPlayerFinance({
      playerId: legacyPlayerId,
      academyPlan: "weekend-standard",
      level: "Adult",
      batch: "Weekend",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      registrationStatus: "pending",
      idempotencyKey: "reconcile-legacy-player",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(record.registrationCharge?.status).toBe("pending")
    expect(database.select().from(schema.payments)
      .where(eq(schema.payments.playerAccountId, legacyPlayerId)).all()).toHaveLength(0)
    if (!record.registrationCharge) throw new Error("Registration Charge is unavailable.")
    const registrationChargeId = record.registrationCharge.id
    database.insert(schema.chargeAdjustments).values({
      id: "persisted-legacy-credit",
      chargeId: registrationChargeId,
      kind: "legacy_settlement",
      amountPaise: 100_000,
      reason: "Old private settlement wording",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.update(schema.financialCharges).set({ recordRevision: 1 })
      .where(eq(schema.financialCharges.id, registrationChargeId)).run()
    const playerRegistration = finance.getPlayerFeeRecord(
      legacyPlayerId,
      { database, now },
    )?.registrationCharge
    expect(playerRegistration).toMatchObject({ status: "paid" })
    expect(playerRegistration?.adjustments).toBeUndefined()
    expect(finance.getCoachFinancePlayerRecord(legacyPlayerId, {
      coachId,
      database,
      now,
    })?.registrationCharge?.adjustments).toContainEqual(expect.objectContaining({
      id: "persisted-legacy-credit",
      kind: "manual_credit",
      reason: "Historical credit adjustment",
      canReverse: false,
    }))
    expect(() => finance.applyChargeAdjustment({
      chargeId: registrationChargeId,
      kind: "legacy_settlement" as never,
      amountPaise: 1,
      reason: "A retired write must not be accepted",
      idempotencyKey: "reject-retired-adjustment",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
    }))
    expect(() => finance.reverseChargeAdjustment({
      adjustmentId: "persisted-legacy-credit",
      reason: "Old rows are read only",
      idempotencyKey: "reject-retired-reversal",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "CONFLICT",
    }))
    expect(finance.setupExistingPlayerFinance({
      playerId: legacyPlayerId,
      academyPlan: "weekend-standard",
      level: "Adult",
      batch: "Weekend",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      registrationStatus: "pending",
      idempotencyKey: "reconcile-legacy-player",
    }, { coachId, createFeeReference: references, createId: ids, database, now }))
      .toMatchObject({ playerId: legacyPlayerId })
    expect(() => finance.setupExistingPlayerFinance({
      playerId: legacyPlayerId,
      academyPlan: "weekend-standard",
      level: "Adult",
      batch: "Weekend",
      agreedMonthlyFeePaise: 360_000,
      effectiveFrom: "2026-08-01",
      registrationStatus: "pending",
      idempotencyKey: "reconcile-legacy-player",
    }, { coachId, createFeeReference: references, createId: ids, database, now }))
      .toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }))
    expect(() => finance.setupExistingPlayerFinance({
      playerId: legacyPlayerId,
      academyPlan: "weekend-standard",
      level: "Adult",
      batch: "Weekend",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      registrationStatus: "invalid" as never,
      idempotencyKey: "invalid-reconciliation",
    }, { coachId, createFeeReference: references, createId: ids, database, now }))
      .toThrow(expect.objectContaining({ code: "INVALID_INPUT" }))
  })

  it("resolves an initially unknown registration and reissues after a prior void", () => {
    const initial = finance.getPlayerFeeRecord(legacyPlayerId, { database, now })
    const oldCharge = initial?.registrationCharge
    if (!oldCharge) throw new Error("Legacy registration Charge is unavailable.")
    const voided = finance.voidCharge({
      chargeId: oldCharge.id,
      expectedChargeRevision: oldCharge.recordRevision,
      reason: "Historical status requires fresh review",
      idempotencyKey: "void-legacy-registration",
    }, { coachId, createId: ids, database, now })
    expect(voided.lifecycle).toBe("void")
    expect(voided).toMatchObject({ effectiveAmountPaise: 0, outstandingPaise: 0 })

    const pending = finance.resolveExistingRegistrationFee({
      playerId: legacyPlayerId,
      status: "pending",
      idempotencyKey: "resolve-legacy-registration-pending",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(pending).toMatchObject({ lifecycle: "issued", outstandingPaise: 100_000 })
    expect(pending.id).not.toBe(oldCharge.id)
    expect(finance.getPlayerFeeRecord(legacyPlayerId, { database, now })?.registrationCharge?.id)
      .toBe(pending.id)

    const paid = finance.recordPayment({
      chargeId: pending.id,
      expectedChargeRevision: pending.recordRevision,
      amountPaise: pending.outstandingPaise,
      receivedOn: "2026-08-08",
      method: "upi",
      idempotencyKey: "pay-reissued-registration",
    }, { coachId, createId: ids, database, now })
    expect(paid.charge.status).toBe("paid")
  })

  it("keeps an unresolved registration in setup required until explicitly resolved", () => {
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
    }).where(eq(schema.playerEnrollments.accountId, unresolvedPlayerId)).run()
    addMatchingAssignment({
      batch: "Weekday",
      effectiveFrom: "2026-08-08",
      endsOn: "2026-10-31",
      playerId: unresolvedPlayerId,
      programme: "Beginner",
      suffix: "unresolved",
    })
    const unresolved = finance.setupExistingPlayerFinance({
      playerId: unresolvedPlayerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      registrationStatus: "unresolved",
      idempotencyKey: "setup-unresolved-player",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(unresolved).toMatchObject({
      registrationCharge: null,
      registrationResolutionRequired: true,
      status: "setup_required",
    })
  })

  it("prepares a full monthly fee from the first assignment and remains idempotent", async () => {
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
    }).where(eq(schema.playerEnrollments.accountId, activePlayerId)).run()
    addMatchingAssignment({
      batch: "Weekday",
      effectiveFrom: "2026-08-08",
      endsOn: "2026-10-31",
      playerId: activePlayerId,
      programme: "Beginner",
      suffix: "active",
    })
    expect(() => finance.createOrReplaceFeeAgreement({
      playerId: activePlayerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-08",
      idempotencyKey: "agreement-invalid-mid-month",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "effectiveFrom",
    }))
    finance.createOrReplaceFeeAgreement({
      playerId: activePlayerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      idempotencyKey: "agreement-active-player",
    }, { coachId, createId: ids, database, now })
    expect(() => finance.createOrReplaceFeeAgreement({
      playerId: activePlayerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 351_000,
      effectiveFrom: "2026-08-01",
      idempotencyKey: "agreement-active-player",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "IDEMPOTENCY_CONFLICT",
    }))
    const beforePreparation = finance.getCoachFinanceWorkspace({
      period: "2026-08",
      view: "attention",
    }, { coachId, database, now })
    expect(beforePreparation.players.find((player) => player.playerId === activePlayerId)?.status)
      .toBe("not_prepared")
    expect(beforePreparation.summary.attentionCount).toBeGreaterThan(0)
    const dashboardBeforePreparation = finance.getCoachFinanceDashboardSummary(
      "2026-08",
      { coachId, database, now },
    )
    expect(dashboardBeforePreparation.attentionCount).toBeGreaterThan(0)
    expect(dashboardBeforePreparation.preparation).toEqual({
      ready: 2,
      alreadyPrepared: 0,
    })

    const prepared = finance.prepareMonthlyCharges({
      period: "2026-08",
      idempotencyKey: "prepare-2026-08",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(prepared).toMatchObject({ ready: 2, reused: false })
    monthlyChargeId = database.select({ id: schema.financialCharges.id })
      .from(schema.financialCharges).where(and(
        eq(schema.financialCharges.playerAccountId, activePlayerId),
        eq(schema.financialCharges.billingPeriod, "2026-08"),
      )).get()?.id ?? ""
    const unresolvedMonthlyCharge = finance.getPlayerFeeRecord(unresolvedPlayerId, { database, now })
      ?.monthlyCharges.find((charge) => charge.billingPeriod === "2026-08")
    if (!unresolvedMonthlyCharge) throw new Error("The unresolved player monthly Charge is unavailable.")
    const overdueReference = new Date("2026-09-01T10:00:00+05:30")
    expect(finance.getPlayerFeeRecord(unresolvedPlayerId, {
      database,
      now: overdueReference,
    })).toMatchObject({
      currentBalancePaise: 350_000,
      registrationResolutionRequired: true,
      status: "overdue",
    })
    expect(await finance.getPlayerFinanceDashboardSummary(unresolvedPlayerId, {
      database,
      now: overdueReference,
    })).toMatchObject({
      currentBalancePaise: 350_000,
      nextDueDate: "2026-08-11",
      status: "overdue",
    })
    const unresolvedOverdueWorkspace = finance.getCoachFinanceWorkspace({
      period: "2026-08",
      view: "attention",
    }, { coachId, database, now: overdueReference })
    expect(unresolvedOverdueWorkspace.players.find((player) => (
      player.playerId === unresolvedPlayerId
    ))).toMatchObject({
      outstandingPaise: 350_000,
      status: "setup_required",
    })
    expect(finance.getCoachFinanceDashboardSummary("2026-08", {
      coachId,
      database,
      now: overdueReference,
    })).toMatchObject({
      attentionCount: unresolvedOverdueWorkspace.summary.attentionCount,
      outstandingPaise: unresolvedOverdueWorkspace.summary.outstandingPaise,
      preparation: { ready: 0, alreadyPrepared: 2 },
    })
    finance.recordPayment({
      chargeId: unresolvedMonthlyCharge.id,
      expectedChargeRevision: unresolvedMonthlyCharge.recordRevision,
      amountPaise: unresolvedMonthlyCharge.outstandingPaise,
      receivedOn: "2026-08-08",
      method: "upi",
      idempotencyKey: "pay-unresolved-player-monthly",
    }, { coachId, createId: ids, database, now })
    expect(finance.getPlayerFeeRecord(unresolvedPlayerId, { database, now })).toMatchObject({
      currentBalancePaise: 0,
      registrationResolutionRequired: true,
      status: "paid",
    })
    const unresolvedWorkspace = finance.getCoachFinanceWorkspace({
      period: "2026-08",
      view: "attention",
    }, { coachId, database, now })
    expect(unresolvedWorkspace.players.find((player) => (
      player.playerId === unresolvedPlayerId
    ))?.status).toBe("setup_required")
    expect(finance.getCoachFinanceDashboardSummary("2026-08", { coachId, database, now }))
      .toMatchObject({ attentionCount: unresolvedWorkspace.summary.attentionCount })
    const issuedRegistration = finance.resolveExistingRegistrationFee({
      playerId: unresolvedPlayerId,
      status: "pending",
      idempotencyKey: "resolve-unresolved-player-registration",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(issuedRegistration.status).toBe("pending")
    const resolvedRegistration = finance.recordPayment({
      chargeId: issuedRegistration.id,
      expectedChargeRevision: issuedRegistration.recordRevision,
      amountPaise: issuedRegistration.outstandingPaise,
      receivedOn: "2026-08-08",
      method: "cash",
      idempotencyKey: "pay-unresolved-player-registration",
    }, { coachId, createId: ids, database, now })
    expect(resolvedRegistration.charge.status).toBe("paid")
    expect(finance.getPlayerFeeRecord(unresolvedPlayerId, { database, now })).toMatchObject({
      registrationResolutionRequired: false,
      status: "paid",
    })
    expect(finance.getCoachFinanceDashboardSummary("2026-08", { coachId, database, now })
      .attentionCount).toBe(unresolvedWorkspace.summary.attentionCount - 1)
    expect(database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.id, monthlyChargeId)).get()).toMatchObject({
      originalAmountPaise: 350_000,
      dueDate: "2026-08-11",
      billingPeriod: "2026-08",
    })
    expect(finance.prepareMonthlyCharges({
      period: "2026-08",
      idempotencyKey: "prepare-2026-08",
    }, { coachId, createFeeReference: references, createId: ids, database, now }))
      .toMatchObject({ createdChargeIds: prepared.createdChargeIds, reused: true })
    expect(() => finance.prepareMonthlyCharges({
      period: "2026-06",
      idempotencyKey: "prepare-before-cutover",
    }, { coachId, createFeeReference: references, createId: ids, database, now }))
      .toThrow(expect.objectContaining({ code: "INVALID_INPUT", field: "period" }))
  })

  it("records partial payments with optimistic concurrency and exact idempotency", async () => {
    const first = finance.recordPayment({
      chargeId: monthlyChargeId,
      expectedChargeRevision: 0,
      amountPaise: 100_000,
      receivedOn: "2026-08-08",
      method: "upi",
      externalReference: "UPI-ONE",
      internalNote: "Recorded at the front desk",
      idempotencyKey: "payment-one-request",
    }, { coachId, createId: ids, database, now })
    expect(first).toMatchObject({ reused: false, charge: { outstandingPaise: 250_000 } })
    expect(finance.recordPayment({
      chargeId: monthlyChargeId,
      expectedChargeRevision: 0,
      amountPaise: 100_000,
      receivedOn: "2026-08-08",
      method: "upi",
      externalReference: "UPI-ONE",
      internalNote: "Recorded at the front desk",
      idempotencyKey: "payment-one-request",
    }, { coachId, createId: ids, database, now })).toMatchObject({
      paymentId: first.paymentId,
      reused: true,
    })
    expect(() => finance.recordPayment({
      chargeId: monthlyChargeId,
      expectedChargeRevision: 0,
      amountPaise: 250_000,
      receivedOn: "2026-08-08",
      method: "cash",
      idempotencyKey: "stale-payment-request",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "BALANCE_CHANGED",
    }))

    const currentRevision = first.charge.recordRevision
    const settled = finance.recordPayment({
      chargeId: monthlyChargeId,
      expectedChargeRevision: currentRevision,
      amountPaise: 250_000,
      receivedOn: "2026-08-08",
      method: "cash",
      idempotencyKey: "payment-two-request",
    }, { coachId, createId: ids, database, now })
    expect(settled.charge.status).toBe("paid")
    expect(() => finance.recordPayment({
      chargeId: monthlyChargeId,
      expectedChargeRevision: currentRevision,
      amountPaise: 250_000,
      receivedOn: "2026-08-08",
      method: "cash",
      idempotencyKey: "simultaneous-payment-request",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "ALREADY_SETTLED",
    }))

    const dashboard = await finance.getPlayerFinanceDashboardSummary(activePlayerId, { database, now })
    expect(dashboard.currentBalancePaise).toBe(100_000)
    expect(finance.getPlayerFeeRecord(activePlayerId, { database, now })?.monthlyCharges
      .find((charge) => charge.id === monthlyChargeId)?.payments
      .find((payment) => payment.id === first.paymentId)?.internalNote).toBeUndefined()
    const workspace = finance.getCoachFinanceWorkspace({
      period: "2026-08",
      view: "attention",
    }, { coachId, database, now })
    expect(workspace.players.find((player) => player.playerId === activePlayerId)).toMatchObject({
      outstandingPaise: 100_000,
      status: "pending",
    })
    expect(workspace.summary.outstandingPaise).toBe(100_000)
    const coachLedger = finance.getCoachFinanceWorkspace({
      period: "2026-08",
      view: "all",
      playerId: activePlayerId,
    }, { coachId, database, now }).selectedLedger
    expect(coachLedger?.monthlyCharges.find((charge) => charge.id === monthlyChargeId)
      ?.payments.find((payment) => payment.id === first.paymentId)?.internalNote)
      .toBe("Recorded at the front desk")
  })

  it("reverses exactly once, audits the reversal and prevents voiding with live Payments", () => {
    const payment = database.select().from(schema.payments)
      .where(eq(schema.payments.chargeId, monthlyChargeId)).get()
    if (!payment) throw new Error("Payment fixture is unavailable.")
    const beforeAudits = database.select().from(schema.financialAuditEvents)
      .where(eq(schema.financialAuditEvents.eventType, "payment_reversed")).all().length
    const reversed = finance.reversePayment({
      paymentId: payment.id,
      reason: "Recorded against the wrong Charge",
      idempotencyKey: "reverse-payment-one",
    }, { coachId, createId: ids, database, now })
    expect(reversed.outstandingPaise).toBe(100_000)
    finance.reversePayment({
      paymentId: payment.id,
      reason: "Recorded against the wrong Charge",
      idempotencyKey: "reverse-payment-one",
    }, { coachId, createId: ids, database, now })
    expect(database.select().from(schema.financialAuditEvents)
      .where(eq(schema.financialAuditEvents.eventType, "payment_reversed")).all())
      .toHaveLength(beforeAudits + 1)
    expect(() => finance.voidCharge({
      chargeId: monthlyChargeId,
      expectedChargeRevision: reversed.recordRevision,
      reason: "Incorrect fee",
      idempotencyKey: "void-with-payment",
    }, { coachId, createId: ids, database, now })).toThrow("Reverse recorded Payments")
  })

  it("applies and reverses adjustments without rewriting the Charge", () => {
    const before = finance.getPlayerFeeRecord(activePlayerId, { database, now })
    const charge = before?.registrationCharge
    if (!charge) throw new Error("Registration Charge fixture is unavailable.")
    const credited = finance.applyChargeAdjustment({
      chargeId: charge.id,
      kind: "manual_credit",
      amountPaise: 20_000,
      reason: "Approved courtesy credit",
      idempotencyKey: "credit-registration",
    }, { coachId, createId: ids, database, now })
    expect(credited.outstandingPaise).toBe(80_000)
    const adjustment = database.select().from(schema.chargeAdjustments)
      .where(eq(schema.chargeAdjustments.chargeId, charge.id)).get()
    if (!adjustment) throw new Error("Adjustment fixture is unavailable.")
    const restored = finance.reverseChargeAdjustment({
      adjustmentId: adjustment.id,
      reason: "Credit approved in error",
      idempotencyKey: "reverse-registration-credit",
    }, { coachId, createId: ids, database, now })
    expect(restored.outstandingPaise).toBe(100_000)
    expect(database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.id, charge.id)).get()?.originalAmountPaise).toBe(100_000)
  })

  it("blocks a debit reversal that would create an unallocated overpayment", () => {
    const before = finance.getPlayerFeeRecord(activePlayerId, { database, now })
    const charge = before?.monthlyCharges.find((item) => item.id === monthlyChargeId)
    if (!charge) throw new Error("Monthly Charge fixture is unavailable.")
    const debited = finance.applyChargeAdjustment({
      chargeId: charge.id,
      kind: "manual_debit",
      amountPaise: 50_000,
      reason: "Approved equipment supplement",
      idempotencyKey: "debit-monthly-charge",
    }, { coachId, createId: ids, database, now })
    const finalPayment = finance.recordPayment({
      chargeId: charge.id,
      expectedChargeRevision: debited.recordRevision,
      amountPaise: debited.outstandingPaise,
      receivedOn: "2026-08-08",
      method: "upi",
      internalNote: "Settles the adjusted balance",
      idempotencyKey: "settle-debited-monthly-charge",
    }, { coachId, createId: ids, database, now })
    expect(finalPayment.charge.outstandingPaise).toBe(0)
    const debit = database.select().from(schema.chargeAdjustments).where(and(
      eq(schema.chargeAdjustments.chargeId, charge.id),
      eq(schema.chargeAdjustments.kind, "manual_debit"),
    )).get()
    if (!debit) throw new Error("Debit Adjustment fixture is unavailable.")
    expect(() => finance.reverseChargeAdjustment({
      adjustmentId: debit.id,
      reason: "Attempt would create credit",
      idempotencyKey: "reverse-debit-with-overpayment",
    }, { coachId, createId: ids, database, now })).toThrow("Reverse or correct recorded Payments")
  })

  it("uses one month-boundary agreement and requires an overlapping scheduled assignment", () => {
    const activeAgreement = database.select().from(schema.feeAgreements).where(and(
      eq(schema.feeAgreements.playerAccountId, activePlayerId),
      eq(schema.feeAgreements.status, "active"),
    )).get()
    if (!activeAgreement) throw new Error("The active Fee Plan fixture is unavailable.")

    expect(() => finance.createOrReplaceFeeAgreement({
      playerId: activePlayerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-09-15",
      expectedAgreementRevision: activeAgreement.recordRevision,
      idempotencyKey: "replace-mid-month-plan",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
      field: "effectiveFrom",
    }))

    const replacement = finance.createOrReplaceFeeAgreement({
      playerId: activePlayerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-09-01",
      expectedAgreementRevision: activeAgreement.recordRevision,
      idempotencyKey: "replace-september-plan",
    }, { coachId, createId: ids, database, now })
    expect(replacement.agreement.agreedMonthlyFeePaise).toBe(400_000)

    // Simulate an old overlapping row imported from another system. Preparation
    // must still select exactly one deterministic agreement for this player/month.
    database.update(schema.feeAgreements).set({ effectiveTo: "2026-09-30" })
      .where(eq(schema.feeAgreements.id, activeAgreement.id)).run()

    const septemberPreview = finance.getCoachFinanceWorkspace({
      period: "2026-09",
      view: "attention",
    }, { coachId, database, now })
    expect(septemberPreview.preparation.ready).toBe(2)
    expect(septemberPreview.players.find((player) => player.playerId === activePlayerId)?.status)
      .toBe("not_prepared")
    const september = finance.prepareMonthlyCharges({
      period: "2026-09",
      idempotencyKey: "prepare-2026-09",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(september.ready).toBe(2)
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, activePlayerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).all()).toEqual([
      expect.objectContaining({ originalAmountPaise: 400_000 }),
    ])

    const november = finance.prepareMonthlyCharges({
      period: "2026-11",
      idempotencyKey: "prepare-2026-11",
    }, { coachId, createFeeReference: references, createId: ids, database, now })
    expect(november.createdChargeIds).toHaveLength(0)
    expect(november.awaitingAssignment).toBeGreaterThan(0)
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, activePlayerId),
      eq(schema.financialCharges.billingPeriod, "2026-11"),
    )).all()).toHaveLength(0)
  })

  it("keeps prior-month arrears in the selected-period list and dashboard", () => {
    const agreement = database.select().from(schema.feeAgreements).where(and(
      eq(schema.feeAgreements.playerAccountId, activePlayerId),
      eq(schema.feeAgreements.status, "active"),
    )).get()
    if (!agreement) throw new Error("The current Fee Plan fixture is unavailable.")
    database.insert(schema.financialCharges).values({
      id: "finance-july-arrear",
      feeReference: "SMBA-2C4D6F8G",
      playerAccountId: activePlayerId,
      feeAgreementId: agreement.id,
      type: "monthly_training",
      billingPeriod: "2026-07",
      description: "Monthly training fee · 2026-07",
      originalAmountPaise: 350_000,
      currency: "INR",
      dueDate: "2026-07-05",
      lifecycle: "issued",
      recordRevision: 0,
      issuedByAccountId: coachId,
      issuedAt: now,
    }).run()

    const record = finance.getPlayerFeeRecord(activePlayerId, { database, now })
    const registration = record?.registrationCharge
    const september = record?.monthlyCharges.find((charge) => charge.billingPeriod === "2026-09")
    if (!registration || !september) throw new Error("The settlement fixtures are unavailable.")
    finance.recordPayment({
      chargeId: registration.id,
      expectedChargeRevision: registration.recordRevision,
      amountPaise: registration.outstandingPaise,
      receivedOn: "2026-08-08",
      method: "upi",
      idempotencyKey: "settle-active-registration",
    }, { coachId, createId: ids, database, now })
    finance.recordPayment({
      chargeId: september.id,
      expectedChargeRevision: september.recordRevision,
      amountPaise: september.outstandingPaise,
      receivedOn: "2026-09-08",
      method: "upi",
      idempotencyKey: "settle-active-september",
    }, {
      coachId,
      createId: ids,
      database,
      now: new Date("2026-09-08T10:00:00+05:30"),
    })

    const octoberNow = new Date("2026-10-08T10:00:00+05:30")
    const workspace = finance.getCoachFinanceWorkspace({
      period: "2026-09",
      view: "attention",
    }, { coachId, database, now: octoberNow })
    expect(workspace.players.find((player) => player.playerId === activePlayerId)).toMatchObject({
      status: "overdue",
      outstandingPaise: 350_000,
    })
    expect(workspace.summary.receivedPaise).toBe(400_000)
    const dashboard = finance.getCoachFinanceDashboardSummary("2026-09", {
      coachId,
      database,
      now: octoberNow,
    })
    expect(dashboard).toMatchObject({
      attentionCount: workspace.summary.attentionCount,
      outstandingPaise: workspace.summary.outstandingPaise,
    })
    expect(dashboard.outstandingPaise).toBe(700_000)
    expect(finance.getPlayerFeeRecord(activePlayerId, { database, now: octoberNow })).toMatchObject({
      status: "overdue",
      currentBalancePaise: 350_000,
    })
  })

  it("allows debit reversal when the no-payment result floors at zero", () => {
    const debited = finance.applyChargeAdjustment({
      chargeId: "finance-july-arrear",
      kind: "manual_debit",
      amountPaise: 50_000,
      reason: "Temporary approved supplement",
      idempotencyKey: "debit-july-arrear",
    }, { coachId, createId: ids, database, now })
    expect(debited).toMatchObject({ effectiveAmountPaise: 400_000, receivedPaise: 0 })
    const credited = finance.applyChargeAdjustment({
      chargeId: "finance-july-arrear",
      kind: "manual_credit",
      amountPaise: 375_000,
      reason: "Approved fee waiver",
      idempotencyKey: "credit-july-arrear",
    }, { coachId, createId: ids, database, now })
    expect(credited).toMatchObject({ effectiveAmountPaise: 25_000, receivedPaise: 0 })
    const debit = database.select().from(schema.chargeAdjustments).where(and(
      eq(schema.chargeAdjustments.chargeId, "finance-july-arrear"),
      eq(schema.chargeAdjustments.kind, "manual_debit"),
    )).get()
    if (!debit) throw new Error("The debit Adjustment fixture is unavailable.")
    expect(finance.reverseChargeAdjustment({
      adjustmentId: debit.id,
      reason: "Supplement no longer applies",
      idempotencyKey: "reverse-july-arrear-debit",
    }, { coachId, createId: ids, database, now })).toMatchObject({
      effectiveAmountPaise: 0,
      receivedPaise: 0,
      outstandingPaise: 0,
    })
  })

  it("skips stale programme billing until the fee plan and assignment match", async () => {
    const memberService = await import("@/lib/coach/member-service")
    const sessionService = await import("@/lib/sessions/service")
    const playerId = "programme-transition-player"
    const feeReferences = ["SMBA-BCDFGHJK"]
    const createFeeReference = () => feeReferences.shift() ?? "SMBA-UVWXYZ23"

    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "activate-programme-transition-test",
    }, { coachId, createId: ids, database, now })
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: "Programme Transition Player",
      normalizedName: "programme transition player",
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      approvedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: 9_998,
      accountId: playerId,
      createdAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      status: "unassigned",
      joinedAt: now,
      updatedAt: now,
    }).run()

    const initialProfile = memberService.updateMemberRecord({
      coachId,
      database,
      now,
      input: {
        memberId: playerId,
        expectedRevision: 0,
        profile: {
          fullName: "Programme Transition Player",
          joinedAt: "2026-08-08",
          primaryContact: { name: "", relationship: "", phone: "" },
        },
        training: {
          academyPlan: "weekday-3-day",
          level: "Beginner",
          batch: "Weekday",
        },
      },
    })
    expect(initialProfile).toMatchObject({
      ok: true,
      record: { training: { level: "Beginner", recordRevision: 1 } },
    })

    const beginnerSeriesId = sessionService.createSessionSeriesRecords({
      coachId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "Transition Court",
        startsOn: "2026-08-08",
        endsOn: "2026-09-30",
        weekdays: [1, 3, 5],
        startTime: "18:00",
        durationMinutes: 60,
      },
    })
    sessionService.assignSessionRecords({
      coachId,
      database,
      effectiveFrom: "2026-08-08",
      now,
      playerId,
      seriesId: beginnerSeriesId,
      weekdays: [1, 3, 5],
    })
    const beginnerAgreement = finance.createOrReplaceFeeAgreement({
      playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      idempotencyKey: "programme-transition-beginner-agreement",
    }, { coachId, createId: ids, database, now }).agreement
    const beginnerAssignment = database.select().from(schema.sessionAssignments).where(and(
      eq(schema.sessionAssignments.accountId, playerId),
      eq(schema.sessionAssignments.seriesId, beginnerSeriesId),
    )).get()
    if (!beginnerAssignment) throw new Error("The Beginner assignment was not created.")
    sessionService.endSessionAssignment({
      assignmentId: beginnerAssignment.id,
      coachId,
      database,
      effectiveTo: "2026-08-08",
      now,
    })

    const transitionRevision = database.select({
      recordRevision: schema.playerEnrollments.recordRevision,
    }).from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.recordRevision
    if (transitionRevision === undefined) throw new Error("The enrollment revision is unavailable.")
    const changedProfile = memberService.updateMemberRecord({
      coachId,
      database,
      now,
      input: {
        memberId: playerId,
        expectedRevision: transitionRevision,
        profile: {
          fullName: "Programme Transition Player",
          joinedAt: "2026-08-08",
          primaryContact: { name: "", relationship: "", phone: "" },
        },
        training: {
          academyPlan: "weekday-3-day",
          level: "Intermediate",
          batch: "Weekday",
        },
      },
    })
    expect(changedProfile).toMatchObject({
      ok: true,
      record: { training: { level: "Intermediate" } },
    })

    finance.prepareMonthlyCharges({
      period: "2026-09",
      idempotencyKey: "prepare-programme-transition-stale-agreement",
    }, { coachId, createFeeReference, createId: ids, database, now })
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).all()).toHaveLength(0)

    expect(() => finance.createOrReplaceFeeAgreement({
      playerId,
      academyPlan: "weekday-3-day",
      level: "Intermediate",
      batch: "Weekday",
      agreedMonthlyFeePaise: 425_000,
      effectiveFrom: "2026-09-01",
      expectedAgreementRevision: beginnerAgreement.recordRevision,
      idempotencyKey: "programme-transition-intermediate-agreement",
    }, { coachId, createId: ids, database, now })).toThrow(expect.objectContaining({
      code: "SETUP_REQUIRED",
      field: "playerId",
    }))

    const intermediateSeriesId = sessionService.createSessionSeriesRecords({
      coachId,
      database,
      now,
      input: {
        programme: "Intermediate",
        batch: "Weekday",
        venue: "Transition Court",
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
        weekdays: [1, 3, 5],
        startTime: "19:00",
        durationMinutes: 60,
      },
    })
    sessionService.assignSessionRecords({
      coachId,
      database,
      effectiveFrom: "2026-09-01",
      now,
      playerId,
      seriesId: intermediateSeriesId,
      weekdays: [1, 3, 5],
    })
    const intermediateAgreement = finance.createOrReplaceFeeAgreement({
      playerId,
      academyPlan: "weekday-3-day",
      level: "Intermediate",
      batch: "Weekday",
      agreedMonthlyFeePaise: 425_000,
      effectiveFrom: "2026-09-01",
      expectedAgreementRevision: beginnerAgreement.recordRevision,
      idempotencyKey: "programme-transition-intermediate-agreement",
    }, { coachId, createId: ids, database, now }).agreement

    const prepared = finance.prepareMonthlyCharges({
      period: "2026-09",
      idempotencyKey: "prepare-programme-transition-matching-profile",
    }, { coachId, createFeeReference, createId: ids, database, now })
    expect(prepared).toMatchObject({ ready: 1, reused: false })
    expect(prepared.createdChargeIds).toHaveLength(1)
    const charges = database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).all()
    expect(charges).toEqual([
      expect.objectContaining({
        id: prepared.createdChargeIds[0],
        feeAgreementId: intermediateAgreement.id,
        originalAmountPaise: 425_000,
      }),
    ])

    expect(finance.prepareMonthlyCharges({
      period: "2026-09",
      idempotencyKey: "prepare-programme-transition-matching-profile",
    }, { coachId, createFeeReference, createId: ids, database, now })).toMatchObject({
      createdChargeIds: prepared.createdChargeIds,
      ready: 1,
      reused: true,
    })
    expect(database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, "2026-09"),
    )).all()).toHaveLength(1)
  })
})
