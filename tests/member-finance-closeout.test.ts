import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-member-closeout-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "member-closeout.db")

describe("member archival financial closeout", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let memberService: typeof import("@/lib/coach/member-service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")
  let nextId = 0
  const createId = () => `member-closeout-${String(nextId += 1).padStart(4, "0")}`

  function createPlayer(name: string, feeReference: string) {
    const playerId = accountService.registerAccount(name, "player")
    accountService.approveRegistration(playerId, coachId, {
      createFeeReference: () => feeReference,
      createFinanceId: createId,
      now,
      requestedRole: "player",
    })
    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "unassigned",
      updatedAt: now,
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()
    const seriesId = `${playerId}:series`
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: `${name} Beginner Weekday`,
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-20",
      status: "active",
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: `${playerId}:assignment`,
      accountId: playerId,
      seriesId,
      effectiveFrom: "2026-08-20",
      effectiveTo: "2026-08-20",
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    const agreement = finance.createOrReplaceFeeAgreement({
      playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      monthlyDueDay: 5,
      idempotencyKey: `${playerId}:fee-plan`,
    }, { coachId, createId, database, now }).agreement
    return { agreement, playerId }
  }

  function archive(playerId: string) {
    return memberService.archiveMemberRecord({
      coachId,
      database,
      input: { memberId: playerId, expectedRevision: 0 },
      now,
    })
  }

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    accountService = await import("@/lib/auth/account-service")
    finance = await import("@/lib/finance/service")
    memberService = await import("@/lib/coach/member-service")
    schema = await import("@/lib/db/schema")
    const client = await import("@/lib/db/client")
    database = client.initializeDatabase()
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "member-closeout-activation",
    }, { coachId, createId, database, now })
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("keeps ended-plan debt payable until closeout and only then permits archival", () => {
    const { agreement, playerId } = createPlayer(
      "Financial Closeout Player",
      "SMBA-CLSEABCD",
    )
    database.insert(schema.authSessions).values({
      tokenHash: "member-closeout-active-session",
      accountId: playerId,
      expiresAt: new Date("2026-08-30T10:00:00+05:30"),
      createdAt: now,
    }).run()

    const before = {
      auditCount: database.select().from(schema.financialAuditEvents).all().length,
      chargeCount: database.select().from(schema.financialCharges).all().length,
      enrollmentRevision: database.select({ revision: schema.playerEnrollments.recordRevision })
        .from(schema.playerEnrollments)
        .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.revision,
    }

    expect(archive(playerId)).toEqual({
      ok: false,
      code: "FINANCIAL_CLOSEOUT_REQUIRED",
      hasOpenFeePlan: true,
      hasOutstandingBalance: true,
      outstandingPaise: 100_000,
    })
    expect(database.select().from(schema.accounts)
      .where(eq(schema.accounts.id, playerId)).get()?.archivedAt).toBeNull()
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.recordRevision)
      .toBe(before.enrollmentRevision)
    expect(database.select().from(schema.authMethods).where(and(
      eq(schema.authMethods.accountId, playerId),
      isNull(schema.authMethods.revokedAt),
    )).all()).toHaveLength(1)
    expect(database.select().from(schema.authSessions)
      .where(eq(schema.authSessions.accountId, playerId)).all()).toHaveLength(1)
    expect(database.select().from(schema.financialCharges).all()).toHaveLength(before.chargeCount)
    expect(database.select().from(schema.financialAuditEvents).all()).toHaveLength(before.auditCount)

    finance.endFeeAgreement({
      agreementId: agreement.id,
      effectiveThroughPeriod: "2026-08",
      reason: "Player is leaving the academy",
      expectedRevision: agreement.recordRevision,
      idempotencyKey: "member-closeout-end-plan",
    }, { coachId, createId, database, now })

    expect(archive(playerId)).toEqual({
      ok: false,
      code: "FINANCIAL_CLOSEOUT_REQUIRED",
      hasOpenFeePlan: false,
      hasOutstandingBalance: true,
      outstandingPaise: 100_000,
    })

    const rapidDesk = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      playerId,
      scope: "outstanding",
    }, { coachId, database, now })
    expect(rapidDesk.players).toContainEqual(expect.objectContaining({
      playerId,
      hasActiveFeePlan: false,
      paymentEligible: true,
      outstandingPaise: 100_000,
    }))
    expect(rapidDesk.selectedLedger?.playerId).toBe(playerId)

    const preview = finance.previewPaymentAllocations({
      playerId,
      amountPaise: 100_000,
    }, { coachId, database, now })
    const payment = finance.recordAllocatedPayment({
      playerId,
      amountPaise: 100_000,
      receivedOn: "2026-08-20",
      method: "upi",
      allocations: preview.allocations,
      mutationId: "00000000-0000-4000-8000-000000009001",
    }, { coachId, createId, database, now })
    expect(payment.reused).toBe(false)
    expect(finance.readPlayerFinancialCloseoutState(database, playerId, now)).toEqual({
      hasOpenFeePlan: false,
      hasOutstandingBalance: false,
      outstandingPaise: 0,
    })

    expect(archive(playerId)).toEqual({ ok: true, memberId: playerId })
    expect(database.select().from(schema.authMethods)
      .where(eq(schema.authMethods.accountId, playerId)).get()?.revokedAt).toBeInstanceOf(Date)
    expect(database.select().from(schema.authSessions)
      .where(eq(schema.authSessions.accountId, playerId)).all()).toHaveLength(0)

    const record = finance.getCoachFinancePlayerRecord(playerId, {
      coachId,
      database,
      now,
    })
    expect(record).toMatchObject({
      archived: true,
      currentBalancePaise: 0,
      registrationCharge: { outstandingPaise: 0 },
    })
    expect(record?.receipts).toContainEqual(expect.objectContaining({
      id: payment.receipt.id,
      amountPaise: 100_000,
    }))
  })

  it("requires an open zero-balance Fee Plan to end before archival", () => {
    const { playerId } = createPlayer("Open Plan Player", "SMBA-CLSEABCE")
    const charge = finance.getCoachFinancePlayerRecord(playerId, {
      coachId,
      database,
      now,
    })?.registrationCharge
    if (!charge) throw new Error("The registration Charge is unavailable.")
    finance.applyChargeAdjustment({
      chargeId: charge.id,
      kind: "manual_credit",
      amountPaise: charge.outstandingPaise,
      reason: "Approved registration waiver",
      idempotencyKey: "member-closeout-zero-balance",
    }, { coachId, createId, database, now })

    expect(archive(playerId)).toEqual({
      ok: false,
      code: "FINANCIAL_CLOSEOUT_REQUIRED",
      hasOpenFeePlan: true,
      hasOutstandingBalance: false,
      outstandingPaise: 0,
    })
  })
})
