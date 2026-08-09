import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-rapid-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "rapid-desk.db")

describe("Financials Rapid Desk focused reads", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-20T10:00:00+05:30")

  function createPlayer(id: string, fullName: string, serial: number) {
    database.insert(schema.accounts).values({
      id,
      fullName,
      normalizedName: fullName.toLocaleLowerCase("en-IN"),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      approvedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial,
      accountId: id,
      createdAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "active",
      joinedAt: now,
      updatedAt: now,
    }).run()
  }

  function createAgreement(playerId: string) {
    const agreementId = `${playerId}-agreement`
    database.insert(schema.feeAgreements).values({
      id: agreementId,
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
    return agreementId
  }

  function createCharge(
    playerId: string,
    agreementId: string,
    suffix: string,
    options: {
      billingPeriod?: string
      dueDate?: string
      settled?: boolean
      type?: "registration" | "monthly_training"
    } = {},
  ) {
    const chargeId = `${playerId}-${suffix}`
    const type = options.type ?? "monthly_training"
    database.insert(schema.financialCharges).values({
      id: chargeId,
      feeReference: `SMBA-${suffix.toUpperCase().padEnd(8, "2").slice(0, 8)}`,
      playerAccountId: playerId,
      feeAgreementId: type === "monthly_training" ? agreementId : null,
      type,
      billingPeriod: type === "monthly_training" ? options.billingPeriod ?? "2026-08" : null,
      description: type === "monthly_training" ? "August training fee" : "Registration fee",
      originalAmountPaise: type === "monthly_training" ? 400_000 : 1_000,
      currency: "INR",
      dueDate: options.dueDate ?? "2026-08-05",
      lifecycle: "issued",
      recordRevision: options.settled ? 1 : 0,
      issuedByAccountId: coachId,
      issuedAt: now,
    }).run()
    if (options.settled) {
      database.insert(schema.chargeAdjustments).values({
        id: `${chargeId}-settlement`,
        chargeId,
        kind: "legacy_settlement",
        amountPaise: type === "monthly_training" ? 400_000 : 1_000,
        reason: "Test settlement",
        createdByAccountId: coachId,
        createdAt: now,
      }).run()
    }
  }

  beforeAll(async () => {
    const client = await import("@/lib/db/client")
    finance = await import("@/lib/finance/service")
    schema = await import("@/lib/db/schema")
    database = client.initializeDatabase()
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "rapid-desk-activation",
    }, { coachId, database, now })

    createPlayer("rapid-due", "Asha Due", 5_001)
    createPlayer("rapid-settled", "Bina Settled", 5_002)
    createPlayer("rapid-no-plan", "Chitra Unconfigured", 5_003)
    createPlayer("rapid-future", "Deepa Future", 5_004)

    const dueAgreement = createAgreement("rapid-due")
    createCharge("rapid-due", dueAgreement, "DUEREG", {
      settled: true,
      type: "registration",
    })
    createCharge("rapid-due", dueAgreement, "DUEMONTH")

    const settledAgreement = createAgreement("rapid-settled")
    createCharge("rapid-settled", settledAgreement, "PAIDREG", {
      settled: true,
      type: "registration",
    })
    createCharge("rapid-settled", settledAgreement, "PAIDMONTH", { settled: true })

    const futureAgreement = createAgreement("rapid-future")
    createCharge("rapid-future", futureAgreement, "FUTUREREG", {
      settled: true,
      type: "registration",
    })
    createCharge("rapid-future", futureAgreement, "FUTUREAUG", { settled: true })
    createCharge("rapid-future", futureAgreement, "FUTURESEP", {
      billingPeriod: "2026-09",
      dueDate: "2026-09-05",
    })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("defaults to payable players and keeps approved non-archived players available for lookup", () => {
    const outstanding = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
    }, { coachId, database, now })
    expect(outstanding.scope).toBe("outstanding")
    expect(outstanding.players.map((player) => player.playerId)).toEqual([
      "rapid-due",
    ])
    expect(outstanding.players[0]?.outstandingPaise).toBe(400_000)
    expect(outstanding.players[0]).toMatchObject({
      hasActiveFeePlan: true,
      paymentEligible: true,
    })

    const all = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      scope: "all",
    }, { coachId, database, now })
    expect(all.players.map((player) => player.playerId).sort()).toEqual([
      "rapid-due",
      "rapid-future",
      "rapid-no-plan",
      "rapid-settled",
    ])
    expect(all.players.find((player) => player.playerId === "rapid-no-plan")).toMatchObject({
      hasActiveFeePlan: false,
      paymentEligible: false,
    })
    expect(all.players.find((player) => player.playerId === "rapid-settled")).toMatchObject({
      hasActiveFeePlan: true,
      paymentEligible: false,
      status: "paid",
    })
  })

  it("opens a selected ledger only for a current-horizon payment-eligible player", () => {
    const due = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      playerId: "rapid-due",
      scope: "outstanding",
    }, { coachId, database, now })
    expect(due.selectedLedger).toMatchObject({
      playerId: "rapid-due",
      currentBalancePaise: 400_000,
    })

    const settled = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      playerId: "rapid-settled",
      scope: "outstanding",
    }, { coachId, database, now })
    expect(settled.players.map((player) => player.playerId)).toEqual([
      "rapid-due",
    ])
    expect(settled.selectedLedger).toBeNull()

    const futurePrepared = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      playerId: "rapid-future",
      scope: "all",
    }, { coachId, database, now })
    expect(futurePrepared.selectedLedger).toBeNull()
    expect(futurePrepared.players.find((player) => player.playerId === "rapid-future"))
      .toMatchObject({
        hasActiveFeePlan: true,
        outstandingPaise: 0,
        paymentEligible: false,
      })
    expect(finance.getCoachFinancePlayerRecord("rapid-future", {
      coachId,
      database,
      now,
    })).toMatchObject({
      currentBalancePaise: 400_000,
    })

    const noPlan = finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      playerId: "rapid-no-plan",
      scope: "all",
    }, { coachId, database, now })
    expect(noPlan.selectedLedger).toBeNull()
    expect(finance.getCoachFinancePlayerRecord("rapid-due", {
      coachId,
      database,
      now,
    })?.playerId).toBe("rapid-due")
  })

  it("settles ended-plan debt while preserving exact retries and rejecting no-plan players", () => {
    createPlayer("rapid-plan-guard", "Esha Plan Guard", 5_005)
    const agreementId = createAgreement("rapid-plan-guard")
    createCharge("rapid-plan-guard", agreementId, "GUARDMONTH")

    const preview = finance.previewPaymentAllocations({
      playerId: "rapid-plan-guard",
      amountPaise: 100_000,
    }, { coachId, database, now })
    let nextId = 0
    const createId = () => `rapid-plan-guard-created-${nextId += 1}`
    const input = {
      playerId: "rapid-plan-guard",
      amountPaise: 100_000,
      receivedOn: "2026-08-20",
      method: "upi" as const,
      allocations: preview.allocations.map((allocation) => ({
        chargeId: allocation.chargeId,
        amountPaise: allocation.amountPaise,
        expectedChargeRevision: allocation.expectedChargeRevision,
      })),
      mutationId: "00000000-0000-4000-8000-000000005005",
    }
    const first = finance.recordAllocatedPayment(input, {
      coachId,
      createId,
      database,
      now,
    })
    expect(first.reused).toBe(false)

    database.update(schema.feeAgreements).set({
      status: "ended",
      effectiveTo: "2026-08-31",
      updatedAt: now,
    }).where(eq(schema.feeAgreements.id, agreementId)).run()

    expect(finance.recordAllocatedPayment(input, {
      coachId,
      createId,
      database,
      now,
    })).toMatchObject({ reused: true, receipt: { id: first.receipt.id } })
    const endedPreview = finance.previewPaymentAllocations({
      playerId: "rapid-plan-guard",
      amountPaise: 100_000,
    }, { coachId, database, now })
    expect(finance.recordAllocatedPayment({
      ...input,
      allocations: endedPreview.allocations,
      mutationId: "00000000-0000-4000-8000-000000005006",
    }, { coachId, createId, database, now })).toMatchObject({ reused: false })
    expect(finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      playerId: "rapid-plan-guard",
      scope: "all",
    }, { coachId, database, now }).selectedLedger).toMatchObject({
      playerId: "rapid-plan-guard",
      currentBalancePaise: 200_000,
    })
    expect(() => finance.previewPaymentAllocations({
      playerId: "rapid-no-plan",
      amountPaise: 100_000,
    }, { coachId, database, now })).toThrow(expect.objectContaining({
      code: "SETUP_REQUIRED",
    }))
  })

  it("does not collect future-prepared monthly charges", () => {
    expect(() => finance.previewPaymentAllocations({
      playerId: "rapid-future",
      amountPaise: 400_000,
    }, { coachId, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
    }))
    expect(() => finance.recordAllocatedPayment({
      playerId: "rapid-future",
      amountPaise: 400_000,
      receivedOn: "2026-08-20",
      method: "cash",
      allocations: [{
        chargeId: "rapid-future-FUTURESEP",
        amountPaise: 400_000,
        expectedChargeRevision: 0,
      }],
      mutationId: "00000000-0000-4000-8000-000000005007",
    }, {
      coachId,
      createId: () => "rapid-future-payment-should-not-exist",
      database,
      now,
    })).toThrow(expect.objectContaining({
      code: "NOT_FOUND",
    }))
  })

  it("enforces coach authorization and validates the scope", () => {
    expect(() => finance.getCoachFinanceRapidDesk({
      period: "2026-08",
    }, { coachId: "rapid-due", database, now })).toThrow()
    expect(() => finance.getCoachFinancePlayerRecord("rapid-due", {
      coachId: "rapid-due",
      database,
      now,
    })).toThrow()
    expect(() => finance.getCoachFinanceRapidDesk({
      period: "2026-08",
      scope: "invalid" as "all",
    }, { coachId, database, now })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
    }))
  })

  it("loads monthly preparation through its focused coach query", () => {
    const preview = finance.getCoachMonthlyPreparationPreview("2026-08", {
      coachId,
      database,
    })

    expect(preview).toEqual(finance.getCoachFinanceWorkspace({
      period: "2026-08",
      view: "all",
    }, { coachId, database, now }).preparation)

    expect(() => finance.getCoachMonthlyPreparationPreview("not-a-month", {
      coachId,
      database,
    })).toThrow(expect.objectContaining({
      code: "INVALID_INPUT",
    }))
    expect(() => finance.getCoachMonthlyPreparationPreview("2026-08", {
      coachId: "rapid-due",
      database,
    })).toThrow()
  })
})
