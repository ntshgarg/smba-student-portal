import "server-only"

import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm"

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
  paymentAllocations,
  payments,
  refundAllocations,
  refunds,
} from "@/lib/db/schema"
import { monthEnd, monthStart } from "@/lib/finance/domain"
import { loadChargeView } from "@/lib/finance/repository"
import type {
  FinanceActivityInput,
  FinanceActivityItem,
  FinanceActivityResult,
  FinanceActivityCoachOption,
  FinanceAuditEventType,
  FinanceDayBookEvent,
  FinanceDayBookInput,
  FinanceDayBookResult,
  FinanceDayBookSummary,
  FinanceRegisterInput,
  FinanceRegisterResult,
  FinanceRegisterRow,
  FinanceStatus,
  PaymentMethod,
} from "@/lib/finance/types"
import { getAcademyDateKey } from "@/lib/format"

type Executor = SmbaDatabaseExecutor

export class FinanceRecordsCursorError extends Error {
  constructor() {
    super("The financial-records cursor is invalid.")
    this.name = "FinanceRecordsCursorError"
  }
}

function normalizeSearch(value = "") {
  return value.trim().toLocaleLowerCase("en-IN")
}

function paginateById<T>(
  rows: T[],
  cursor: string | undefined,
  limit: number,
  idOf: (row: T) => string,
) {
  const start = cursor ? rows.findIndex((row) => idOf(row) === cursor) + 1 : 0
  if (cursor && start === 0) throw new FinanceRecordsCursorError()
  const page = rows.slice(start, start + limit)
  return {
    rows: page,
    nextCursor: start + limit < rows.length && page.length
      ? idOf(page[page.length - 1])
      : null,
  }
}

function activeAdjustmentTotals(adjustments: NonNullable<ReturnType<typeof loadChargeView>>["adjustments"]) {
  return (adjustments ?? []).reduce((totals, adjustment) => {
    if (adjustment.reversed) return totals
    if (adjustment.kind === "manual_debit") totals.debit += adjustment.amountPaise
    else totals.credit += adjustment.amountPaise
    return totals
  }, { credit: 0, debit: 0 })
}

