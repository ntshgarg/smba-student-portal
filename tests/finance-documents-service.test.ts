import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-finance-documents-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-finance-documents.db")

describe("Financials document read models", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let documents: typeof import("@/lib/finance/documents")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const playerId = "finance-document-player"
  const paymentId = "finance-document-payment"
  const now = new Date("2026-08-20T10:00:00+05:30")

  function ledgerRowCount() {
    return {
      adjustments: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.chargeAdjustments).get()?.total ?? 0),
      allocations: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.paymentAllocations).get()?.total ?? 0),
      audits: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.financialAuditEvents).get()?.total ?? 0),
      charges: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.financialCharges).get()?.total ?? 0),
      payments: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.payments).get()?.total ?? 0),
      refundAllocations: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.refundAllocations).get()?.total ?? 0),
      refunds: Number(database.select({ total: sql<number>`count(*)` })
        .from(schema.refunds).get()?.total ?? 0),
    }
  }

  beforeAll(async () => {
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    documents = await import("@/lib/finance/documents")
    database = client.initializeDatabase()

    const createdAt = new Date("2026-07-01T10:00:00+05:30")
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: "Document Test Player",
      normalizedName: "document test player",
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: createdAt,
      approvedByAccountId: coachId,
      createdAt,
      updatedAt: createdAt,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: 9_001,
      accountId: playerId,
      createdAt,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Adult",
      batch: "Weekday",
      status: "active",
      joinedAt: createdAt,
      updatedAt: createdAt,
    }).run()
    database.insert(schema.financialCharges).values([{
      id: "finance-document-charge",
      feeReference: "SMBA-DOCUMENT-FEE",
      playerAccountId: playerId,
      type: "monthly_training",
      billingPeriod: "2026-08",
      description: "Monthly training fee - August 2026",
      originalAmountPaise: 350_000,
      currency: "INR",
      dueDate: "2026-08-05",
      lifecycle: "issued",
      recordRevision: 0,
      issuedByAccountId: coachId,
      issuedAt: createdAt,
    }, {
      id: "finance-document-void-charge",
      feeReference: "SMBA-DOCUMENT-VOID",
      playerAccountId: playerId,
      type: "registration",
      billingPeriod: null,
      description: "Registration fee",
      originalAmountPaise: 100_000,
      currency: "INR",
      dueDate: "2026-07-01",
      lifecycle: "void",
      recordRevision: 1,
      issuedByAccountId: coachId,
      issuedAt: createdAt,
      voidedByAccountId: coachId,
      voidedAt: new Date("2026-07-02T10:00:00+05:30"),
      voidReason: "Private correction reason",
    }]).run()
    database.insert(schema.chargeAdjustments).values([{
      id: "finance-document-adjustment",
      chargeId: "finance-document-charge",
      kind: "concession_credit",
      amountPaise: 25_000,
      reason: "Private concession reason",
      createdByAccountId: coachId,
      createdAt,
    }, {
      id: "finance-document-legacy-adjustment",
      chargeId: "finance-document-void-charge",
      kind: "legacy_settlement",
      amountPaise: 100_000,
      reason: "Private legacy settlement reason",
      createdByAccountId: coachId,
      createdAt,
    }]).run()
    database.insert(schema.payments).values({
      id: paymentId,
      playerAccountId: playerId,
      receiptReference: "SMBA-R-2026-09001",
      amountPaise: 300_000,
      currency: "INR",
      receivedOn: "2026-08-08",
      method: "upi",
      externalReference: "UPI-DOCUMENT-1",
      internalNote: "Private payment note",
      lifecycle: "recorded",
      idempotencyKey: "finance-document-payment-key",
      payloadFingerprint: "finance-document-payment-fingerprint",
      recordRevision: 1,
      recordedByAccountId: coachId,
      recordedAt: createdAt,
    }).run()
    database.insert(schema.paymentAllocations).values({
      id: "finance-document-allocation",
      paymentId,
      chargeId: "finance-document-charge",
      amountPaise: 300_000,
      createdByAccountId: coachId,
      createdAt,
    }).run()
    database.insert(schema.refunds).values({
      id: "finance-document-refund",
      refundReference: "SMBA-RF-2026-09001",
      paymentId,
      playerAccountId: playerId,
      amountPaise: 50_000,
      currency: "INR",
      refundedOn: "2026-08-10",
      method: "upi",
      externalReference: "UPI-REFUND-DOCUMENT-1",
      internalNote: "Private refund note",
      lifecycle: "recorded",
      idempotencyKey: "finance-document-refund-key",
      payloadFingerprint: "finance-document-refund-fingerprint",
      recordRevision: 0,
      recordedByAccountId: coachId,
      recordedAt: createdAt,
    }).run()
    database.insert(schema.refundAllocations).values({
      id: "finance-document-refund-allocation",
      refundId: "finance-document-refund",
      paymentAllocationId: "finance-document-allocation",
      amountPaise: 50_000,
      createdAt,
    }).run()
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("derives receipt and statement truth without writing to the ledger", () => {
    const before = ledgerRowCount()
    const receipt = documents.getReceiptDocument(paymentId, { coachId, database, now })
    const statement = documents.getPlayerFeeStatement(playerId, { coachId, database, now })
    const after = ledgerRowCount()

    expect(receipt).toMatchObject({
      amountPaise: 300_000,
      refundedPaise: 50_000,
      netReceivedPaise: 250_000,
      status: "partially_refunded",
      playerName: "Document Test Player",
      academyId: "SMBA#9001",
    })
    expect(statement).toMatchObject({
      playerId,
      currentBalancePaise: 75_000,
    })
    expect(statement?.charges).toHaveLength(2)
    expect(statement?.charges.find((charge) => charge.lifecycle === "void")?.feeReference)
      .toBe("SMBA-DOCUMENT-VOID")
    expect(statement?.charges.find((charge) => charge.lifecycle === "void")?.adjustments)
      .toContainEqual(expect.objectContaining({ kind: "manual_credit", amountPaise: 100_000 }))
    expect(JSON.stringify({ receipt, statement })).not.toContain("Private payment note")
    expect(JSON.stringify({ receipt, statement })).not.toContain("Private refund note")
    expect(JSON.stringify({ receipt, statement })).not.toContain("Private correction reason")
    expect(JSON.stringify({ receipt, statement })).not.toContain("Private concession reason")
    expect(JSON.stringify({ receipt, statement })).not.toContain("Private legacy settlement reason")
    expect(after).toEqual(before)
  })

  it("enforces coach authorization independently of the route", () => {
    expect(() => documents.getReceiptDocument(paymentId, {
      coachId: playerId,
      database,
      now,
    })).toThrowError(/Head coach access is required/u)
    expect(() => documents.getPlayerFeeStatement(playerId, {
      coachId: "missing-coach",
      database,
      now,
    })).toThrowError(/Head coach access is required/u)
  })
})
