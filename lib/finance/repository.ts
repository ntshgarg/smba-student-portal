import "server-only"

import { and, asc, desc, eq, gt, gte, isNull, lte, ne, or, sql } from "drizzle-orm"

import { formatAcademyId } from "@/lib/auth/identity"
import type { SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  chargeAdjustments,
  concessionApplications,
  concessions,
  feeAgreements,
  financialAuditEvents,
  financialCharges,
  payments,
  paymentAllocations,
  playerEnrollments,
  refundAllocations,
  refunds,
  sessionAssignments,
  sessionSeries,
} from "@/lib/db/schema"
import {
  calculateChargeLedger,
  combineFinanceStatuses,
  deriveFinanceStatus,
  monthEnd,
  monthStart,
} from "@/lib/finance/domain"
import {
  FINANCE_CURRENCY,
  type ChargeView,
  type CoachFinanceManagementView,
  type FinanceActivation,
  type FinancePlayerListItem,
  type PaymentMethod,
  type PlayerConcessionEntryView,
  type PlayerFeeRecord,
  type PlayerReceiptView,
} from "@/lib/finance/types"
import { getAcademyDateKey } from "@/lib/format"
import { defaultMonthlyFeePaise } from "@/lib/finance/config"

export const FINANCE_ACADEMY_ENTITY_ID = "smba"

type Executor = SmbaDatabaseExecutor

export function readFinanceActivation(database: Executor): FinanceActivation | null {
  const row = database.select({
    metadata: financialAuditEvents.metadata,
    occurredAt: financialAuditEvents.occurredAt,
  }).from(financialAuditEvents).where(and(
    eq(financialAuditEvents.eventType, "finance_activated"),
    eq(financialAuditEvents.entityType, "academy"),
    eq(financialAuditEvents.entityId, FINANCE_ACADEMY_ENTITY_ID),
  )).get()
  if (!row) return null

  const metadata: unknown = JSON.parse(row.metadata)
  if (!metadata || typeof metadata !== "object" || !("trackingMonth" in metadata)
    || typeof metadata.trackingMonth !== "string") {
    throw new Error("The finance activation record is invalid.")
  }
  return { activatedAt: row.occurredAt.toISOString(), trackingMonth: metadata.trackingMonth }
}

export function readActivePlayer(database: Executor, playerId: string) {
  return database.select({
    academyIdSerial: academyIdAllocations.serial,
    academyPlan: playerEnrollments.academyPlan,
    batch: playerEnrollments.batch,
    fullName: accounts.fullName,
    id: accounts.id,
    level: playerEnrollments.level,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(accounts.id, playerId),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).get()
}

export function readFinancePlayer(database: Executor, playerId: string) {
  return database.select({
    academyIdSerial: academyIdAllocations.serial,
    academyPlan: playerEnrollments.academyPlan,
    archivedAt: accounts.archivedAt,
    batch: playerEnrollments.batch,
    fullName: accounts.fullName,
    id: accounts.id,
    level: playerEnrollments.level,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(accounts.id, playerId),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
    )).get()
}

export function readActiveFeeAgreement(database: Executor, playerId: string) {
  return database.select().from(feeAgreements).where(and(
    eq(feeAgreements.playerAccountId, playerId),
    eq(feeAgreements.status, "active"),
  )).get()
}

export function readFirstAssignmentDate(database: Executor, playerId: string) {
  return database.select({ effectiveFrom: sessionAssignments.effectiveFrom })
    .from(sessionAssignments)
    .where(eq(sessionAssignments.accountId, playerId))
    .orderBy(asc(sessionAssignments.effectiveFrom))
    .get()?.effectiveFrom ?? null
}

export function hasAssignmentInPeriod(
  database: Executor,
  playerId: string,
  period: string,
  training?: {
    programme: typeof feeAgreements.$inferSelect.level
    batch: typeof feeAgreements.$inferSelect.batch
  },
) {
  return Boolean(database.select({ id: sessionAssignments.id })
    .from(sessionAssignments)
    .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
    .where(and(
      eq(sessionAssignments.accountId, playerId),
      training ? eq(sessionSeries.programme, training.programme) : undefined,
      training ? eq(sessionSeries.batch, training.batch) : undefined,
      lte(sessionAssignments.effectiveFrom, monthEnd(period)),
      or(
        isNull(sessionAssignments.effectiveTo),
        gt(sessionAssignments.effectiveTo, monthStart(period)),
      ),
      lte(sessionSeries.startsOn, monthEnd(period)),
      or(isNull(sessionSeries.endsOn), gte(sessionSeries.endsOn, monthStart(period))),
    )).get())
}

export function hasCurrentOrFutureMatchingAssignment(
  database: Executor,
  playerId: string,
  referenceDate: string,
  training: {
    programme: typeof feeAgreements.$inferSelect.level
    batch: typeof feeAgreements.$inferSelect.batch
  },
) {
  return database.select({
    effectiveFrom: sessionAssignments.effectiveFrom,
    effectiveTo: sessionAssignments.effectiveTo,
    seriesEndsOn: sessionSeries.endsOn,
    seriesStartsOn: sessionSeries.startsOn,
  }).from(sessionAssignments)
    .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
    .where(and(
      eq(sessionAssignments.accountId, playerId),
      eq(sessionSeries.programme, training.programme),
      eq(sessionSeries.batch, training.batch),
      eq(sessionSeries.status, "active"),
    )).all()
    .some((assignment) => {
      const startsOn = assignment.effectiveFrom > assignment.seriesStartsOn
        ? assignment.effectiveFrom
        : assignment.seriesStartsOn
      const endsOn = [assignment.effectiveTo, assignment.seriesEndsOn]
        .filter((value): value is string => value !== null)
        .reduce<string | null>((earliest, value) => (
          earliest === null || value < earliest ? value : earliest
        ), null)

      return (endsOn === null || endsOn >= startsOn)
        && (endsOn === null || endsOn >= referenceDate)
    })
}

export function readAuditEventByIdempotencyKey(database: Executor, idempotencyKey: string) {
  return database.select().from(financialAuditEvents)
    .where(eq(financialAuditEvents.idempotencyKey, idempotencyKey)).get()
}

export function readPaymentByIdempotencyKey(database: Executor, idempotencyKey: string) {
  return database.select().from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey)).get()
}

