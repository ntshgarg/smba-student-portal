import "server-only"

import { asc, eq } from "drizzle-orm"

import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabaseExecutor } from "@/lib/db/client"
import { initializeDatabase } from "@/lib/db/client"
import { financialCharges, payments } from "@/lib/db/schema"
import {
  loadChargeView,
  loadPlayerFeeRecord,
} from "@/lib/finance/repository"
import { FinanceServiceError } from "@/lib/finance/service"
import type {
  AdjustmentKind,
  ChargeLifecycle,
  ChargeType,
  FinanceStatus,
  PaymentLifecycle,
  PaymentMethod,
} from "@/lib/finance/types"

type FinanceDocumentContext = {
  coachId: string
  database?: SmbaDatabaseExecutor
  now?: Date
}

export type FinanceDocumentRefund = {
  refundReference: string
  amountPaise: number
  refundedOn: string
  lifecycle: PaymentLifecycle
}

export type FinanceReceiptDocument = {
  paymentId: string
  receiptReference: string
  playerId: string
  playerName: string
  academyId: string
  amountPaise: number
  refundedPaise: number
  netReceivedPaise: number
  receivedOn: string
  method: PaymentMethod
  externalReference: string | null
  lifecycle: PaymentLifecycle
  status: "recorded" | "partially_refunded" | "fully_refunded" | "reversed"
  allocations: Array<{
    feeReference: string
    description: string
    amountPaise: number
  }>
  refunds: FinanceDocumentRefund[]
  generatedAt: string
}

export type FinanceStatementChargeAdjustment = {
  kind: AdjustmentKind
  amountPaise: number
  createdAt: string
  lifecycle: "active" | "reversed"
}

export type FinanceStatementCharge = {
  feeReference: string
  type: ChargeType
  billingPeriod: string | null
  description: string
  originalAmountPaise: number
  effectiveAmountPaise: number
  receivedPaise: number
  outstandingPaise: number
  dueDate: string
  lifecycle: ChargeLifecycle
  status: FinanceStatus
  adjustments: FinanceStatementChargeAdjustment[]
}

export type FinanceStatementReceipt = Omit<
  FinanceReceiptDocument,
  "academyId" | "generatedAt" | "paymentId" | "playerId" | "playerName"
>

export type FinanceStatementDocument = {
  playerId: string
  playerName: string
  academyId: string
  archived: boolean
  status: FinanceStatus
  currentBalancePaise: number
  charges: FinanceStatementCharge[]
  receipts: FinanceStatementReceipt[]
  generatedAt: string
}

function requireCoach(database: SmbaDatabaseExecutor, coachId: string) {
  try {
    requireHeadAdminAccess(coachId, { database })
  } catch {
    throw new FinanceServiceError(
      "AUTHORIZATION",
      "Head coach access is required to generate financial records.",
    )
  }
}

function receiptStatus(
  lifecycle: PaymentLifecycle,
  amountPaise: number,
  refundedPaise: number,
): FinanceReceiptDocument["status"] {
  if (lifecycle === "reversed") return "reversed"
  if (refundedPaise >= amountPaise) return "fully_refunded"
  if (refundedPaise > 0) return "partially_refunded"
  return "recorded"
}

function toReceiptDocument(
  receipt: NonNullable<ReturnType<typeof loadPlayerFeeRecord>>["receipts"][number],
  player: { playerId: string; fullName: string; academyId: string },
  generatedAt: string,
): FinanceReceiptDocument {
  const refundedPaise = receipt.refundedPaise ?? receipt.refunds
    .filter((refund) => refund.lifecycle === "recorded")
    .reduce((total, refund) => total + refund.amountPaise, 0)

  return {
    paymentId: receipt.id,
    receiptReference: receipt.receiptReference,
    playerId: player.playerId,
    playerName: player.fullName,
    academyId: player.academyId,
    amountPaise: receipt.amountPaise,
    refundedPaise,
    netReceivedPaise: receipt.lifecycle === "reversed"
      ? 0
      : Math.max(0, receipt.amountPaise - refundedPaise),
    receivedOn: receipt.receivedOn,
    method: receipt.method,
    externalReference: receipt.externalReference,
    lifecycle: receipt.lifecycle,
    status: receiptStatus(receipt.lifecycle, receipt.amountPaise, refundedPaise),
    allocations: receipt.allocations.map((allocation) => ({
      feeReference: allocation.feeReference,
      description: allocation.description,
      amountPaise: allocation.amountPaise,
    })),
    refunds: receipt.refunds.map((refund) => ({
      refundReference: refund.refundReference,
      amountPaise: refund.amountPaise,
      refundedOn: refund.refundedOn,
      lifecycle: refund.lifecycle,
    })),
    generatedAt,
  }
}