export function loadFeeRegister(
  database: Executor,
  input: FinanceRegisterInput & { limit: number },
  now: Date,
): FinanceRegisterResult {
  const players = database.select({
    academyIdSerial: academyIdAllocations.serial,
    archivedAt: accounts.archivedAt,
    fullName: accounts.fullName,
    normalizedName: accounts.normalizedName,
    playerId: accounts.id,
  }).from(accounts)
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
    ))
    .orderBy(asc(accounts.normalizedName), asc(accounts.id))
    .all()

  const period = input.mode === "monthly" ? input.period as string : null
  const chargeRows = database.select().from(financialCharges)
    .where(input.mode === "registration"
      ? eq(financialCharges.type, "registration")
      : and(
        eq(financialCharges.type, "monthly_training"),
        eq(financialCharges.billingPeriod, period as string),
      ))
    .orderBy(desc(financialCharges.issuedAt), desc(financialCharges.id)).all()
  const chargesByPlayer = new Map<string, typeof chargeRows>()
  chargeRows.forEach((charge) => {
    chargesByPlayer.set(charge.playerAccountId, [
      ...(chargesByPlayer.get(charge.playerAccountId) ?? []),
      charge,
    ])
  })
  const agreementRows = period ? database.select().from(feeAgreements).where(and(
    lte(feeAgreements.effectiveFrom, monthEnd(period)),
    or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, monthStart(period))),
  )).all() : []

  const rows = players.map((player): FinanceRegisterRow => {
    const charge = (chargesByPlayer.get(player.playerId) ?? []).sort((left, right) => (
      Number(right.lifecycle === "issued") - Number(left.lifecycle === "issued")
      || right.issuedAt.getTime() - left.issuedAt.getTime()
      || right.id.localeCompare(left.id)
    ))[0]
    if (!charge) {
      const hasAgreement = period !== null && agreementRows.some((agreement) => (
        agreement.playerAccountId === player.playerId
        && agreement.status !== "paused"
        && agreement.effectiveFrom <= monthEnd(period)
        && (agreement.effectiveTo === null || agreement.effectiveTo >= monthStart(period))
      ))
      return {
        playerId: player.playerId,
        academyId: formatAcademyId(player.academyIdSerial),
        fullName: player.fullName,
        archived: player.archivedAt !== null,
        chargeId: null,
        feeReference: null,
        type: input.mode === "monthly" ? "monthly_training" : "registration",
        billingPeriod: period,
        originalAmountPaise: 0,
        creditAdjustmentsPaise: 0,
        debitAdjustmentsPaise: 0,
        effectiveAmountPaise: 0,
        receivedPaise: 0,
        outstandingPaise: 0,
        dueDate: null,
        status: hasAgreement ? "not_prepared" : "setup_required",
      }
    }
    const view = loadChargeView(database, charge.id, now, true)
    if (!view) throw new Error("The fee-register Charge is unavailable.")
    const adjustments = activeAdjustmentTotals(view.adjustments)
    return {
      playerId: player.playerId,
      academyId: formatAcademyId(player.academyIdSerial),
      fullName: player.fullName,
      archived: player.archivedAt !== null,
      chargeId: view.id,
      feeReference: view.feeReference,
      type: view.type,
      billingPeriod: view.billingPeriod,
      originalAmountPaise: view.originalAmountPaise,
      creditAdjustmentsPaise: adjustments.credit,
      debitAdjustmentsPaise: adjustments.debit,
      effectiveAmountPaise: view.effectiveAmountPaise,
      receivedPaise: view.receivedPaise,
      outstandingPaise: view.outstandingPaise,
      dueDate: view.dueDate,
      status: view.status,
    }
  })

  const query = normalizeSearch(input.query)
  const filtered = rows.filter((row) => {
    if ((input.playerScope ?? "active") === "active" && row.archived) return false
    if (input.playerScope === "archived" && !row.archived) return false
    if (input.statuses?.length && !input.statuses.includes(row.status)) return false
    if (!query) return true
    return [row.fullName, row.academyId, row.feeReference ?? ""]
      .some((value) => value.toLocaleLowerCase("en-IN").includes(query))
  })
  const statusCounts: Partial<Record<FinanceStatus, number>> = {}
  filtered.forEach((row) => {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
  })
  const summary = filtered.reduce((value, row) => ({
    ...value,
    originalAmountPaise: value.originalAmountPaise + row.originalAmountPaise,
    effectiveAmountPaise: value.effectiveAmountPaise + row.effectiveAmountPaise,
    receivedPaise: value.receivedPaise + row.receivedPaise,
    outstandingPaise: value.outstandingPaise + row.outstandingPaise,
  }), {
    totalRows: filtered.length,
    originalAmountPaise: 0,
    effectiveAmountPaise: 0,
    receivedPaise: 0,
    outstandingPaise: 0,
    statusCounts,
  })
  const paged = paginateById(filtered, input.cursor, input.limit, (row) => row.playerId)
  return {
    rows: paged.rows,
    summary,
    nextCursor: paged.nextCursor,
  }
}

function coveredReferencesByPayment(database: Executor) {
  const references = new Map<string, string[]>()
  database.select({
    paymentId: paymentAllocations.paymentId,
    feeReference: financialCharges.feeReference,
    dueDate: financialCharges.dueDate,
  }).from(paymentAllocations)
    .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.id)).all()
    .forEach((row) => {
      const current = references.get(row.paymentId) ?? []
      if (!current.includes(row.feeReference)) current.push(row.feeReference)
      references.set(row.paymentId, current)
    })
  return references
}

function coveredReferencesByRefund(database: Executor) {
  const references = new Map<string, string[]>()
  database.select({
    refundId: refundAllocations.refundId,
    feeReference: financialCharges.feeReference,
    dueDate: financialCharges.dueDate,
  }).from(refundAllocations)
    .innerJoin(paymentAllocations, eq(paymentAllocations.id, refundAllocations.paymentAllocationId))
    .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.id)).all()
    .forEach((row) => {
      const current = references.get(row.refundId) ?? []
      if (!current.includes(row.feeReference)) current.push(row.feeReference)
      references.set(row.refundId, current)
    })
  return references
}