export function readCharge(database: Executor, chargeId: string) {
  return database.select().from(financialCharges)
    .where(eq(financialCharges.id, chargeId)).get()
}

function chargeView(
  database: Executor,
  charge: typeof financialCharges.$inferSelect,
  now: Date,
  includeInternal = false,
) {
  const allocationRows = database.select({
    allocation: paymentAllocations,
    payment: payments,
  }).from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.chargeId, charge.id))
    .orderBy(asc(payments.receivedOn), asc(payments.recordedAt))
    .all()
  const refundRows = database.select({
    allocation: refundAllocations,
    refund: refunds,
  }).from(refundAllocations)
    .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
    .innerJoin(
      paymentAllocations,
      eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
    )
    .where(eq(paymentAllocations.chargeId, charge.id))
    .all()
  const adjustmentRows = database.select().from(chargeAdjustments)
    .where(eq(chargeAdjustments.chargeId, charge.id))
    .all()
  const ledgerInput = {
    originalAmountPaise: charge.originalAmountPaise,
    dueDate: charge.dueDate,
    lifecycle: charge.lifecycle,
    payments: allocationRows.map(({ allocation, payment }) => ({
      amountPaise: allocation.amountPaise,
      lifecycle: payment.lifecycle,
    })),
    refunds: refundRows.map(({ allocation, refund }) => ({
      amountPaise: allocation.amountPaise,
      lifecycle: refund.lifecycle,
    })),
    adjustments: adjustmentRows.map((adjustment) => ({
      amountPaise: adjustment.amountPaise,
      kind: adjustment.kind,
      reversedAt: adjustment.reversedAt,
    })),
  }
  const calculated = calculateChargeLedger(ledgerInput)
  const ledger = {
    effectiveAmountPaise: calculated.effectiveAmountPaise,
    receivedPaise: calculated.receivedPaise,
    outstandingPaise: calculated.outstandingPaise,
  }

  const view: ChargeView = {
    id: charge.id,
    feeReference: charge.feeReference,
    type: charge.type,
    billingPeriod: charge.billingPeriod,
    description: charge.description,
    originalAmountPaise: charge.originalAmountPaise,
    ...ledger,
    currency: FINANCE_CURRENCY,
    dueDate: charge.dueDate,
    lifecycle: charge.lifecycle,
    status: deriveFinanceStatus(ledgerInput, getAcademyDateKey(now)),
    recordRevision: charge.recordRevision,
    canVoid: !allocationRows.some(({ payment }) => payment.lifecycle === "recorded"),
    payments: allocationRows.map(({ allocation, payment }) => ({
      id: payment.id,
      receiptReference: payment.receiptReference,
      amountPaise: allocation.amountPaise,
      paymentAmountPaise: payment.amountPaise,
      receivedOn: payment.receivedOn,
      method: payment.method as PaymentMethod,
      externalReference: payment.externalReference,
      lifecycle: payment.lifecycle,
      ...(includeInternal ? { internalNote: payment.internalNote } : {}),
    })),
  }
  if (includeInternal) {
    view.adjustments = adjustmentRows.map((adjustment) => ({
      id: adjustment.id,
      kind: adjustment.kind === "legacy_settlement" ? "manual_credit" : adjustment.kind,
      amountPaise: adjustment.amountPaise,
      reason: adjustment.kind === "legacy_settlement"
        ? "Historical credit adjustment"
        : adjustment.reason,
      createdAt: adjustment.createdAt.toISOString(),
      reversed: adjustment.reversedAt !== null,
      canReverse: !["legacy_settlement", "withdrawal_credit"].includes(adjustment.kind),
    }))
  }
  return view
}