/**
 * Builds a coach-authorized, presentation-safe receipt from current ledger facts.
 * This function performs reads only and deliberately excludes private notes and reasons.
 */
export function getReceiptDocument(
  paymentId: string,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: FinanceDocumentContext,
): FinanceReceiptDocument | null {
  requireCoach(database, coachId)
  if (!paymentId.trim()) return null

  const payment = database.select({
    id: payments.id,
    playerId: payments.playerAccountId,
  }).from(payments).where(eq(payments.id, paymentId)).get()
  if (!payment) return null

  const record = loadPlayerFeeRecord(database, payment.playerId, now)
  const receipt = record?.receipts.find((item) => item.id === payment.id)
  if (!record || !receipt) return null

  return toReceiptDocument(receipt, {
    playerId: record.playerId,
    fullName: record.fullName,
    academyId: record.academyId,
  }, now.toISOString())
}

/**
 * Builds a complete coach-authorized statement from current ledger facts.
 * Voided Charges and reversed receipts remain visible as immutable history.
 */
export function getPlayerFeeStatement(
  playerId: string,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: FinanceDocumentContext,
): FinanceStatementDocument | null {
  requireCoach(database, coachId)
  if (!playerId.trim()) return null

  const record = loadPlayerFeeRecord(database, playerId, now, true)
  if (!record) return null

  const charges = database.select({ id: financialCharges.id })
    .from(financialCharges)
    .where(eq(financialCharges.playerAccountId, playerId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.issuedAt), asc(financialCharges.id))
    .all()
    .flatMap(({ id }) => {
      const charge = loadChargeView(database, id, now, true)
      if (!charge) return []
      return [{
        feeReference: charge.feeReference,
        type: charge.type,
        billingPeriod: charge.billingPeriod,
        description: charge.description,
        originalAmountPaise: charge.originalAmountPaise,
        effectiveAmountPaise: charge.effectiveAmountPaise,
        receivedPaise: charge.receivedPaise,
        outstandingPaise: charge.outstandingPaise,
        dueDate: charge.dueDate,
        lifecycle: charge.lifecycle,
        status: charge.status,
        adjustments: (charge.adjustments ?? []).map((adjustment) => ({
          kind: adjustment.kind,
          amountPaise: adjustment.amountPaise,
          createdAt: adjustment.createdAt,
          lifecycle: adjustment.reversed ? "reversed" as const : "active" as const,
        })),
      }]
    })
  const generatedAt = now.toISOString()
  const receiptPlayer = {
    playerId: record.playerId,
    fullName: record.fullName,
    academyId: record.academyId,
  }

  return {
    playerId: record.playerId,
    playerName: record.fullName,
    academyId: record.academyId,
    archived: record.archived,
    status: record.status,
    currentBalancePaise: record.currentBalancePaise,
    charges,
    receipts: record.receipts.map((receipt) => {
      const document = toReceiptDocument(receipt, receiptPlayer, generatedAt)
      return {
        receiptReference: document.receiptReference,
        amountPaise: document.amountPaise,
        refundedPaise: document.refundedPaise,
        netReceivedPaise: document.netReceivedPaise,
        receivedOn: document.receivedOn,
        method: document.method,
        externalReference: document.externalReference,
        lifecycle: document.lifecycle,
        status: document.status,
        allocations: document.allocations,
        refunds: document.refunds,
      }
    }),
    generatedAt,
  }
}