export function loadCollectionsDayBook(
  database: Executor,
  input: FinanceDayBookInput & { limit: number },
): FinanceDayBookResult {
  const paymentReferences = coveredReferencesByPayment(database)
  const refundReferences = coveredReferencesByRefund(database)
  const paymentRows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    amountPaise: payments.amountPaise,
    eventDate: payments.receivedOn,
    fullName: accounts.fullName,
    id: payments.id,
    lifecycle: payments.lifecycle,
    method: payments.method,
    playerId: payments.playerAccountId,
    recordedAt: payments.recordedAt,
    reference: payments.receiptReference,
  }).from(payments)
    .innerJoin(accounts, eq(accounts.id, payments.playerAccountId))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      gte(payments.receivedOn, input.from),
      lte(payments.receivedOn, input.to),
      input.includeReversed ? undefined : eq(payments.lifecycle, "recorded"),
    )).all()
  const refundRows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    amountPaise: refunds.amountPaise,
    eventDate: refunds.refundedOn,
    fullName: accounts.fullName,
    id: refunds.id,
    lifecycle: refunds.lifecycle,
    method: refunds.method,
    playerId: refunds.playerAccountId,
    recordedAt: refunds.recordedAt,
    reference: refunds.refundReference,
  }).from(refunds)
    .innerJoin(accounts, eq(accounts.id, refunds.playerAccountId))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      gte(refunds.refundedOn, input.from),
      lte(refunds.refundedOn, input.to),
      input.includeReversed ? undefined : eq(refunds.lifecycle, "recorded"),
    )).all()

  const events: FinanceDayBookEvent[] = [
    ...paymentRows.map((row): FinanceDayBookEvent => ({
      id: row.id,
      eventDate: row.eventDate,
      eventType: "payment",
      reference: row.reference,
      playerId: row.playerId,
      academyId: formatAcademyId(row.academyIdSerial),
      playerFullName: row.fullName,
      method: row.method as PaymentMethod,
      amountPaise: row.amountPaise,
      lifecycle: row.lifecycle,
      recordedAt: row.recordedAt.toISOString(),
      coveredFeeReferences: paymentReferences.get(row.id) ?? [],
    })),
    ...refundRows.map((row): FinanceDayBookEvent => ({
      id: row.id,
      eventDate: row.eventDate,
      eventType: "refund",
      reference: row.reference,
      playerId: row.playerId,
      academyId: formatAcademyId(row.academyIdSerial),
      playerFullName: row.fullName,
      method: row.method as PaymentMethod,
      amountPaise: row.amountPaise,
      lifecycle: row.lifecycle,
      recordedAt: row.recordedAt.toISOString(),
      coveredFeeReferences: refundReferences.get(row.id) ?? [],
    })),
  ]

  const query = normalizeSearch(input.query)
  const filtered = events.filter((event) => {
    if (event.eventDate < input.from || event.eventDate > input.to) return false
    if (!input.includeReversed && event.lifecycle === "reversed") return false
    if (input.methods?.length && !input.methods.includes(event.method)) return false
    if (!query) return true
    return [
      event.playerFullName,
      event.academyId,
      event.reference,
      ...event.coveredFeeReferences,
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(query))
  }).sort((left, right) => (
    right.eventDate.localeCompare(left.eventDate)
    || right.recordedAt.localeCompare(left.recordedAt)
    || right.reference.localeCompare(left.reference)
    || right.id.localeCompare(left.id)
  ))

  const summary: FinanceDayBookSummary = {
    grossReceivedPaise: 0,
    refundsPaise: 0,
    netCollectionsPaise: 0,
    byMethod: {
      cash: 0,
      upi: 0,
      bank_transfer: 0,
      card: 0,
      cheque: 0,
      other: 0,
    },
  }
  filtered.forEach((event) => {
    if (event.lifecycle !== "recorded") return
    const signedAmount = event.eventType === "payment" ? event.amountPaise : -event.amountPaise
    if (event.eventType === "payment") summary.grossReceivedPaise += event.amountPaise
    else summary.refundsPaise += event.amountPaise
    summary.netCollectionsPaise += signedAmount
    summary.byMethod[event.method] += signedAmount
  })
  const paged = paginateById(filtered, input.cursor, input.limit, (event) => event.id)
  return { events: paged.rows, summary, nextCursor: paged.nextCursor }
}