export function loadChargeView(
  database: Executor,
  chargeId: string,
  now = new Date(),
  includeInternal = false,
) {
  const charge = readCharge(database, chargeId)
  return charge ? chargeView(database, charge, now, includeInternal) : null
}

function loadPlayerPhaseTwoHistory(
  database: Executor,
  playerId: string,
  includeInternal: boolean,
  now: Date,
) {
  const paymentRows = database.select().from(payments)
    .where(eq(payments.playerAccountId, playerId))
    .orderBy(desc(payments.receivedOn), desc(payments.recordedAt), desc(payments.id))
    .all()
  const receiptPairs = paymentRows.map((payment) => {
    const allocations = database.select({
      allocation: paymentAllocations,
      charge: financialCharges,
    }).from(paymentAllocations)
      .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
      .where(eq(paymentAllocations.paymentId, payment.id))
      .orderBy(asc(financialCharges.dueDate), asc(financialCharges.id))
      .all()
    const paymentRefunds = database.select().from(refunds)
      .where(eq(refunds.paymentId, payment.id))
      .orderBy(desc(refunds.refundedOn), desc(refunds.recordedAt), desc(refunds.id))
      .all()
    const activeAllocatedRefundPaise = database.select({
      total: sql<number>`coalesce(sum(${refundAllocations.amountPaise}), 0)`,
    }).from(refundAllocations)
      .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
      .innerJoin(
        paymentAllocations,
        eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
      )
      .where(and(
        eq(paymentAllocations.paymentId, payment.id),
        eq(refunds.lifecycle, "recorded"),
      )).get()?.total ?? 0
    const publicRefunds = paymentRefunds.map((refund) => ({
      id: refund.id,
      paymentId: payment.id,
      receiptReference: payment.receiptReference,
      refundReference: refund.refundReference,
      purpose: refund.purpose,
      withdrawalEffectiveOn: refund.withdrawalEffectiveOn,
      amountPaise: refund.amountPaise,
      refundedOn: refund.refundedOn,
      lifecycle: refund.lifecycle,
    }))
    const publicReceipt: PlayerReceiptView = {
      id: payment.id,
      receiptReference: payment.receiptReference,
      amountPaise: payment.amountPaise,
      receivedOn: payment.receivedOn,
      method: payment.method as PaymentMethod,
      externalReference: payment.externalReference,
      lifecycle: payment.lifecycle,
      allocations: allocations.map(({ allocation, charge }) => ({
        id: allocation.id,
        chargeId: charge.id,
        chargeType: charge.type,
        billingPeriod: charge.billingPeriod,
        feeReference: charge.feeReference,
        description: charge.description,
        amountPaise: allocation.amountPaise,
      })),
      refunds: publicRefunds,
      refundedPaise: Number(activeAllocatedRefundPaise),
    }
    if (!includeInternal) return { publicReceipt, coachReceipt: null, coachRefunds: [] }

    const coachAllocations = allocations.map(({ allocation, charge }) => {
      const activeRefunded = database.select({
        total: sql<number>`coalesce(sum(${refundAllocations.amountPaise}), 0)`,
      }).from(refundAllocations)
        .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
        .where(and(
          eq(refundAllocations.paymentAllocationId, allocation.id),
          eq(refunds.lifecycle, "recorded"),
        )).get()?.total ?? 0
      const chargeLedger = chargeView(database, charge, now)
      const agreement = charge.feeAgreementId
        ? database.select().from(feeAgreements)
          .where(eq(feeAgreements.id, charge.feeAgreementId)).get()
        : null
      const laterCharge = charge.billingPeriod
        ? database.select({ id: financialCharges.id }).from(financialCharges).where(and(
          eq(financialCharges.playerAccountId, charge.playerAccountId),
          eq(financialCharges.type, "monthly_training"),
          eq(financialCharges.lifecycle, "issued"),
          gt(financialCharges.billingPeriod, charge.billingPeriod),
        )).get()
        : null
      const activeWithdrawalRefund = database.select({ id: refunds.id })
        .from(refundAllocations)
        .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
        .innerJoin(
          paymentAllocations,
          eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
        )
        .where(and(
          eq(paymentAllocations.chargeId, charge.id),
          eq(refunds.lifecycle, "recorded"),
          eq(refunds.purpose, "mid_term_withdrawal"),
        )).get()
      const reversedWithdrawalRefund = database.select({
        id: refunds.id,
        withdrawalEffectiveOn: refunds.withdrawalEffectiveOn,
      })
        .from(refundAllocations)
        .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
        .innerJoin(
          paymentAllocations,
          eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
        )
        .where(and(
          eq(paymentAllocations.chargeId, charge.id),
          eq(refunds.lifecycle, "reversed"),
          eq(refunds.purpose, "mid_term_withdrawal"),
          agreement?.effectiveTo
            ? eq(refunds.withdrawalEffectiveOn, agreement.effectiveTo)
            : undefined,
        )).get()
      const agreementCanClose = agreement?.status === "active"
        || (agreement?.status === "ended"
          && reversedWithdrawalRefund?.withdrawalEffectiveOn === agreement.effectiveTo)
      const withdrawalEligible = payment.lifecycle === "recorded"
        && charge.type === "monthly_training"
        && Boolean(charge.billingPeriod)
        && agreementCanClose
        && !laterCharge
        && !activeWithdrawalRefund
        && chargeLedger.effectiveAmountPaise > 0
        && chargeLedger.outstandingPaise === 0
        && chargeLedger.receivedPaise === chargeLedger.effectiveAmountPaise
      return {
        ...publicReceipt.allocations.find((item) => item.id === allocation.id)!,
        paymentAllocationId: allocation.id,
        refundablePaise: withdrawalEligible
          ? Math.max(0, allocation.amountPaise - Number(activeRefunded))
          : 0,
      }
    })
    const coachRefunds = paymentRefunds.map((refund) => {
      const allocationsForRefund = database.select({
        amountPaise: refundAllocations.amountPaise,
        paymentAllocationId: paymentAllocations.id,
        chargeId: financialCharges.id,
        feeReference: financialCharges.feeReference,
      }).from(refundAllocations)
        .innerJoin(
          paymentAllocations,
          eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
        )
        .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
        .where(eq(refundAllocations.refundId, refund.id))
        .all()
      return {
        ...publicRefunds.find((item) => item.id === refund.id)!,
        method: refund.method as PaymentMethod,
        externalReference: refund.externalReference,
        internalNote: refund.internalNote,
        allocations: allocationsForRefund,
        canReverse: refund.lifecycle === "recorded",
        recordRevision: refund.recordRevision,
      }
    })
    return {
      publicReceipt,
      coachReceipt: {
        ...publicReceipt,
        allocations: coachAllocations,
        refundablePaise: coachAllocations.reduce(
          (total, allocation) => total + allocation.refundablePaise,
          0,
        ),
        canRefund: payment.lifecycle === "recorded"
          && coachAllocations.some((allocation) => allocation.refundablePaise > 0),
        recordRevision: payment.recordRevision,
        internalNote: payment.internalNote,
      },
      coachRefunds,
    }
  })

  const applicationRows = database.select({
    application: concessionApplications,
    charge: financialCharges,
  }).from(concessionApplications)
    .innerJoin(financialCharges, eq(financialCharges.id, concessionApplications.chargeId))
    .innerJoin(concessions, eq(concessions.id, concessionApplications.concessionId))
    .where(eq(concessions.playerAccountId, playerId))
    .orderBy(desc(concessionApplications.appliedOn), desc(concessionApplications.createdAt))
    .all()
  const concessionEntries: PlayerConcessionEntryView[] = applicationRows.map(({
    application,
    charge,
  }) => ({
    id: application.id,
    chargeId: charge.id,
    feeReference: charge.feeReference,
    amountPaise: application.amountPaise,
    appliedOn: application.appliedOn,
    label: "Fee concession",
    lifecycle: application.reversedAt ? "reversed" : "applied",
  }))

  let coachManagement: CoachFinanceManagementView | undefined
  if (includeInternal) {
    const concessionRows = database.select().from(concessions)
      .where(eq(concessions.playerAccountId, playerId))
      .orderBy(desc(concessions.createdAt), desc(concessions.id))
      .all()
    coachManagement = {
      receipts: receiptPairs.flatMap(({ coachReceipt }) => coachReceipt ? [coachReceipt] : []),
      refunds: receiptPairs.flatMap(({ coachRefunds }) => coachRefunds),
      concessions: concessionRows.map((concession) => {
        const applications = applicationRows
          .filter(({ application }) => application.concessionId === concession.id)
          .map(({ application, charge }) => ({
            id: application.id,
            applicationId: application.id,
            concessionId: concession.id,
            chargeId: charge.id,
            feeReference: charge.feeReference,
            amountPaise: application.amountPaise,
            appliedOn: application.appliedOn,
            label: "Fee concession" as const,
            lifecycle: application.reversedAt ? "reversed" as const : "applied" as const,
            canReverse: !application.reversedAt,
          }))
        return {
          id: concession.id,
          playerId: concession.playerAccountId,
          mode: concession.mode,
          valueKind: concession.valueKind,
          value: concession.value,
          startsPeriod: concession.startsPeriod,
          endsPeriod: concession.endsPeriod,
          lifecycle: concession.lifecycle,
          recordRevision: concession.recordRevision,
          reason: concession.reason,
          applications,
          // Reversing a Concession ends future use. Historical applications remain
          // immutable ledger facts and are corrected only through their own action.
          canReverse: concession.lifecycle === "active",
        }
      }),
    }
  }
  return {
    receipts: receiptPairs.map(({ publicReceipt }) => publicReceipt),
    concessionEntries,
    coachManagement,
  }
}

export function loadPlayerFeeRecord(
  database: Executor,
  playerId: string,
  now = new Date(),
  includeInternal = false,
): PlayerFeeRecord | null {
  const player = readFinancePlayer(database, playerId)
  if (!player) return null
  const charges = database.select().from(financialCharges)
    .where(eq(financialCharges.playerAccountId, playerId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.issuedAt))
    .all()
    .map((charge) => chargeView(database, charge, now, includeInternal))
  const activeCharges = charges.filter((charge) => charge.lifecycle === "issued")
  const agreement = readActiveFeeAgreement(database, playerId)
  const registrationCharge = charges.find((charge) => (
    charge.type === "registration" && charge.lifecycle === "issued"
  )) ?? [...charges].reverse().find((charge) => charge.type === "registration") ?? null
  const registrationResolutionRequired = readFinanceActivation(database) !== null
    && !activeCharges.some((charge) => charge.type === "registration")
  const suggestedAmount = player.academyPlan && player.level && player.batch
    ? defaultMonthlyFeePaise({
      academyPlan: player.academyPlan,
      level: player.level,
      batch: player.batch,
    })
    : null
  const enrollmentDefaults = !player.archivedAt
    && player.academyPlan && player.level && player.batch && suggestedAmount
    ? {
      academyPlan: player.academyPlan,
      level: player.level,
      batch: player.batch,
      suggestedMonthlyFeePaise: suggestedAmount,
    }
    : null
  const feePlanSetupReady = Boolean(enrollmentDefaults && hasCurrentOrFutureMatchingAssignment(
    database,
    playerId,
    getAcademyDateKey(now),
    {
      programme: enrollmentDefaults.level,
      batch: enrollmentDefaults.batch,
    },
  ))
  const phaseTwoHistory = loadPlayerPhaseTwoHistory(database, playerId, includeInternal, now)

  return {
    playerId,
    academyId: formatAcademyId(player.academyIdSerial),
    fullName: player.fullName,
    archived: player.archivedAt !== null,
    registrationResolutionRequired,
    status: combineFinanceStatuses(activeCharges.map((charge) => charge.status)),
    currentBalancePaise: activeCharges.reduce(
      (total, charge) => total + charge.outstandingPaise,
      0,
    ),
    feePlanSetupReady,
    feeAgreement: agreement ? {
      id: agreement.id,
      academyPlan: agreement.academyPlan,
      level: agreement.level,
      batch: agreement.batch,
      agreedMonthlyFeePaise: agreement.agreedMonthlyFeePaise,
      currency: FINANCE_CURRENCY,
      monthlyDueDay: agreement.monthlyDueDay,
      effectiveFrom: agreement.effectiveFrom,
      effectiveTo: agreement.effectiveTo,
      status: agreement.status,
      recordRevision: agreement.recordRevision,
    } : null,
    enrollmentDefaults,
    setupDefaults: agreement ? null : enrollmentDefaults,
    registrationCharge,
    monthlyCharges: charges.filter((charge) => charge.type === "monthly_training").reverse(),
    receipts: phaseTwoHistory.receipts,
    concessionEntries: phaseTwoHistory.concessionEntries,
    ...(phaseTwoHistory.coachManagement
      ? { coachManagement: phaseTwoHistory.coachManagement }
      : {}),
  }
}