const ACTIVITY_ACTIONS: Record<FinanceAuditEventType, string> = {
  finance_activated: "Financial tracking activated",
  fee_agreement_created: "Fee plan created",
  fee_agreement_replaced: "Fee plan replaced",
  fee_agreement_paused: "Fee plan paused",
  fee_agreement_ended: "Fee plan ended",
  charge_issued: "Fee issued",
  charge_voided: "Fee voided",
  monthly_fees_prepared: "Monthly fees prepared",
  payment_recorded: "Payment recorded",
  payment_reversed: "Payment reversed",
  refund_recorded: "Refund recorded",
  refund_reversed: "Refund reversed",
  concession_created: "Concession created",
  concession_applied: "Concession applied",
  concession_application_reversed: "Concession application reversed",
  concession_reversed: "Concession ended",
  adjustment_created: "Fee adjustment recorded",
  adjustment_reversed: "Fee adjustment reversed",
  historical_reconciled: "Historical fee status recorded",
}

function parseMetadata(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function loadFinancialActivity(
  database: Executor,
  input: FinanceActivityInput & { limit: number },
): FinanceActivityResult {
  const accountRows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    fullName: accounts.fullName,
    id: accounts.id,
    role: accounts.role,
  }).from(accounts).leftJoin(
    academyIdAllocations,
    eq(academyIdAllocations.accountId, accounts.id),
  ).all()
  const accountMap = new Map(accountRows.map((row) => [row.id, row]))
  const chargeMap = new Map(database.select().from(financialCharges).all()
    .map((row) => [row.id, row]))
  const paymentMap = new Map(database.select().from(payments).all().map((row) => [row.id, row]))
  const refundMap = new Map(database.select().from(refunds).all().map((row) => [row.id, row]))
  const agreementMap = new Map(database.select().from(feeAgreements).all()
    .map((row) => [row.id, row]))
  const adjustmentMap = new Map(database.select().from(chargeAdjustments).all()
    .map((row) => [row.id, row]))
  const concessionMap = new Map(database.select().from(concessions).all()
    .map((row) => [row.id, row]))
  const applicationMap = new Map(database.select().from(concessionApplications).all()
    .map((row) => [row.id, row]))

  const fromInstant = input.from ? new Date(`${input.from}T00:00:00+05:30`) : null
  const toInstant = input.to ? new Date(`${input.to}T23:59:59.999+05:30`) : null
  const items = database.select().from(financialAuditEvents).where(and(
    fromInstant ? gte(financialAuditEvents.occurredAt, fromInstant) : undefined,
    toInstant ? lte(financialAuditEvents.occurredAt, toInstant) : undefined,
    input.coachId ? eq(financialAuditEvents.actorAccountId, input.coachId) : undefined,
    input.eventTypes?.length
      ? inArray(financialAuditEvents.eventType, input.eventTypes)
      : undefined,
  )).orderBy(desc(financialAuditEvents.occurredAt), desc(financialAuditEvents.id)).all()
    .map((event): FinanceActivityItem => {
      const metadata = parseMetadata(event.metadata)
      const charge = event.entityType === "charge"
        ? chargeMap.get(event.entityId)
        : typeof metadata.chargeId === "string" ? chargeMap.get(metadata.chargeId) : undefined
      const payment = event.entityType === "payment" ? paymentMap.get(event.entityId) : undefined
      const refund = event.entityType === "refund" ? refundMap.get(event.entityId) : undefined
      const agreement = event.entityType === "fee_agreement"
        ? agreementMap.get(event.entityId)
        : undefined
      const adjustment = event.entityType === "adjustment"
        ? adjustmentMap.get(event.entityId)
        : undefined
      const concession = event.entityType === "concession"
        ? concessionMap.get(event.entityId)
        : undefined
      const application = event.entityType === "concession_application"
        ? applicationMap.get(event.entityId)
        : undefined
      const applicationCharge = application ? chargeMap.get(application.chargeId) : undefined
      const adjustmentCharge = adjustment ? chargeMap.get(adjustment.chargeId) : undefined
      const playerId = typeof metadata.playerId === "string"
        ? metadata.playerId
        : event.entityType === "player"
          ? event.entityId
          : payment?.playerAccountId
            ?? refund?.playerAccountId
            ?? charge?.playerAccountId
            ?? agreement?.playerAccountId
            ?? concession?.playerAccountId
            ?? applicationCharge?.playerAccountId
            ?? adjustmentCharge?.playerAccountId
            ?? null
      const player = playerId ? accountMap.get(playerId) : undefined
      const actor = accountMap.get(event.actorAccountId)
      const amount = typeof metadata.amountPaise === "number" && Number.isSafeInteger(metadata.amountPaise)
        ? metadata.amountPaise
        : payment?.amountPaise
          ?? refund?.amountPaise
          ?? adjustment?.amountPaise
          ?? application?.amountPaise
          ?? charge?.originalAmountPaise
          ?? null
      let reason: string | null = null
      if (adjustment?.kind === "legacy_settlement") {
        reason = "Historical credit adjustment"
      } else if (typeof metadata.reason === "string") {
        reason = metadata.reason
      } else if (event.eventType === "payment_reversed") {
        reason = payment?.reversalReason ?? null
      } else if (event.eventType === "refund_reversed") {
        reason = refund?.reversalReason ?? null
      } else if (event.eventType === "charge_voided") {
        reason = charge?.voidReason ?? null
      } else if (event.eventType === "adjustment_created") {
        reason = adjustment?.reason ?? null
      } else if (event.eventType === "adjustment_reversed") {
        reason = adjustment?.reversalReason ?? null
      } else if (event.eventType === "concession_created") {
        reason = concession?.reason ?? null
      }
      return {
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        eventType: event.eventType,
        action: ACTIVITY_ACTIONS[event.eventType],
        actorId: event.actorAccountId,
        actorName: actor?.fullName ?? "Unknown coach",
        playerId,
        playerName: player?.fullName ?? null,
        academyId: player?.academyIdSerial ? formatAcademyId(player.academyIdSerial) : null,
        reference: payment?.receiptReference
          ?? refund?.refundReference
          ?? charge?.feeReference
          ?? applicationCharge?.feeReference
          ?? adjustmentCharge?.feeReference
          ?? (typeof metadata.receiptReference === "string" ? metadata.receiptReference : null)
          ?? (typeof metadata.refundReference === "string" ? metadata.refundReference : null),
        amountPaise: amount,
        reason,
      }
    })

  const query = normalizeSearch(input.query)
  const filtered = items.filter((item) => {
    const date = getAcademyDateKey(new Date(item.occurredAt))
    if (input.from && date < input.from) return false
    if (input.to && date > input.to) return false
    if (input.coachId && item.actorId !== input.coachId) return false
    if (input.eventTypes?.length && !input.eventTypes.includes(item.eventType)) return false
    if (!query) return true
    return [
      item.action,
      item.actorName,
      item.playerName ?? "",
      item.academyId ?? "",
      item.reference ?? "",
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(query))
  })
  const paged = paginateById(filtered, input.cursor, input.limit, (item) => item.id)
  return { items: paged.rows, nextCursor: paged.nextCursor }
}

export function loadFinanceActivityCoaches(database: Executor): FinanceActivityCoachOption[] {
  const actorIds = new Set(database.select({ actorId: financialAuditEvents.actorAccountId })
    .from(financialAuditEvents).all().map((row) => row.actorId))
  return database.select({ id: accounts.id, name: accounts.fullName }).from(accounts)
    .where(eq(accounts.role, "coach"))
    .orderBy(asc(accounts.normalizedName), asc(accounts.id)).all()
    .filter((coach) => actorIds.has(coach.id))
}