export function listFinancePlayers(
  database: Executor,
  {
    now = new Date(),
    period,
    query = "",
  }: { now?: Date; period: string; query?: string },
): FinancePlayerListItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en-IN")
  const searchPattern = `%${normalizedQuery.replace(/[\\%_]/gu, "\\$&")}%`
  const academySerial = /^smba#\d{4}$/u.test(normalizedQuery)
    ? Number(normalizedQuery.slice(5))
    : null
  const paymentTotal = sql<number>`coalesce((
    select sum(${paymentAllocations.amountPaise}) from ${paymentAllocations}
    inner join ${payments} on ${payments.id} = ${paymentAllocations.paymentId}
    where ${paymentAllocations.chargeId} = ${financialCharges.id}
      and ${payments.lifecycle} = 'recorded'
  ), 0)`
  const refundTotal = sql<number>`coalesce((
    select sum(${refundAllocations.amountPaise}) from ${refundAllocations}
    inner join ${refunds} on ${refunds.id} = ${refundAllocations.refundId}
    inner join ${paymentAllocations}
      on ${paymentAllocations.id} = ${refundAllocations.paymentAllocationId}
    where ${paymentAllocations.chargeId} = ${financialCharges.id}
      and ${refunds.lifecycle} = 'recorded'
  ), 0)`
  const debitTotal = sql<number>`coalesce((
    select sum(${chargeAdjustments.amountPaise}) from ${chargeAdjustments}
    where ${chargeAdjustments.chargeId} = ${financialCharges.id}
      and ${chargeAdjustments.kind} = 'manual_debit'
      and ${chargeAdjustments.reversedAt} is null
  ), 0)`
  const creditTotal = sql<number>`coalesce((
    select sum(${chargeAdjustments.amountPaise}) from ${chargeAdjustments}
    where ${chargeAdjustments.chargeId} = ${financialCharges.id}
      and ${chargeAdjustments.kind} in (
        'manual_credit',
        'legacy_settlement',
        'concession_credit',
        'withdrawal_credit'
      )
      and ${chargeAdjustments.reversedAt} is null
  ), 0)`
  const hasActiveAgreement = sql<number>`exists (
    select 1 from ${feeAgreements}
    where ${feeAgreements.playerAccountId} = ${accounts.id}
      and ${feeAgreements.status} = 'active'
      and ${feeAgreements.academyPlan} = ${playerEnrollments.academyPlan}
      and ${feeAgreements.level} = ${playerEnrollments.level}
      and ${feeAgreements.batch} = ${playerEnrollments.batch}
  )`
  const hasPaymentAgreementHistory = sql<number>`exists (
    select 1 from ${feeAgreements}
    where ${feeAgreements.playerAccountId} = ${accounts.id}
      and ${feeAgreements.status} in ('active', 'ended')
  )`
  const hasPeriodAssignment = sql<number>`exists (
    select 1 from ${sessionAssignments}
    inner join ${sessionSeries} on ${sessionSeries.id} = ${sessionAssignments.seriesId}
    where ${sessionAssignments.accountId} = ${accounts.id}
      and ${sessionSeries.programme} = ${playerEnrollments.level}
      and ${sessionSeries.batch} = ${playerEnrollments.batch}
      and ${sessionAssignments.effectiveFrom} <= ${monthEnd(period)}
      and (${sessionAssignments.effectiveTo} is null
        or ${sessionAssignments.effectiveTo} > ${monthStart(period)})
      and ${sessionSeries.startsOn} <= ${monthEnd(period)}
      and (${sessionSeries.endsOn} is null or ${sessionSeries.endsOn} >= ${monthStart(period)})
  )`
  const rows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    fullName: accounts.fullName,
    archivedAt: accounts.archivedAt,
    playerId: accounts.id,
    chargeId: financialCharges.id,
    chargeType: financialCharges.type,
    billingPeriod: financialCharges.billingPeriod,
    feeReference: financialCharges.feeReference,
    originalAmountPaise: financialCharges.originalAmountPaise,
    dueDate: financialCharges.dueDate,
    paymentTotal,
    refundTotal,
    debitTotal,
    creditTotal,
    hasActiveAgreement,
    hasPaymentAgreementHistory,
    hasPeriodAssignment,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .leftJoin(financialCharges, and(
      eq(financialCharges.playerAccountId, accounts.id),
      eq(financialCharges.lifecycle, "issued"),
      or(
        and(
          eq(financialCharges.type, "monthly_training"),
          lte(financialCharges.billingPeriod, period),
        ),
        eq(financialCharges.type, "registration"),
      ),
    ))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      normalizedQuery ? undefined : isNull(accounts.archivedAt),
      normalizedQuery
        ? or(
          sql`lower(${accounts.fullName}) like ${searchPattern} escape '\\'`,
          academySerial === null ? undefined : eq(academyIdAllocations.serial, academySerial),
          sql`exists (
            select 1 from ${financialCharges} search_charge
            where search_charge.player_account_id = ${accounts.id}
              and lower(search_charge.fee_reference) like ${searchPattern} escape '\\'
          )`,
          sql`exists (
            select 1 from ${payments} search_payment
            where search_payment.player_account_id = ${accounts.id}
              and lower(search_payment.receipt_reference) like ${searchPattern} escape '\\'
          )`,
          sql`exists (
            select 1 from ${refunds} search_refund
            where search_refund.player_account_id = ${accounts.id}
              and lower(search_refund.refund_reference) like ${searchPattern} escape '\\'
          )`,
        )
        : undefined,
    ))
    .orderBy(asc(accounts.normalizedName))
    .all()
  const grouped = new Map<string, typeof rows>()
  rows.forEach((row) => grouped.set(row.playerId, [...(grouped.get(row.playerId) ?? []), row]))
  return [...grouped.values()].map((playerRows) => {
    const player = playerRows[0]
    const chargeRows = playerRows.flatMap((row) => {
      const dueDate = row.dueDate
      if (!row.chargeId || row.originalAmountPaise === null || !dueDate) return []
      const effective = Math.max(
        0,
        row.originalAmountPaise + Number(row.debitTotal) - Number(row.creditTotal),
      )
      const received = Math.max(0, Number(row.paymentTotal) - Number(row.refundTotal))
      const outstanding = Math.max(0, effective - received)
      const status = outstanding === 0
        ? "paid" as const
        : received > 0
          ? "partially_paid" as const
          : dueDate < getAcademyDateKey(now)
            ? "overdue" as const
            : "pending" as const
      return [{ ...row, dueDate, outstanding, status }]
    })
    const hasAgreement = Number(player.hasActiveAgreement) > 0
    const hasPaymentHistory = Number(player.hasPaymentAgreementHistory) > 0
    const hasAssignment = Number(player.hasPeriodAssignment) > 0
    if (!chargeRows.length) {
      return {
        playerId: player.playerId,
        academyId: formatAcademyId(player.academyIdSerial),
        fullName: player.fullName,
        archived: player.archivedAt !== null,
        hasActiveFeePlan: hasAgreement,
        paymentEligible: false,
        status: "setup_required" as const,
        outstandingPaise: 0,
        dueDate: null,
        feeReference: null,
      }
    }
    const hasMonthlyCharge = chargeRows.some((row) => (
      row.chargeType === "monthly_training" && row.billingPeriod === period
    ))
    const hasRegistrationCharge = chargeRows.some((row) => row.chargeType === "registration")
    const hasPayableRegistration = chargeRows.some((row) => (
      row.chargeType === "registration" && row.outstanding > 0
    ))
    const status = (!hasPaymentHistory && !hasRegistrationCharge)
      || (hasAgreement && !hasRegistrationCharge)
      ? "setup_required" as const
      : hasAgreement && hasAssignment && !hasMonthlyCharge
        ? combineFinanceStatuses([
          ...chargeRows.map((row) => row.status),
          "not_prepared",
        ])
        : combineFinanceStatuses(chargeRows.map((row) => row.status))
    const representative = [...chargeRows].sort((left, right) => {
      const leftSettled = left.outstanding === 0 ? 1 : 0
      const rightSettled = right.outstanding === 0 ? 1 : 0
      return leftSettled - rightSettled
        || left.dueDate.localeCompare(right.dueDate)
        || Number(right.chargeType === "monthly_training")
          - Number(left.chargeType === "monthly_training")
    })[0]
    const outstandingPaise = chargeRows.reduce((total, row) => total + row.outstanding, 0)
    const archived = player.archivedAt !== null
    return {
      playerId: player.playerId,
      academyId: formatAcademyId(player.academyIdSerial),
      fullName: player.fullName,
      archived,
      hasActiveFeePlan: hasAgreement,
      paymentEligible: !archived
        && outstandingPaise > 0
        && (hasPaymentHistory || hasPayableRegistration),
      status,
      outstandingPaise,
      dueDate: representative.dueDate,
      feeReference: representative.feeReference,
    }
  })
}

export function listMonthlyPreparationCandidates(database: Executor, period: string) {
  return database.select({
    agreement: feeAgreements,
    player: {
      archivedAt: accounts.archivedAt,
      approvalStatus: accounts.approvalStatus,
      role: accounts.role,
    },
    enrollment: {
      academyPlan: playerEnrollments.academyPlan,
      level: playerEnrollments.level,
      batch: playerEnrollments.batch,
    },
  }).from(feeAgreements)
    .innerJoin(accounts, eq(accounts.id, feeAgreements.playerAccountId))
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, feeAgreements.playerAccountId))
    .innerJoin(
      academyIdAllocations,
      eq(academyIdAllocations.accountId, feeAgreements.playerAccountId),
    )
    .where(and(
      ne(feeAgreements.status, "paused"),
      lte(feeAgreements.effectiveFrom, monthEnd(period)),
      or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, monthStart(period))),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).orderBy(asc(academyIdAllocations.serial)).all()
}

export function listPreparedPlayerIds(database: Executor, period: string) {
  return database.select({ playerId: financialCharges.playerAccountId })
    .from(financialCharges).where(and(
      eq(financialCharges.type, "monthly_training"),
      eq(financialCharges.billingPeriod, period),
      eq(financialCharges.lifecycle, "issued"),
    )).all().map((row) => row.playerId)
}

export function readPeriodReceivedPaise(database: Executor, period: string) {
  const received = database.select({
    total: sql<number>`coalesce(sum(${paymentAllocations.amountPaise}), 0)`,
  }).from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
    .where(and(
      eq(financialCharges.type, "monthly_training"),
      eq(financialCharges.billingPeriod, period),
      eq(financialCharges.lifecycle, "issued"),
      eq(payments.lifecycle, "recorded"),
    )).get()?.total
  const refunded = database.select({
    total: sql<number>`coalesce(sum(${refundAllocations.amountPaise}), 0)`,
  }).from(refundAllocations)
    .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
    .innerJoin(
      paymentAllocations,
      eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
    )
    .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
    .where(and(
      eq(financialCharges.type, "monthly_training"),
      eq(financialCharges.billingPeriod, period),
      eq(financialCharges.lifecycle, "issued"),
      eq(refunds.lifecycle, "recorded"),
    )).get()?.total
  return Math.max(0, Number(received ?? 0) - Number(refunded ?? 0))
}

export function listApprovedPlayerIds(database: Executor) {
  return database.select({ playerId: accounts.id }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).all().map((row) => row.playerId)
}
