import "server-only"

import { randomUUID } from "node:crypto"

import {
  and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql,
} from "drizzle-orm"

import { isValidDateKey, isValidMonthKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabase, SmbaDatabaseExecutor } from "@/lib/db/client"
import { initializeDatabase } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  chargeAdjustments,
  concessionApplications,
  concessions,
  feeAgreements,
  financialAuditEvents,
  financialCharges,
  financeReferenceSequences,
  paymentAllocations,
  payments,
  refundAllocations,
  refunds,
  playerEnrollments,
  sessionAssignments,
  sessionOccurrences,
  sessionSeries,
} from "@/lib/db/schema"
import { formatAcademyId } from "@/lib/auth/identity"
import { DEFAULT_MONTHLY_DUE_DAY, REGISTRATION_FEE_PAISE } from "@/lib/finance/config"
import {
  addCalendarDays,
  calculateProratedSessionFee,
  calculateUnusedMonthRefundLimit,
  createOpaqueFeeReference,
  calculateConcessionAmount,
  dateInMonth,
  financialPayloadFingerprint,
  formatFinancialSequenceReference,
  isValidFeeReference,
  isValidIdempotencyKey,
  isValidMutationId,
  monthEnd,
  monthStart,
} from "@/lib/finance/domain"
import {
  FinanceRecordsCursorError,
  loadCollectionsDayBook,
  loadFeeRegister,
  loadFinanceActivityCoaches,
  loadFinancialActivity,
} from "@/lib/finance/records"
import {
  FINANCE_ACADEMY_ENTITY_ID,
  listApprovedPlayerIds,
  listFinancePlayers,
  listMonthlyPreparationCandidates,
  listPreparedPlayerIds,
  loadChargeView,
  loadChargeViews,
  loadPeriodAssignmentIndex,
  loadPlayerFeeRecord,
  readActiveFeeAgreement,
  readActivePlayer,
  readAuditEventByIdempotencyKey,
  readCharge,
  readFinanceActivation,
  readFirstMonthSessionProration,
  hasCurrentOrFutureMatchingAssignment,
  readPaymentByIdempotencyKey,
  readPeriodReceivedPaise,
} from "@/lib/finance/repository"
import {
  FINANCE_CURRENCY,
  isFinanceAuditEventType,
  type ApplyAdjustmentInput,
  type ApplyConcessionInput,
  type ChargeView,
  type ConcessionApplicationResult,
  type ConcessionMutationResult,
  type CoachFinanceWorkspace,
  type CoachFinanceDashboardSummary,
  type CoachFinanceRapidDesk,
  type CompleteOnboardingFinanceResult,
  type CommitOnboardingFinanceInput,
  type CreateFeeAgreementInput,
  type CreateConcessionInput,
  type ExistingPlayerFinanceSetupInput,
  type FinanceActivation,
  type FinanceActivityInput,
  type FinanceActivityCoachOption,
  type FinanceActivityResult,
  type FinanceDayBookInput,
  type FinanceDayBookResult,
  type FinanceField,
  type FinanceRegisterInput,
  type FinanceRegisterResult,
  type FinanceRapidScope,
  type FinanceServiceErrorCode,
  type FinanceStatus,
  type PaymentMethod,
  type PaymentAllocationInput,
  type PaymentAllocationPreview,
  type PreviewPaymentAllocationsInput,
  type PreviewRefundAllocationsInput,
  type PlayerFeeRecord,
  type PlayerFinancialCloseoutState,
  type PlayerFinanceDashboardSummary,
  type MonthlyPreparationPreview,
  type OnboardingFinancePreview,
  type OnboardingFinancePreviewLine,
  type OnboardingFinanceTerms,
  type PrepareMonthlyChargesInput,
  type PrepareMonthlyChargesResult,
  type RecordPaymentInput,
  type RecordPaymentResult,
  type RecordAllocatedPaymentInput,
  type RecordAllocatedPaymentResult,
  type RecordRefundInput,
  type RecordRefundResult,
  type RedateConfirmedTrainingStartInput,
  type RedateConfirmedTrainingStartResult,
  type ResolveExistingRegistrationFeeInput,
  type ReversePaymentInput,
  type ReverseRefundInput,
  type ReverseConcessionApplicationInput,
  type ReverseConcessionInput,
  type ReverseAdjustmentInput,
  type VoidChargeInput,
  type ConcessionView,
  type FinanceCollectionEvent,
  type RefundAllocationPreview,
  type EndFeeAgreementInput,
  type EndFeeAgreementResult,
  type FeeAgreementView,
} from "@/lib/finance/types"
import { getAcademyDateKey, getAcademyMonthKey } from "@/lib/format"
import { academyPlanIsValid } from "@/lib/training/academy-plans"
import {
  IMPLAUSIBLE_TRAINING_START_MESSAGE,
  trainingStartIsImplausiblyEarly,
} from "@/lib/training/training-start"

const MAX_MONEY_PAISE = 1_000_000_000
const MAX_NOTE_LENGTH = 500
const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "upi",
  "bank_transfer",
  "card",
  "cheque",
  "other",
]
const FINANCE_STATUSES: FinanceStatus[] = [
  "setup_required",
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "not_prepared",
  "void",
]

type FinanceDependencies = {
  createId?: () => string
  createFeeReference?: () => string
}

type CoachContext = FinanceDependencies & {
  coachId: string
  database?: SmbaDatabase
  now?: Date
}

type QueryContext = {
  database?: SmbaDatabase
  now?: Date
}

export class FinanceServiceError extends Error {
  readonly code: FinanceServiceErrorCode
  readonly field?: FinanceField

  constructor(code: FinanceServiceErrorCode, message: string, field?: FinanceField) {
    super(message)
    this.name = "FinanceServiceError"
    this.code = code
    this.field = field
  }
}

function financeError(
  code: FinanceServiceErrorCode,
  message: string,
  field?: FinanceField,
): never {
  throw new FinanceServiceError(code, message, field)
}

function requireCoach(database: SmbaDatabaseExecutor, coachId: string) {
  try {
    requireHeadAdminAccess(coachId, { database })
  } catch {
    financeError("AUTHORIZATION", "Head coach access is required.")
  }
}

function requireFinanceActive(database: SmbaDatabaseExecutor) {
  const activation = readFinanceActivation(database)
  if (!activation) {
    financeError("FINANCE_NOT_ACTIVE", "Financial tracking has not been activated.")
  }
  return activation
}

function requireActiveFinanceTarget(
  database: SmbaDatabaseExecutor,
  playerId: string,
) {
  const player = readActivePlayer(database, playerId)
  if (!player) {
    financeError("PLAYER_UNAVAILABLE", "Choose an approved active player.", "playerId")
  }
  return player
}

function readPaymentFeePlanHistory(
  database: SmbaDatabaseExecutor,
  playerId: string,
) {
  return database.select().from(feeAgreements).where(and(
    eq(feeAgreements.playerAccountId, playerId),
    or(
      eq(feeAgreements.status, "active"),
      eq(feeAgreements.status, "ended"),
    ),
  )).orderBy(desc(feeAgreements.effectiveFrom), desc(feeAgreements.createdAt)).get()
}

function requirePaymentFeePlanHistory(
  database: SmbaDatabaseExecutor,
  playerId: string,
) {
  const agreement = readPaymentFeePlanHistory(database, playerId)
  if (!agreement) {
    financeError("SETUP_REQUIRED", "Create the player’s Fee Plan first.", "playerId")
  }
  return agreement
}

function isChargeWithinPaymentHorizon(
  charge: Pick<typeof financialCharges.$inferSelect, "type" | "billingPeriod">,
  currentPeriod: string,
) {
  return charge.type === "registration"
    || (charge.billingPeriod !== null && charge.billingPeriod <= currentPeriod)
}

function requireText(value: unknown, field: FinanceField, label: string, max = MAX_NOTE_LENGTH) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text || text.length > max) {
    financeError("INVALID_INPUT", `${label} is required and cannot exceed ${max} characters.`, field)
  }
  return text
}

function optionalText(value: unknown, field: FinanceField, max = MAX_NOTE_LENGTH) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" || value.trim().length > max) {
    financeError("INVALID_INPUT", `Review the ${field}.`, field)
  }
  return value.trim() || null
}

function validateIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !isValidIdempotencyKey(value)) {
    financeError("INVALID_INPUT", "The request identifier is invalid.", "idempotencyKey")
  }
  return value
}

function validateMutationId(value: unknown) {
  if (typeof value !== "string" || !isValidMutationId(value)) {
    financeError("INVALID_INPUT", "The mutation identifier is invalid.", "idempotencyKey")
  }
  return value
}

function allocateFinancialReference(
  database: SmbaDatabaseExecutor,
  kind: "receipt" | "refund",
  dateKey: string,
  now: Date,
) {
  const year = Number(dateKey.slice(0, 4))
  const current = database.select().from(financeReferenceSequences).where(and(
    eq(financeReferenceSequences.kind, kind),
    eq(financeReferenceSequences.year, year),
  )).get()
  const sequence = (current?.lastValue ?? 0) + 1
  if (sequence > 99_999) financeError("CONFLICT", `The ${kind} sequence is exhausted for ${year}.`)
  if (current) {
    const update = database.update(financeReferenceSequences).set({
      lastValue: sequence,
      updatedAt: now,
    }).where(and(
      eq(financeReferenceSequences.kind, kind),
      eq(financeReferenceSequences.year, year),
      eq(financeReferenceSequences.lastValue, current.lastValue),
    )).run()
    if (update.changes !== 1) {
      financeError("CONFLICT", `The ${kind} reference changed. Try again.`)
    }
  } else {
    database.insert(financeReferenceSequences).values({
      kind,
      year,
      lastValue: sequence,
      updatedAt: now,
    }).run()
  }
  return formatFinancialSequenceReference(kind, year, sequence)
}

function validateAllocationSet(
  allocations: PaymentAllocationInput[],
  expectedTotal: number,
) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    financeError("INVALID_INPUT", "Allocate the complete payment before recording it.", "amountPaise")
  }
  const seen = new Set<string>()
  const normalized = allocations.map((allocation) => {
    if (!allocation || typeof allocation.chargeId !== "string" || seen.has(allocation.chargeId)
      || !Number.isInteger(allocation.expectedChargeRevision)
      || allocation.expectedChargeRevision < 0) {
      financeError("INVALID_INPUT", "Review the payment allocations.", "chargeId")
    }
    seen.add(allocation.chargeId)
    return {
      chargeId: allocation.chargeId,
      amountPaise: validateMoney(allocation.amountPaise),
      expectedChargeRevision: allocation.expectedChargeRevision,
    }
  }).sort((left, right) => left.chargeId.localeCompare(right.chargeId))
  if (normalized.reduce((total, allocation) => total + allocation.amountPaise, 0) !== expectedTotal) {
    financeError("INVALID_INPUT", "Payment allocations must equal the receipt amount.", "amountPaise")
  }
  return normalized
}

function validateMoney(value: unknown, field: FinanceField = "amountPaise") {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_MONEY_PAISE) {
    financeError("INVALID_INPUT", "Enter a valid positive amount.", field)
  }
  return value as number
}

function validateRevision(value: unknown, message: string) {
  if (!Number.isInteger(value) || (value as number) < 0) {
    financeError("INVALID_INPUT", message)
  }
  return value as number
}

function toConcessionView(row: typeof concessions.$inferSelect): ConcessionView {
  return {
    id: row.id,
    playerId: row.playerAccountId,
    mode: row.mode,
    valueKind: row.valueKind,
    value: row.value,
    startsPeriod: row.startsPeriod,
    endsPeriod: row.endsPeriod,
    lifecycle: row.lifecycle,
    recordRevision: row.recordRevision,
  }
}

function validateConcessionDefinition(input: CreateConcessionInput) {
  if (!input || !["one_off", "recurring"].includes(input.mode)) {
    financeError("INVALID_INPUT", "Choose a valid Concession type.", "concessionId")
  }
  if (!["fixed", "percentage"].includes(input.valueKind)) {
    financeError("INVALID_INPUT", "Choose a valid Concession value.", "amountPaise")
  }
  const value = input.valueKind === "fixed"
    ? validateMoney(input.value)
    : Number.isInteger(input.value) && input.value > 0 && input.value <= 10_000
      && input.value % 100 === 0
      ? input.value
      : financeError(
        "INVALID_INPUT",
        "Enter a whole percentage from 1% to 100%.",
        "amountPaise",
      )
  const startsPeriod = input.startsPeriod?.trim() || null
  const endsPeriod = input.endsPeriod?.trim() || null
  if (input.mode === "one_off" && (startsPeriod || endsPeriod)) {
    financeError("INVALID_INPUT", "A one-off Concession does not use a billing period.", "period")
  }
  if (input.mode === "recurring" && (!startsPeriod || !isValidMonthKey(startsPeriod)
    || (endsPeriod !== null && (!isValidMonthKey(endsPeriod) || endsPeriod < startsPeriod)))) {
    financeError("INVALID_INPUT", "Choose a valid recurring Concession period.", "period")
  }
  const reason = requireText(input.reason, "reason", "A Concession reason")
  const mutationId = validateMutationId(input.mutationId)
  const fingerprint = financialPayloadFingerprint({
    endsPeriod,
    mode: input.mode,
    playerId: input.playerId,
    reason,
    startsPeriod,
    value,
    valueKind: input.valueKind,
  })
  return { endsPeriod, fingerprint, mutationId, reason, startsPeriod, value }
}

function auditMetadata(value: unknown) {
  return JSON.stringify(value)
}

function parseAuditMetadata<T>(value: string): T {
  return JSON.parse(value) as T
}

function insertAudit(
  database: SmbaDatabaseExecutor,
  {
    actorId,
    createId,
    entityId,
    entityType,
    eventType,
    idempotencyKey,
    metadata = {},
    now,
  }: {
    actorId: string
    createId: () => string
    entityId: string
    entityType: typeof financialAuditEvents.$inferInsert.entityType
    eventType: typeof financialAuditEvents.$inferInsert.eventType
    idempotencyKey?: string
    metadata?: unknown
    now: Date
  },
) {
  database.insert(financialAuditEvents).values({
    id: createId(),
    actorAccountId: actorId,
    eventType,
    entityType,
    entityId,
    idempotencyKey,
    metadata: auditMetadata(metadata),
    occurredAt: now,
  }).run()
}

function requireUnusedMutationId(database: SmbaDatabaseExecutor, mutationId: string) {
  if (readAuditEventByIdempotencyKey(database, mutationId)) {
    financeError("IDEMPOTENCY_CONFLICT", "This mutation identifier was already used.")
  }
}

function nextFeeReference(
  database: SmbaDatabaseExecutor,
  createFeeReference: () => string,
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reference = createFeeReference().toUpperCase()
    if (!isValidFeeReference(reference)) {
      financeError("INVALID_INPUT", "The fee reference generator returned an invalid value.")
    }
    const existing = database.select({ id: financialCharges.id }).from(financialCharges)
      .where(sql`lower(${financialCharges.feeReference}) = lower(${reference})`).get()
    if (!existing) return reference
  }
  throw new Error("Unable to allocate a unique fee reference.")
}

function issueCharge(
  database: SmbaDatabaseExecutor,
  {
    actorId,
    agreementId,
    amountPaise,
    billingPeriod,
    createFeeReference,
    createId,
    description,
    dueDate,
    now,
    playerId,
    type,
  }: {
    actorId: string
    agreementId?: string
    amountPaise: number
    billingPeriod?: string
    createFeeReference: () => string
    createId: () => string
    description: string
    dueDate: string
    now: Date
    playerId: string
    type: "registration" | "monthly_training"
  },
) {
  const existing = database.select().from(financialCharges).where(and(
    eq(financialCharges.playerAccountId, playerId),
    eq(financialCharges.type, type),
    type === "registration"
      ? isNull(financialCharges.billingPeriod)
      : eq(financialCharges.billingPeriod, billingPeriod ?? ""),
    eq(financialCharges.lifecycle, "issued"),
  )).get()
  if (existing) return { charge: existing, created: false }

  const id = createId()
  database.insert(financialCharges).values({
    id,
    feeReference: nextFeeReference(database, createFeeReference),
    playerAccountId: playerId,
    feeAgreementId: agreementId,
    type,
    billingPeriod: billingPeriod ?? null,
    description,
    originalAmountPaise: amountPaise,
    currency: FINANCE_CURRENCY,
    dueDate,
    lifecycle: "issued",
    recordRevision: 0,
    issuedByAccountId: actorId,
    issuedAt: now,
  }).run()
  const charge = readCharge(database, id)
  if (!charge) throw new Error("The issued charge could not be read.")
  insertAudit(database, {
    actorId,
    createId,
    entityId: id,
    entityType: "charge",
    eventType: "charge_issued",
    metadata: { amountPaise, billingPeriod: billingPeriod ?? null, playerId, type },
    now,
  })
  return { charge, created: true }
}

export function activateFinance(
  input: { trackingMonth: string; idempotencyKey: string },
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): { activation: FinanceActivation; reused: boolean } {
  if (!isValidMonthKey(input.trackingMonth)) {
    financeError("INVALID_INPUT", "Choose a valid finance tracking month.", "period")
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)

  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    const existing = readFinanceActivation(tx)
    if (existing) {
      if (existing.trackingMonth !== input.trackingMonth) {
        financeError("ALREADY_ACTIVE", "Financial tracking is already active and cannot be reset.")
      }
      return { activation: existing, reused: true }
    }
    if (input.trackingMonth > getAcademyMonthKey(now)) {
      financeError("INVALID_INPUT", "Financial tracking cannot begin in a future month.", "period")
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: FINANCE_ACADEMY_ENTITY_ID,
      entityType: "academy",
      eventType: "finance_activated",
      idempotencyKey,
      metadata: { trackingMonth: input.trackingMonth },
      now,
    })
    return {
      activation: { activatedAt: now.toISOString(), trackingMonth: input.trackingMonth },
      reused: false,
    }
  }, { behavior: "immediate" })
}

function validateAgreementInput(input: CreateFeeAgreementInput) {
  if (!input || typeof input !== "object") financeError("INVALID_INPUT", "Review the fee plan.")
  const effectiveFrom = input.effectiveFrom
  if (!isValidDateKey(effectiveFrom)) {
    financeError("INVALID_INPUT", "Choose a valid effective date.", "effectiveFrom")
  }
  if (!effectiveFrom.endsWith("-01")) {
    financeError("INVALID_INPUT", "A Fee Plan must begin on the first day of a month.", "effectiveFrom")
  }
  const monthlyDueDay = input.monthlyDueDay ?? DEFAULT_MONTHLY_DUE_DAY
  if (!Number.isInteger(monthlyDueDay) || monthlyDueDay < 1 || monthlyDueDay > 28) {
    financeError("INVALID_INPUT", "Choose a monthly due day from 1 to 28.", "monthlyDueDay")
  }
  if (!academyPlanIsValid(input.academyPlan, input.level, input.batch)) {
    financeError("INVALID_INPUT", "The Fee Plan must match the player’s training plan.", "academyPlan")
  }
  return {
    effectiveFrom,
    idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
    monthlyDueDay,
    amountPaise: validateMoney(input.agreedMonthlyFeePaise, "agreedMonthlyFeePaise"),
  }
}

function agreementMatchesInput(
  agreement: typeof feeAgreements.$inferSelect,
  input: CreateFeeAgreementInput,
  validated: ReturnType<typeof validateAgreementInput>,
) {
  return agreement.playerAccountId === input.playerId
    && agreement.academyPlan === input.academyPlan
    && agreement.level === input.level
    && agreement.batch === input.batch
    && agreement.agreedMonthlyFeePaise === validated.amountPaise
    && agreement.monthlyDueDay === validated.monthlyDueDay
    && agreement.effectiveFrom === validated.effectiveFrom
}

function monthlyPreparationCandidates(
  database: SmbaDatabaseExecutor,
  period: string,
  now: Date,
) {
  const candidatesByPlayer = new Map<
    string,
    ReturnType<typeof listMonthlyPreparationCandidates>[number]
  >()
  const currentPeriod = getAcademyDateKey(now).slice(0, 7)
  listMonthlyPreparationCandidates(database, period).forEach((candidate) => {
    const matchesCurrentEnrollment = candidate.agreement.academyPlan
        === candidate.enrollment.academyPlan
      && candidate.agreement.level === candidate.enrollment.level
      && candidate.agreement.batch === candidate.enrollment.batch
    if (period >= currentPeriod && !matchesCurrentEnrollment) return
    const playerId = candidate.agreement.playerAccountId
    const existing = candidatesByPlayer.get(playerId)
    if (!existing
      || candidate.agreement.effectiveFrom > existing.agreement.effectiveFrom
      || (candidate.agreement.effectiveFrom === existing.agreement.effectiveFrom
        && candidate.agreement.createdAt > existing.agreement.createdAt)) {
      candidatesByPlayer.set(playerId, candidate)
    }
  })
  const candidates = [...candidatesByPlayer.values()]
  const playerIds = candidates.map((candidate) => candidate.agreement.playerAccountId)
  const periodAssignments = loadPeriodAssignmentIndex(database, playerIds, period)
  return candidates.map((candidate) => ({
    ...candidate,
    hasAssignment: periodAssignments.has(candidate.agreement.playerAccountId, {
      programme: candidate.agreement.level,
      batch: candidate.agreement.batch,
    }),
  }))
}

function monthlyPreparationPreview(
  database: SmbaDatabaseExecutor,
  period: string,
  now: Date,
): MonthlyPreparationPreview {
  const candidates = monthlyPreparationCandidates(database, period, now)
  const preparedIds = new Set(listPreparedPlayerIds(database, period))
  const activation = readFinanceActivation(database)
  const beforeCutover = !activation || period < activation.trackingMonth

  return {
    ready: beforeCutover ? 0 : candidates.filter(({ agreement, hasAssignment }) => {
      return hasAssignment && !preparedIds.has(agreement.playerAccountId)
    }).length,
    alreadyPrepared: beforeCutover ? 0 : candidates.filter(({ agreement }) => preparedIds.has(
      agreement.playerAccountId,
    )).length,
    awaitingAssignment: beforeCutover ? 0 : candidates.filter(({ hasAssignment }) => (
      !hasAssignment
    )).length,
    setupRequired: beforeCutover
      ? 0
      : listApprovedPlayerIds(database).length - candidates.length,
  }
}

function createAgreement(
  database: SmbaDatabaseExecutor,
  input: CreateFeeAgreementInput,
  {
    actorId,
    createId,
    now,
  }: { actorId: string; createId: () => string; now: Date },
) {
  const validated = validateAgreementInput(input)
  const existingAudit = readAuditEventByIdempotencyKey(database, validated.idempotencyKey)
  if (existingAudit) {
    const metadata = parseAuditMetadata<{ agreementId?: string; playerId?: string }>(
      existingAudit.metadata,
    )
    if (!metadata.agreementId || metadata.playerId !== input.playerId) {
      financeError("IDEMPOTENCY_CONFLICT", "This request identifier was already used.")
    }
    const agreement = database.select().from(feeAgreements)
      .where(eq(feeAgreements.id, metadata.agreementId)).get()
    if (!agreement) throw new Error("The idempotent Fee Agreement is unavailable.")
    if (!agreementMatchesInput(agreement, input, validated)) {
      financeError("IDEMPOTENCY_CONFLICT", "This request identifier was already used differently.")
    }
    return { agreement, reused: true }
  }

  const player = requireActiveFinanceTarget(database, input.playerId)
  if (player.academyPlan !== input.academyPlan
    || player.level !== input.level
    || player.batch !== input.batch) {
    financeError("INVALID_INPUT", "The Fee Plan must match the player’s current training profile.")
  }
  if (!hasCurrentOrFutureMatchingAssignment(
    database,
    input.playerId,
    getAcademyDateKey(now),
    { programme: input.level, batch: input.batch },
  )) {
    financeError(
      "SETUP_REQUIRED",
      "Assign the player to a matching current or future session before creating a Fee Plan.",
      "playerId",
    )
  }

  const existing = readActiveFeeAgreement(database, input.playerId)
  let eventType: "fee_agreement_created" | "fee_agreement_replaced" = "fee_agreement_created"
  if (existing) {
    if (!Number.isInteger(input.expectedAgreementRevision)
      || input.expectedAgreementRevision !== existing.recordRevision) {
      financeError("CONFLICT", "This Fee Plan changed elsewhere. Review it before saving.")
    }
    if (validated.effectiveFrom <= existing.effectiveFrom) {
      financeError("INVALID_INPUT", "A replacement Fee Plan must start after the current plan.", "effectiveFrom")
    }
  }

  const overlappingHistory = database.select({ id: feeAgreements.id })
    .from(feeAgreements).where(and(
      eq(feeAgreements.playerAccountId, input.playerId),
      existing ? ne(feeAgreements.id, existing.id) : undefined,
      or(
        isNull(feeAgreements.effectiveTo),
        gte(feeAgreements.effectiveTo, validated.effectiveFrom),
      ),
    )).get()
  if (overlappingHistory) {
    financeError(
      "CONFLICT",
      "The new Fee Plan overlaps an existing plan. Choose a later start month.",
      "effectiveFrom",
    )
  }

  if (existing) {
    const update = database.update(feeAgreements).set({
      effectiveTo: addCalendarDays(validated.effectiveFrom, -1),
      status: "ended",
      recordRevision: sql`${feeAgreements.recordRevision} + 1`,
      updatedByAccountId: actorId,
      updatedAt: now,
    }).where(and(
      eq(feeAgreements.id, existing.id),
      eq(feeAgreements.recordRevision, existing.recordRevision),
    )).run()
    if (update.changes !== 1) {
      financeError("CONFLICT", "This Fee Plan changed elsewhere. Review it before saving.")
    }
    eventType = "fee_agreement_replaced"
  }

  const agreementId = createId()
  database.insert(feeAgreements).values({
    id: agreementId,
    playerAccountId: input.playerId,
    academyPlan: input.academyPlan,
    level: input.level,
    batch: input.batch,
    agreedMonthlyFeePaise: validated.amountPaise,
    currency: FINANCE_CURRENCY,
    monthlyDueDay: validated.monthlyDueDay,
    effectiveFrom: validated.effectiveFrom,
    effectiveTo: null,
    status: "active",
    recordRevision: 0,
    createdByAccountId: actorId,
    createdAt: now,
    updatedByAccountId: actorId,
    updatedAt: now,
  }).run()
  insertAudit(database, {
    actorId,
    createId,
    entityId: agreementId,
    entityType: "fee_agreement",
    eventType,
    idempotencyKey: validated.idempotencyKey,
    metadata: { agreementId, playerId: input.playerId, replacedAgreementId: existing?.id ?? null },
    now,
  })
  const agreement = database.select().from(feeAgreements)
    .where(eq(feeAgreements.id, agreementId)).get()
  if (!agreement) throw new Error("The Fee Agreement could not be read.")
  return { agreement, reused: false }
}

export function createOrReplaceFeeAgreement(
  input: CreateFeeAgreementInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
) {
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    return createAgreement(tx, input, { actorId: coachId, createId, now })
  }, { behavior: "immediate" })
}

function nextMonth(period: string) {
  return addCalendarDays(monthEnd(period), 1).slice(0, 7)
}

function monthsBetween(first: string, last: string) {
  const periods: string[] = []
  for (let period = first; period <= last; period = nextMonth(period)) periods.push(period)
  return periods
}

function onboardingTerms(input: OnboardingFinanceTerms) {
  if (!input || typeof input !== "object") financeError("INVALID_INPUT", "Review the Fee Plan.")
  if (!input.playerId?.trim()) financeError("INVALID_INPUT", "Choose a player.", "playerId")
  const monthlyDueDay = input.monthlyDueDay ?? DEFAULT_MONTHLY_DUE_DAY
  if (!Number.isInteger(monthlyDueDay) || monthlyDueDay < 1 || monthlyDueDay > 28) {
    financeError("INVALID_INPUT", "Choose a monthly due day from 1 to 28.", "monthlyDueDay")
  }
  if (!academyPlanIsValid(input.academyPlan, input.level, input.batch)) {
    financeError("INVALID_INPUT", "The Fee Plan must match the player’s training plan.", "academyPlan")
  }
  return {
    amountPaise: validateMoney(input.agreedMonthlyFeePaise, "agreedMonthlyFeePaise"),
    monthlyDueDay,
  }
}

function buildOnboardingFinancePreview(
  database: SmbaDatabaseExecutor,
  input: OnboardingFinanceTerms,
  now: Date,
): OnboardingFinancePreview {
  const validated = onboardingTerms(input)
  const activation = requireFinanceActive(database)
  const academyDateKey = getAcademyDateKey(now)
  const academyPeriod = academyDateKey.slice(0, 7)
  const enrollment = database.select({
    academyPlan: playerEnrollments.academyPlan,
    batch: playerEnrollments.batch,
    level: playerEnrollments.level,
    onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
    recordRevision: playerEnrollments.recordRevision,
    trainingStartConfirmedAt: playerEnrollments.trainingStartConfirmedAt,
    trainingStartOn: playerEnrollments.trainingStartOn,
  }).from(playerEnrollments).where(eq(playerEnrollments.accountId, input.playerId)).get()
  if (!enrollment) financeError("PLAYER_UNAVAILABLE", "Choose an approved active player.", "playerId")

  const blockers: string[] = []
  const warnings: string[] = []
  if (!enrollment.trainingStartConfirmedAt) blockers.push("Confirm the training start date in Assessment.")
  if (trainingStartIsImplausiblyEarly(enrollment.trainingStartOn, academyDateKey)) {
    blockers.push(IMPLAUSIBLE_TRAINING_START_MESSAGE)
  }
  if (enrollment.onboardingCompletedAt) blockers.push("This player’s onboarding is already complete.")
  if (enrollment.trainingStartOn > academyDateKey) {
    blockers.push(`Fee completion opens on ${enrollment.trainingStartOn}.`)
  }
  if (enrollment.academyPlan !== input.academyPlan
    || enrollment.level !== input.level
    || enrollment.batch !== input.batch) {
    blockers.push("The Fee Plan no longer matches the player’s confirmed assessment.")
  }

  const assignments = database.select({
    effectiveFrom: sessionAssignments.effectiveFrom,
    effectiveTo: sessionAssignments.effectiveTo,
    id: sessionAssignments.id,
    seriesEndsOn: sessionSeries.endsOn,
    seriesId: sessionSeries.id,
    seriesStartsOn: sessionSeries.startsOn,
    seriesStatus: sessionSeries.status,
  }).from(sessionAssignments)
    .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
    .where(and(
      eq(sessionAssignments.accountId, input.playerId),
      eq(sessionSeries.programme, input.level),
      eq(sessionSeries.batch, input.batch),
    )).all()
  const usableAssignments = assignments.filter((assignment) => {
    const start = [
      enrollment.trainingStartOn,
      assignment.effectiveFrom,
      assignment.seriesStartsOn,
    ].reduce((latest, value) => value > latest ? value : latest)
    const ends = [assignment.effectiveTo, assignment.seriesEndsOn]
      .filter((value): value is string => value !== null)
    return !ends.length || ends.every((value) => value >= start)
  })
  if (!usableAssignments.length) blockers.push("Assign a matching session before completing fees.")

  const firstEligibleDate = usableAssignments
    .map((assignment) => [
      enrollment.trainingStartOn,
      assignment.effectiveFrom,
      assignment.seriesStartsOn,
    ].reduce((latest, value) => value > latest ? value : latest))
    .sort()[0] ?? enrollment.trainingStartOn
  let feePlanPeriod = firstEligibleDate.slice(0, 7)
  let firstProration = readFirstMonthSessionProration(database, {
    batch: input.batch,
    period: feePlanPeriod,
    playerId: input.playerId,
    programme: input.level,
    trainingStartOn: firstEligibleDate,
  })
  while (feePlanPeriod <= academyPeriod
    && (firstProration.totalSessions === 0 || firstProration.remainingSessions === 0)) {
    feePlanPeriod = nextMonth(feePlanPeriod)
    firstProration = readFirstMonthSessionProration(database, {
      batch: input.batch,
      period: feePlanPeriod,
      playerId: input.playerId,
      programme: input.level,
      trainingStartOn: firstEligibleDate,
    })
  }
  const feePlanStartOn = `${feePlanPeriod}-01`
  const relevantPeriods = feePlanPeriod <= academyPeriod
    ? monthsBetween(feePlanPeriod, academyPeriod)
    : []

  const existingAgreements = database.select().from(feeAgreements)
    .where(eq(feeAgreements.playerAccountId, input.playerId)).all()
  if (existingAgreements.length) blockers.push("An existing Fee Plan must be resolved in the finance record.")
  const existingCharges = database.select().from(financialCharges)
    .where(eq(financialCharges.playerAccountId, input.playerId)).all()
  if (existingCharges.some((charge) => (
    charge.type === "registration"
    || (charge.billingPeriod !== null && relevantPeriods.includes(charge.billingPeriod))
  ))) blockers.push("Existing issued or voided charges conflict with this onboarding timeline.")

  const completionReadyOn = addCalendarDays(academyDateKey, 3)
  const lines: OnboardingFinancePreviewLine[] = [{
    amountPaise: REGISTRATION_FEE_PAISE,
    denominator: null,
    description: "SMBA registration fee",
    dueDate: academyDateKey,
    kind: "registration",
    numerator: null,
    period: null,
  }]
  const pausedPeriods: string[] = []
  relevantPeriods.forEach((period, index) => {
    const covered = usableAssignments.some((assignment) => (
      assignment.effectiveFrom <= monthEnd(period)
      && (assignment.effectiveTo === null || assignment.effectiveTo > monthStart(period))
      && assignment.seriesStartsOn <= monthEnd(period)
      && (assignment.seriesEndsOn === null || assignment.seriesEndsOn >= monthStart(period))
    ))
    // Pausing ends an assignment and resuming creates a new one, so a returning
    // player has real gaps in their assignment history. Those months carry no
    // training and so no fee, rather than blocking the whole timeline. The first
    // fee month is the exception: it carries the partial-month session count, so
    // an uncovered one means the timeline itself is inconsistent.
    if (!covered) {
      if (index === 0) blockers.push(`No matching session assignment covers ${period}.`)
      else pausedPeriods.push(period)
      return
    }
    if (period < activation.trackingMonth) {
      lines.push({
        amountPaise: null,
        denominator: index === 0 ? firstProration.totalSessions : null,
        description: "Training history before financial tracking",
        dueDate: null,
        kind: "before_tracking",
        numerator: index === 0 ? firstProration.remainingSessions : null,
        period,
      })
      return
    }
    const isProrated = index === 0
      && firstProration.totalSessions > 0
      && firstProration.remainingSessions < firstProration.totalSessions
    const isFirstSessionMonth = index === 0 && firstProration.totalSessions > 0
    const amountPaise = isProrated
      ? calculateProratedSessionFee(
          validated.amountPaise,
          firstProration.remainingSessions,
          firstProration.totalSessions,
        )
      : validated.amountPaise
    if (amountPaise === 0) {
      blockers.push("The partial fee rounds to ₹0. Increase the agreed fee or review the start date.")
    }
    const normalDueDate = dateInMonth(period, validated.monthlyDueDay)
    lines.push({
      amountPaise,
      denominator: isFirstSessionMonth ? firstProration.totalSessions : null,
      description: isFirstSessionMonth
        ? `First monthly training fee · ${firstProration.remainingSessions}/${firstProration.totalSessions} sessions`
        : `Monthly training fee · ${period}`,
      dueDate: completionReadyOn > normalDueDate ? completionReadyOn : normalDueDate,
      kind: "monthly_training",
      numerator: isFirstSessionMonth ? firstProration.remainingSessions : null,
      period,
    })
  })
  if (lines.some((line) => line.kind === "before_tracking")) {
    warnings.push("Periods before financial tracking will be recorded as history without charges.")
  }
  if (pausedPeriods.length) {
    warnings.push(
      `No session assignment covers ${pausedPeriods.join(", ")}; no fee is due for those months.`,
    )
  }
  if (feePlanPeriod > academyPeriod) {
    warnings.push(`No monthly charge is due now; the Fee Plan begins in ${feePlanPeriod}.`)
  }

  const concessionState = database.select().from(concessions).where(and(
    eq(concessions.playerAccountId, input.playerId),
    eq(concessions.mode, "recurring"),
  )).orderBy(asc(concessions.createdAt), asc(concessions.id)).all()
  const occurrenceState = usableAssignments.length
    ? database.select({
      id: sessionOccurrences.id,
      occurrenceDate: sessionOccurrences.occurrenceDate,
      replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
      status: sessionOccurrences.status,
    }).from(sessionOccurrences).where(inArray(
      sessionOccurrences.seriesId,
      [...new Set(usableAssignments.map(({ seriesId }) => seriesId))],
    )).orderBy(asc(sessionOccurrences.id)).all()
    : []
  if (usableAssignments.length && !occurrenceState.some(({ status }) => status === "scheduled")) {
    blockers.push("The assigned session calendar has no eligible scheduled sessions.")
  }
  const fingerprintInput = {
    academyDateKey,
    assignments: usableAssignments,
    blockers,
    charges: existingCharges.map((charge) => ({
      billingPeriod: charge.billingPeriod,
      id: charge.id,
      lifecycle: charge.lifecycle,
      recordRevision: charge.recordRevision,
      type: charge.type,
    })),
    concessions: concessionState,
    existingAgreements: existingAgreements.map((agreement) => ({
      effectiveFrom: agreement.effectiveFrom,
      effectiveTo: agreement.effectiveTo,
      id: agreement.id,
      recordRevision: agreement.recordRevision,
      status: agreement.status,
    })),
    lines,
    occurrences: occurrenceState,
    playerRecordRevision: enrollment.recordRevision,
    terms: { ...input, monthlyDueDay: validated.monthlyDueDay },
    trackingMonth: activation.trackingMonth,
    trainingStartOn: enrollment.trainingStartOn,
    warnings,
  }
  return {
    academyDateKey,
    blockers,
    feePlanStartOn,
    fingerprint: financialPayloadFingerprint(fingerprintInput),
    lines,
    playerRecordRevision: enrollment.recordRevision,
    totalIssuedPaise: lines.reduce((total, line) => total + (line.amountPaise ?? 0), 0),
    trackingMonth: activation.trackingMonth,
    trainingStartOn: enrollment.trainingStartOn,
    warnings,
  }
}

export function previewPlayerOnboardingFinance(
  input: OnboardingFinanceTerms,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: Pick<CoachContext, "coachId" | "database" | "now">,
) {
  requireCoach(database, coachId)
  return buildOnboardingFinancePreview(database, input, now)
}

export function completePlayerOnboardingFinance(
  input: CommitOnboardingFinanceInput,
  {
    coachId,
    createFeeReference = createOpaqueFeeReference,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): CompleteOnboardingFinanceResult {
  if (!input?.previewFingerprint || !/^[0-9a-f]{64}$/u.test(input.previewFingerprint)) {
    financeError("INVALID_INPUT", "Review the latest onboarding fee preview.")
  }
  const submittedTerms: OnboardingFinanceTerms = {
    academyPlan: input.academyPlan,
    agreedMonthlyFeePaise: input.agreedMonthlyFeePaise,
    batch: input.batch,
    level: input.level,
    monthlyDueDay: input.monthlyDueDay,
    playerId: input.playerId,
  }
  const submittedTermsFingerprint = financialPayloadFingerprint(submittedTerms)
  const operationKey = `onboarding:${input.playerId}:${input.previewFingerprint}`

  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, operationKey)
    if (replay) {
      const metadata = parseAuditMetadata<{
        fingerprint?: string
        operation?: string
        result?: CompleteOnboardingFinanceResult
        termsFingerprint?: string
      }>(replay.metadata)
      if (replay.eventType !== "historical_reconciled"
        || metadata.operation !== "onboarding_completed"
        || metadata.fingerprint !== input.previewFingerprint
        || metadata.termsFingerprint !== submittedTermsFingerprint
        || !metadata.result) {
        financeError("IDEMPOTENCY_CONFLICT", "This onboarding confirmation was already used differently.")
      }
      return { ...metadata.result, reused: true }
    }

    const preview = buildOnboardingFinancePreview(tx, submittedTerms, now)
    if (preview.fingerprint !== input.previewFingerprint) {
      financeError("CONFLICT", "The onboarding fee preview changed. Review it again before confirming.")
    }
    if (preview.blockers.length) {
      financeError("SETUP_REQUIRED", preview.blockers[0], "playerId")
    }

    const agreementResult = createAgreement(tx, {
      ...submittedTerms,
      effectiveFrom: preview.feePlanStartOn,
      idempotencyKey: `${operationKey}:plan`,
    }, { actorId: coachId, createId, now })
    const registrationLine = preview.lines.find((line) => line.kind === "registration")
    if (!registrationLine?.amountPaise || !registrationLine.dueDate) {
      throw new Error("The registration preview is incomplete.")
    }
    const registration = issueCharge(tx, {
      actorId: coachId,
      amountPaise: registrationLine.amountPaise,
      createFeeReference,
      createId,
      description: registrationLine.description,
      dueDate: registrationLine.dueDate,
      now,
      playerId: input.playerId,
      type: "registration",
    })
    const monthlyResults = preview.lines.flatMap((line) => {
      if (line.kind !== "monthly_training" || !line.period || !line.amountPaise || !line.dueDate) {
        return []
      }
      const issued = issueCharge(tx, {
        actorId: coachId,
        agreementId: agreementResult.agreement.id,
        amountPaise: line.amountPaise,
        billingPeriod: line.period,
        createFeeReference,
        createId,
        description: line.description,
        dueDate: line.dueDate,
        now,
        playerId: input.playerId,
        type: "monthly_training",
      })
      applyRecurringConcessionForCharge(tx, issued.charge, line.period, {
        actorId: coachId,
        createId,
        now,
      })
      return [{ issued, line }]
    })
    const enrollmentUpdate = tx.update(playerEnrollments).set({
      onboardingCompletedAt: now,
      onboardingCompletedByAccountId: coachId,
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(playerEnrollments.accountId, input.playerId),
      eq(playerEnrollments.recordRevision, preview.playerRecordRevision),
      isNull(playerEnrollments.onboardingCompletedAt),
    )).run()
    if (enrollmentUpdate.changes !== 1) {
      financeError("CONFLICT", "The onboarding record changed. Review the fee preview again.")
    }

    const firstMonthly = monthlyResults[0] ?? null
    const result: CompleteOnboardingFinanceResult = {
      agreementId: agreementResult.agreement.id,
      createdMonthlyChargeIds: monthlyResults.map(({ issued }) => issued.charge.id),
      firstMonthlyChargeId: firstMonthly?.issued.charge.id ?? null,
      firstMonthlyFeePaise: firstMonthly?.issued.charge.originalAmountPaise ?? null,
      firstMonthlyRemainingSessions: firstMonthly?.line.numerator ?? null,
      firstMonthlyTotalSessions: firstMonthly?.line.denominator ?? null,
      registrationChargeId: registration.charge.id,
      reused: false,
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: input.playerId,
      entityType: "player",
      eventType: "historical_reconciled",
      idempotencyKey: operationKey,
      metadata: {
        beforeTrackingPeriods: preview.lines
          .filter((line) => line.kind === "before_tracking")
          .map((line) => line.period),
        fingerprint: preview.fingerprint,
        operation: "onboarding_completed",
        result,
        termsFingerprint: submittedTermsFingerprint,
        trainingStartOn: preview.trainingStartOn,
      },
      now,
    })
    return result
  }, { behavior: "immediate" })
}

function toFeeAgreementView(agreement: typeof feeAgreements.$inferSelect): FeeAgreementView {
  return {
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
  }
}

export function endFeeAgreement(
  input: EndFeeAgreementInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): EndFeeAgreementResult {
  if (!input || typeof input !== "object" || typeof input.agreementId !== "string"
    || input.agreementId.trim().length === 0) {
    financeError("INVALID_INPUT", "Choose the Fee Plan to end.")
  }
  if (!isValidMonthKey(input.effectiveThroughPeriod)) {
    financeError("INVALID_INPUT", "Choose a valid final fee month.", "period")
  }
  const reason = requireText(input.reason, "reason", "A reason for ending the Fee Plan")
  const expectedRevision = validateRevision(
    input.expectedRevision,
    "Review the Fee Plan before ending it.",
  )
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const effectiveTo = monthEnd(input.effectiveThroughPeriod)
  const fingerprint = financialPayloadFingerprint({
    agreementId: input.agreementId,
    effectiveThroughPeriod: input.effectiveThroughPeriod,
    expectedRevision,
    reason,
  })

  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      const metadata = parseAuditMetadata<{
        agreementId?: string
        fingerprint?: string
      }>(replay.metadata)
      if (replay.eventType !== "fee_agreement_ended"
        || replay.entityId !== input.agreementId
        || metadata.agreementId !== input.agreementId
        || metadata.fingerprint !== fingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This request identifier was already used differently.")
      }
      const agreement = tx.select().from(feeAgreements)
        .where(eq(feeAgreements.id, input.agreementId)).get()
      if (!agreement) throw new Error("The ended Fee Plan is unavailable.")
      return { agreement: toFeeAgreementView(agreement), reused: true }
    }

    const agreement = tx.select().from(feeAgreements)
      .where(eq(feeAgreements.id, input.agreementId)).get()
    if (!agreement || agreement.status !== "active") {
      financeError("NOT_FOUND", "Choose an active Fee Plan.")
    }
    requireActiveFinanceTarget(tx, agreement.playerAccountId)
    if (agreement.recordRevision !== expectedRevision) {
      financeError("CONFLICT", "This Fee Plan changed elsewhere. Review it before ending it.")
    }
    if (input.effectiveThroughPeriod < agreement.effectiveFrom.slice(0, 7)) {
      financeError("INVALID_INPUT", "The final fee month cannot precede the Fee Plan.", "period")
    }
    const laterCharge = tx.select({ id: financialCharges.id })
      .from(financialCharges).where(and(
        eq(financialCharges.playerAccountId, agreement.playerAccountId),
        eq(financialCharges.type, "monthly_training"),
        eq(financialCharges.lifecycle, "issued"),
        gt(financialCharges.billingPeriod, input.effectiveThroughPeriod),
      )).get()
    if (laterCharge) {
      financeError(
        "CONFLICT",
        "A later monthly fee already exists. Review or void it before ending this Fee Plan.",
        "period",
      )
    }
    const update = tx.update(feeAgreements).set({
      effectiveTo,
      status: "ended",
      recordRevision: sql`${feeAgreements.recordRevision} + 1`,
      updatedByAccountId: coachId,
      updatedAt: now,
    }).where(and(
      eq(feeAgreements.id, agreement.id),
      eq(feeAgreements.status, "active"),
      eq(feeAgreements.recordRevision, expectedRevision),
    )).run()
    if (update.changes !== 1) {
      financeError("CONFLICT", "This Fee Plan changed elsewhere. Review it before ending it.")
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: agreement.id,
      entityType: "fee_agreement",
      eventType: "fee_agreement_ended",
      idempotencyKey,
      metadata: {
        agreementId: agreement.id,
        effectiveThroughPeriod: input.effectiveThroughPeriod,
        effectiveTo,
        fingerprint,
        playerId: agreement.playerAccountId,
        reason,
      },
      now,
    })
    const ended = tx.select().from(feeAgreements)
      .where(eq(feeAgreements.id, agreement.id)).get()
    if (!ended) throw new Error("The ended Fee Plan is unavailable.")
    return { agreement: toFeeAgreementView(ended), reused: false }
  }, { behavior: "immediate" })
}

/**
 * Confirming a training start later than the player actually began is the one
 * mistake immutability cannot absorb: the earlier months become unbillable and
 * their attendance unrecordable, with no way back. This head-coach-only path
 * corrects the date backwards, and only while doing so contradicts nothing that
 * has already been recorded. Moving the date forward stays forbidden — that
 * direction invalidates attendance already taken and is instead recoverable by
 * voiding the charge that was issued too early.
 */
export function redateConfirmedTrainingStart(
  input: RedateConfirmedTrainingStartInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): RedateConfirmedTrainingStartResult {
  if (!input?.playerId?.trim()) financeError("INVALID_INPUT", "Choose a player.", "playerId")
  if (!isValidDateKey(input.trainingStartOn)) {
    financeError("INVALID_INPUT", "Choose a valid training start date.", "trainingStartOn")
  }
  const reason = requireText(input.reason, "reason", "A reason for the corrected training start")
  const expectedRevision = validateRevision(
    input.expectedRevision,
    "Review the onboarding record before correcting the training start date.",
  )
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const fingerprint = financialPayloadFingerprint({
    expectedRevision,
    playerId: input.playerId,
    reason,
    trainingStartOn: input.trainingStartOn,
  })

  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      const metadata = parseAuditMetadata<{
        fingerprint?: string
        result?: RedateConfirmedTrainingStartResult
      }>(replay.metadata)
      if (replay.eventType !== "training_start_redated"
        || replay.entityId !== input.playerId
        || metadata.fingerprint !== fingerprint
        || !metadata.result) {
        financeError("IDEMPOTENCY_CONFLICT", "This request identifier was already used differently.")
      }
      return { ...metadata.result, reused: true }
    }

    requireActiveFinanceTarget(tx, input.playerId)
    const enrollment = tx.select({
      onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
      recordRevision: playerEnrollments.recordRevision,
      trainingStartOn: playerEnrollments.trainingStartOn,
    }).from(playerEnrollments)
      .where(eq(playerEnrollments.accountId, input.playerId)).get()
    if (!enrollment) financeError("NOT_FOUND", "Choose an approved active player.", "playerId")
    if (!enrollment.onboardingCompletedAt) {
      financeError(
        "SETUP_REQUIRED",
        "Correct the training start date in Assessment while onboarding is unfinished.",
        "trainingStartOn",
      )
    }
    if (enrollment.recordRevision !== expectedRevision) {
      financeError("CONFLICT", "This onboarding record changed elsewhere. Review it and try again.")
    }
    if (input.trainingStartOn >= enrollment.trainingStartOn) {
      financeError(
        "INVALID_INPUT",
        "A confirmed training start can only be corrected to an earlier date. "
          + "Void the fees issued too early instead.",
        "trainingStartOn",
      )
    }
    if (trainingStartIsImplausiblyEarly(input.trainingStartOn, getAcademyDateKey(now))) {
      financeError("INVALID_INPUT", IMPLAUSIBLE_TRAINING_START_MESSAGE, "trainingStartOn")
    }

    // Widening the window backwards cannot invalidate attendance or a later
    // full-fee month, but it does re-base the first billed month. Refuse while
    // any fee already stands in the months the correction re-bases.
    const reopenedPeriods = monthsBetween(
      input.trainingStartOn.slice(0, 7),
      enrollment.trainingStartOn.slice(0, 7),
    )
    const contradicted = tx.select({
      billingPeriod: financialCharges.billingPeriod,
      id: financialCharges.id,
    }).from(financialCharges).where(and(
      eq(financialCharges.playerAccountId, input.playerId),
      eq(financialCharges.type, "monthly_training"),
      eq(financialCharges.lifecycle, "issued"),
      inArray(financialCharges.billingPeriod, reopenedPeriods),
    )).all()
    if (contradicted.length) {
      const chargeIds = contradicted.map(({ id }) => id)
      const settled = Boolean(tx.select({ id: paymentAllocations.id }).from(paymentAllocations)
        .where(inArray(paymentAllocations.chargeId, chargeIds)).get())
      const adjusted = Boolean(tx.select({ id: chargeAdjustments.id }).from(chargeAdjustments)
        .where(inArray(chargeAdjustments.chargeId, chargeIds)).get())
      const periods = contradicted.map(({ billingPeriod }) => billingPeriod).join(", ")
      financeError(
        "CONFLICT",
        settled
          ? `Reverse the payments on the ${periods} monthly fee, then void it, before correcting the training start date.`
          : adjusted
            ? `Reverse the adjustments on the ${periods} monthly fee, then void it, before correcting the training start date.`
            : `Void the ${periods} monthly fee before correcting the training start date.`,
        "trainingStartOn",
      )
    }

    const update = tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      trainingStartConfirmedAt: now,
      trainingStartConfirmedByAccountId: coachId,
      trainingStartOn: input.trainingStartOn,
      updatedAt: now,
    }).where(and(
      eq(playerEnrollments.accountId, input.playerId),
      eq(playerEnrollments.recordRevision, expectedRevision),
      isNotNull(playerEnrollments.onboardingCompletedAt),
    )).run()
    if (update.changes !== 1) {
      financeError("CONFLICT", "This onboarding record changed elsewhere. Review it and try again.")
    }

    // The earliest Fee Plan is extended back to the corrected month so the
    // reopened months can be prepared. Later plans all start at or after it, so
    // widening the earliest cannot overlap them.
    const earliest = tx.select().from(feeAgreements)
      .where(eq(feeAgreements.playerAccountId, input.playerId))
      .orderBy(asc(feeAgreements.effectiveFrom), asc(feeAgreements.createdAt))
      .get()
    const reopenedFrom = monthStart(reopenedPeriods[0])
    let agreementEffectiveFrom = earliest?.effectiveFrom ?? null
    if (earliest && earliest.effectiveFrom > reopenedFrom) {
      const planUpdate = tx.update(feeAgreements).set({
        effectiveFrom: reopenedFrom,
        recordRevision: sql`${feeAgreements.recordRevision} + 1`,
        updatedByAccountId: coachId,
        updatedAt: now,
      }).where(and(
        eq(feeAgreements.id, earliest.id),
        eq(feeAgreements.recordRevision, earliest.recordRevision),
      )).run()
      if (planUpdate.changes !== 1) {
        financeError("CONFLICT", "This Fee Plan changed elsewhere. Review it and try again.")
      }
      agreementEffectiveFrom = reopenedFrom
    }

    const result: RedateConfirmedTrainingStartResult = {
      agreementEffectiveFrom,
      agreementId: earliest?.id ?? null,
      playerId: input.playerId,
      previousTrainingStartOn: enrollment.trainingStartOn,
      recordRevision: expectedRevision + 1,
      reopenedPeriods,
      reused: false,
      trainingStartOn: input.trainingStartOn,
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: input.playerId,
      entityType: "player",
      eventType: "training_start_redated",
      idempotencyKey,
      metadata: {
        fingerprint,
        operation: "training_start_redated",
        playerId: input.playerId,
        reason,
        result,
      },
      now,
    })
    return result
  }, { behavior: "immediate" })
}

export function issueRegistrationChargeForApprovedPlayer({
  approvedAt,
  coachId,
  createFeeReference = createOpaqueFeeReference,
  createId = randomUUID,
  database,
  playerId,
}: {
  approvedAt: Date
  coachId: string
  createFeeReference?: () => string
  createId?: () => string
  database: SmbaDatabaseExecutor
  playerId: string
}) {
  if (!readFinanceActivation(database)) return null
  requireActiveFinanceTarget(database, playerId)
  const approvedOn = getAcademyDateKey(approvedAt)
  return issueCharge(database, {
    actorId: coachId,
    amountPaise: REGISTRATION_FEE_PAISE,
    createFeeReference,
    createId,
    description: "SMBA registration fee",
    dueDate: approvedOn,
    now: approvedAt,
    playerId,
    type: "registration",
  }).charge
}

export function setupExistingPlayerFinance(
  input: ExistingPlayerFinanceSetupInput,
  {
    coachId,
    createFeeReference = createOpaqueFeeReference,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): PlayerFeeRecord {
  if (!input || typeof input !== "object"
    || !["pending", "unresolved"].includes(input.registrationStatus)) {
    financeError("INVALID_INPUT", "Choose a valid registration-fee status.")
  }
  const validatedAgreement = validateAgreementInput(input)
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      const metadata = parseAuditMetadata<{
        playerId?: string
        registrationStatus?: string
      }>(replay.metadata)
      if (replay.eventType !== "historical_reconciled"
        || replay.entityType !== "player"
        || metadata.playerId !== input.playerId
        || metadata.registrationStatus !== input.registrationStatus) {
        financeError("IDEMPOTENCY_CONFLICT", "This reconciliation request was already used.")
      }
      const agreementId = parseAuditMetadata<{ agreementId?: string }>(replay.metadata).agreementId
      const agreement = agreementId
        ? tx.select().from(feeAgreements).where(eq(feeAgreements.id, agreementId)).get()
        : null
      if (!agreement || !agreementMatchesInput(agreement, input, validatedAgreement)) {
        financeError("IDEMPOTENCY_CONFLICT", "This reconciliation request was already used differently.")
      }
      const record = loadPlayerFeeRecord(tx, input.playerId, now)
      if (!record) throw new Error("The reconciled player ledger is unavailable.")
      return record
    }
    const agreementKey = `${idempotencyKey.slice(0, 112)}:agreement`
    const agreementResult = createAgreement(tx, {
      ...input,
      idempotencyKey: agreementKey,
    }, { actorId: coachId, createId, now })
    requireActiveFinanceTarget(tx, input.playerId)

    let charge = tx.select().from(financialCharges).where(and(
      eq(financialCharges.playerAccountId, input.playerId),
      eq(financialCharges.type, "registration"),
      eq(financialCharges.lifecycle, "issued"),
    )).get()
    if (input.registrationStatus !== "unresolved" && !charge) {
      const approvedAt = tx.select({ approvedAt: accounts.approvedAt }).from(accounts)
        .where(eq(accounts.id, input.playerId)).get()?.approvedAt
      if (!approvedAt) throw new Error("The player approval date is unavailable.")
      charge = issueCharge(tx, {
        actorId: coachId,
        amountPaise: REGISTRATION_FEE_PAISE,
        createFeeReference,
        createId,
        description: "SMBA registration fee",
        dueDate: getAcademyDateKey(approvedAt),
        now,
        playerId: input.playerId,
        type: "registration",
      }).charge
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: input.playerId,
      entityType: "player",
      eventType: "historical_reconciled",
      idempotencyKey,
      metadata: {
        agreementId: agreementResult.agreement.id,
        playerId: input.playerId,
        registrationStatus: input.registrationStatus,
      },
      now,
    })
    const record = loadPlayerFeeRecord(tx, input.playerId, now)
    if (!record) throw new Error("The reconciled player ledger is unavailable.")
    return record
  }, { behavior: "immediate" })
}

/**
 * A player's first billed month is prorated to the sessions that actually remain
 * to them, using the same reading of the confirmed training start that the
 * onboarding path uses, so a start still in the future when onboarding completed
 * is charged exactly as a backdated one is.
 *
 * The month is identified from the ledger rather than from the training start
 * alone: the first month a plan bills can fall later than the month the player
 * started, and it is only that first billed month whose fee is partial. Every
 * later month is the full agreed fee, and the training start remains the basis
 * for the session count in either case.
 */
function monthlyChargeBasis(
  database: SmbaDatabaseExecutor,
  {
    agreement,
    isFirstBilledMonth,
    period,
    trainingStartOn,
  }: {
    agreement: typeof feeAgreements.$inferSelect
    isFirstBilledMonth: boolean
    period: string
    trainingStartOn: string
  },
) {
  // Only a start inside the billed month can move that month's due date; a
  // start in an earlier month would otherwise date the fee before the period.
  const dueDate = trainingStartOn.slice(0, 7) === period
    && Number(trainingStartOn.slice(8, 10)) > agreement.monthlyDueDay
    ? addCalendarDays(trainingStartOn, 3)
    : dateInMonth(period, agreement.monthlyDueDay)
  const ordinary = {
    amountPaise: agreement.agreedMonthlyFeePaise,
    description: `Monthly training fee · ${period}`,
    dueDate,
  }
  if (!isFirstBilledMonth) return ordinary

  const proration = readFirstMonthSessionProration(database, {
    batch: agreement.batch,
    period,
    playerId: agreement.playerAccountId,
    programme: agreement.level,
    trainingStartOn,
  })
  if (proration.totalSessions === 0
    || proration.remainingSessions === proration.totalSessions) {
    return ordinary
  }
  return {
    amountPaise: calculateProratedSessionFee(
      agreement.agreedMonthlyFeePaise,
      proration.remainingSessions,
      proration.totalSessions,
    ),
    description: "First monthly training fee · "
      + `${proration.remainingSessions}/${proration.totalSessions} sessions`,
    dueDate,
  }
}

export function prepareMonthlyCharges(
  input: PrepareMonthlyChargesInput,
  {
    coachId,
    createFeeReference = createOpaqueFeeReference,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): PrepareMonthlyChargesResult {
  if (!isValidMonthKey(input.period)) {
    financeError("INVALID_INPUT", "Choose a valid fee month.", "period")
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    const activation = requireFinanceActive(tx)
    if (input.period < activation.trackingMonth) {
      financeError(
        "INVALID_INPUT",
        `Financial tracking begins in ${activation.trackingMonth}.`,
        "period",
      )
    }
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      if (replay.eventType !== "monthly_fees_prepared") {
        financeError("IDEMPOTENCY_CONFLICT", "This request identifier was already used.")
      }
      const result = parseAuditMetadata<
        Omit<PrepareMonthlyChargesResult, "deferred"> & { deferred?: number }
      >(replay.metadata)
      if (result.period !== input.period) {
        financeError("IDEMPOTENCY_CONFLICT", "This request identifier was used for another month.")
      }
      return { ...result, deferred: result.deferred ?? 0, reused: true }
    }

    const candidates = monthlyPreparationCandidates(tx, input.period, now)
    const approvedPlayerIds = listApprovedPlayerIds(tx)
    const candidateIds = new Set(candidates.map(({ agreement }) => agreement.playerAccountId))
    const result: PrepareMonthlyChargesResult = {
      period: input.period,
      ready: 0,
      alreadyPrepared: 0,
      awaitingAssignment: 0,
      deferred: 0,
      setupRequired: approvedPlayerIds.filter((id) => !candidateIds.has(id)).length,
      createdChargeIds: [],
      reused: false,
    }
    /*
     * Three reads that used to run once per candidate, hoisted to one statement
     * each for the whole roster. Preparing a month is the path most likely to
     * hard-fail rather than merely run slowly: production speaks to libSQL over
     * the network with the synchronous driver, and all of this sits inside one
     * `immediate` transaction holding the academy's only write lock.
     *
     * Only reads move. Every write below -- the charge, its fee reference, its
     * audit row, and any concession application -- still runs per charge and in
     * the same order, because those carry idempotency keys and audit metadata
     * that a batch would have to reproduce exactly.
     */
    const candidatePlayerIds = [...new Set(
      candidates.filter((candidate) => candidate.hasAssignment)
        .map((candidate) => candidate.agreement.playerAccountId),
    )]

    const existingByPlayer = new Map(
      candidatePlayerIds.length
        ? tx.select().from(financialCharges).where(and(
          inArray(financialCharges.playerAccountId, candidatePlayerIds),
          eq(financialCharges.type, "monthly_training"),
          eq(financialCharges.billingPeriod, input.period),
          eq(financialCharges.lifecycle, "issued"),
        )).all().map((charge) => [charge.playerAccountId, charge])
        : [],
    )

    const billedEarlierPlayers = new Set(
      candidatePlayerIds.length
        ? tx.select({ playerAccountId: financialCharges.playerAccountId })
          .from(financialCharges).where(and(
            inArray(financialCharges.playerAccountId, candidatePlayerIds),
            eq(financialCharges.type, "monthly_training"),
            eq(financialCharges.lifecycle, "issued"),
            lt(financialCharges.billingPeriod, input.period),
          )).all().map((row) => row.playerAccountId)
        : [],
    )

    // Same ordering the per-charge lookup used, so the same concession wins
    // when a player has more than one covering the period: first row per player
    // after sorting by createdAt then id.
    const recurringConcessionByPlayer = new Map<string, typeof concessions.$inferSelect>()
    if (candidatePlayerIds.length) {
      tx.select().from(concessions).where(and(
        inArray(concessions.playerAccountId, candidatePlayerIds),
        eq(concessions.mode, "recurring"),
        eq(concessions.lifecycle, "active"),
        lte(concessions.startsPeriod, input.period),
        or(isNull(concessions.endsPeriod), gte(concessions.endsPeriod, input.period)),
      )).orderBy(asc(concessions.createdAt), asc(concessions.id)).all()
        .forEach((concession) => {
          if (!recurringConcessionByPlayer.has(concession.playerAccountId)) {
            recurringConcessionByPlayer.set(concession.playerAccountId, concession)
          }
        })
    }

    candidates.forEach(({ agreement, enrollment, hasAssignment }) => {
      if (!hasAssignment) {
        result.awaitingAssignment += 1
        return
      }
      const existing = existingByPlayer.get(agreement.playerAccountId)
      if (existing) {
        result.alreadyPrepared += 1
        applyRecurringConcessionForCharge(tx, existing, input.period, {
          actorId: coachId,
          createId,
          now,
        }, recurringConcessionByPlayer)
        return
      }
      const billedEarlier = billedEarlierPlayers.has(agreement.playerAccountId)
      const basis = monthlyChargeBasis(tx, {
        agreement,
        isFirstBilledMonth: !billedEarlier
          && input.period >= enrollment.trainingStartOn.slice(0, 7),
        period: input.period,
        trainingStartOn: enrollment.trainingStartOn,
      })
      if (basis.amountPaise === 0) {
        result.deferred += 1
        return
      }
      const issued = issueCharge(tx, {
        actorId: coachId,
        agreementId: agreement.id,
        amountPaise: basis.amountPaise,
        billingPeriod: input.period,
        createFeeReference,
        createId,
        description: basis.description,
        dueDate: basis.dueDate,
        now,
        playerId: agreement.playerAccountId,
        type: "monthly_training",
      })
      result.ready += 1
      result.createdChargeIds.push(issued.charge.id)
      applyRecurringConcessionForCharge(tx, issued.charge, input.period, {
        actorId: coachId,
        createId,
        now,
      }, recurringConcessionByPlayer)
    })
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: input.period,
      entityType: "academy",
      eventType: "monthly_fees_prepared",
      idempotencyKey,
      metadata: result,
      now,
    })
    return result
  }, { behavior: "immediate" })
}

function recordAllocatedPaymentCommand(
  input: Omit<RecordAllocatedPaymentInput, "mutationId">,
  idempotencyKey: string,
  {
    coachId,
    createId,
    database,
    now,
  }: Required<Pick<CoachContext, "coachId" | "database" | "now">>
    & { createId: () => string },
): RecordAllocatedPaymentResult {
  const amountPaise = validateMoney(input.amountPaise)
  if (!isValidDateKey(input.receivedOn) || input.receivedOn > getAcademyDateKey(now)) {
    financeError("INVALID_INPUT", "Choose a valid payment date not later than today.", "receivedOn")
  }
  if (!PAYMENT_METHODS.includes(input.method)) {
    financeError("INVALID_INPUT", "Choose a valid payment method.", "method")
  }
  const externalReference = optionalText(input.externalReference, "externalReference", 120)
  const internalNote = optionalText(input.internalNote, "internalNote")
  const allocations = validateAllocationSet(input.allocations, amountPaise)
  const payloadFingerprint = financialPayloadFingerprint({
    ...input,
    allocations,
    externalReference,
    internalNote,
  })

  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readPaymentByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      const legacyAllocations = replay.payloadFingerprint.startsWith("phase1:")
        ? tx.select().from(paymentAllocations)
          .where(eq(paymentAllocations.paymentId, replay.id)).all()
        : []
      const legacyPayloadMatches = replay.payloadFingerprint.startsWith("phase1:")
        && replay.playerAccountId === input.playerId
        && replay.amountPaise === amountPaise
        && replay.receivedOn === input.receivedOn
        && replay.method === input.method
        && replay.externalReference === externalReference
        && replay.internalNote === internalNote
        && allocations.length === 1
        && legacyAllocations.length === 1
        && legacyAllocations[0].chargeId === allocations[0].chargeId
        && legacyAllocations[0].amountPaise === allocations[0].amountPaise
      if (!legacyPayloadMatches && replay.payloadFingerprint !== payloadFingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This payment request was already used differently.")
      }
      const record = loadPlayerFeeRecord(tx, replay.playerAccountId, now)
      const receipt = record?.receipts.find((item) => item.id === replay.id)
      if (!receipt) throw new Error("The idempotent receipt is unavailable.")
      const replayViews = loadChargeViews(
        tx,
        allocations.map((allocation) => allocation.chargeId),
        now,
      )
      const charges = allocations.flatMap((allocation) => {
        const charge = replayViews.get(allocation.chargeId)
        return charge ? [charge] : []
      })
      return { receipt, charges, reused: true }
    }
    requireUnusedMutationId(tx, idempotencyKey)

    requireActiveFinanceTarget(tx, input.playerId)
    const currentPeriod = getAcademyDateKey(now).slice(0, 7)
    const chargeLedgers = loadChargeViews(
      tx,
      allocations.map((allocation) => allocation.chargeId),
      now,
    )
    let monthlyFeePlanChecked = false
    allocations.forEach((allocation) => {
      const charge = readCharge(tx, allocation.chargeId)
      if (!charge || charge.lifecycle !== "issued" || charge.playerAccountId !== input.playerId
        || !isChargeWithinPaymentHorizon(charge, currentPeriod)) {
        financeError("NOT_FOUND", "Choose an active Charge belonging to this player.", "chargeId")
      }
      if (charge.type === "monthly_training" && !monthlyFeePlanChecked) {
        requirePaymentFeePlanHistory(tx, input.playerId)
        monthlyFeePlanChecked = true
      }
      const current = chargeLedgers.get(charge.id)
      if (!current) throw new Error("The Charge ledger is unavailable.")
      if (charge.recordRevision !== allocation.expectedChargeRevision) {
        financeError("BALANCE_CHANGED", "Balance changed. Review the payment allocations.")
      }
      if (allocation.amountPaise > current.outstandingPaise) {
        financeError("INVALID_INPUT", "An allocation exceeds the Charge balance.", "amountPaise")
      }
    })

    const paymentId = createId()
    const receiptReference = allocateFinancialReference(tx, "receipt", input.receivedOn, now)
    tx.insert(payments).values({
      id: paymentId,
      chargeId: allocations.length === 1 ? allocations[0].chargeId : null,
      playerAccountId: input.playerId,
      receiptReference,
      amountPaise,
      currency: FINANCE_CURRENCY,
      receivedOn: input.receivedOn,
      method: input.method,
      externalReference,
      internalNote,
      lifecycle: "recorded",
      idempotencyKey,
      payloadFingerprint,
      recordRevision: 0,
      recordedByAccountId: coachId,
      recordedAt: now,
    }).run()
    allocations.forEach((allocation) => {
      tx.insert(paymentAllocations).values({
        id: createId(),
        paymentId,
        chargeId: allocation.chargeId,
        amountPaise: allocation.amountPaise,
        createdByAccountId: coachId,
        createdAt: now,
      }).run()
      const update = tx.update(financialCharges).set({
        recordRevision: sql`${financialCharges.recordRevision} + 1`,
      }).where(and(
        eq(financialCharges.id, allocation.chargeId),
        eq(financialCharges.recordRevision, allocation.expectedChargeRevision),
      )).run()
      if (update.changes !== 1) {
        financeError("BALANCE_CHANGED", "Balance changed. Review the payment allocations.")
      }
    })
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: paymentId,
      entityType: "payment",
      eventType: "payment_recorded",
      idempotencyKey,
      metadata: {
        amountPaise,
        allocationCount: allocations.length,
        playerId: input.playerId,
        receiptReference,
      },
      now,
    })
    const record = loadPlayerFeeRecord(tx, input.playerId, now)
    const receipt = record?.receipts.find((item) => item.id === paymentId)
    if (!receipt) throw new Error("The recorded receipt is unavailable.")
    const recordedViews = loadChargeViews(
      tx,
      allocations.map((allocation) => allocation.chargeId),
      now,
    )
    const charges = allocations.map((allocation) => recordedViews.get(allocation.chargeId))
      .filter((charge): charge is ChargeView => Boolean(charge))
    return { receipt, charges, reused: false }
  }, { behavior: "immediate" })
}

export function recordAllocatedPayment(
  input: RecordAllocatedPaymentInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
) {
  const mutationId = validateMutationId(input.mutationId)
  return recordAllocatedPaymentCommand(input, mutationId, {
    coachId,
    createId,
    database,
    now,
  })
}

export function previewPaymentAllocations(
  input: PreviewPaymentAllocationsInput,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): PaymentAllocationPreview {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  requireActiveFinanceTarget(database, input.playerId)
  const hasFeePlanHistory = Boolean(readPaymentFeePlanHistory(database, input.playerId))
  const amountPaise = validateMoney(input.amountPaise)
  const currentPeriod = getAcademyDateKey(now).slice(0, 7)
  const chargeRows = database.select().from(financialCharges).where(and(
    eq(financialCharges.playerAccountId, input.playerId),
    eq(financialCharges.lifecycle, "issued"),
    or(
      eq(financialCharges.type, "registration"),
      hasFeePlanHistory ? and(
        eq(financialCharges.type, "monthly_training"),
        lte(financialCharges.billingPeriod, currentPeriod),
      ) : undefined,
    ),
  )).orderBy(
    asc(financialCharges.dueDate),
    asc(financialCharges.issuedAt),
    asc(financialCharges.id),
  ).all()
  const chargeViews = loadChargeViews(database, chargeRows.map((charge) => charge.id), now)
  const available = chargeRows.flatMap((charge) => {
    const view = chargeViews.get(charge.id)
    return view && view.outstandingPaise > 0 ? [{ charge, view }] : []
  })
  let allocations: PaymentAllocationInput[]
  if (input.allocations) {
    allocations = validateAllocationSet(input.allocations, amountPaise)
  } else {
    let remaining = amountPaise
    allocations = available.flatMap(({ charge, view }) => {
      if (remaining === 0) return []
      const allocated = Math.min(remaining, view.outstandingPaise)
      remaining -= allocated
      return [{
        chargeId: charge.id,
        amountPaise: allocated,
        expectedChargeRevision: charge.recordRevision,
      }]
    })
    if (remaining > 0) {
      financeError("INVALID_INPUT", "Payment exceeds the player’s outstanding balance.", "amountPaise")
    }
  }
  const byCharge = new Map(available.map(({ charge, view }) => [charge.id, { charge, view }]))
  return {
    playerId: input.playerId,
    amountPaise,
    allocations: allocations.map((allocation) => {
      const entry = byCharge.get(allocation.chargeId)
      if (!entry || entry.charge.recordRevision !== allocation.expectedChargeRevision
        || allocation.amountPaise > entry.view.outstandingPaise) {
        financeError("BALANCE_CHANGED", "Balance changed. Review the payment allocations.")
      }
      return {
        ...allocation,
        feeReference: entry.charge.feeReference,
        description: entry.charge.description,
        dueDate: entry.charge.dueDate,
        availablePaise: entry.view.outstandingPaise,
      }
    }),
  }
}

export function recordPayment(
  input: RecordPaymentInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): RecordPaymentResult {
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  requireCoach(database, coachId)
  requireFinanceActive(database)
  const charge = readCharge(database, input.chargeId)
  if (!charge) financeError("NOT_FOUND", "Choose an active Charge.", "chargeId")
  const replay = readPaymentByIdempotencyKey(database, idempotencyKey)
  if (replay) {
    const replayAllocations = database.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, replay.id)).all()
    const externalReference = optionalText(input.externalReference, "externalReference", 120)
    const internalNote = optionalText(input.internalNote, "internalNote")
    const matchesOriginalCommand = replay.playerAccountId === charge.playerAccountId
      && replay.amountPaise === input.amountPaise
      && replay.receivedOn === input.receivedOn
      && replay.method === input.method
      && replay.externalReference === externalReference
      && replay.internalNote === internalNote
      && replayAllocations.length === 1
      && replayAllocations[0].chargeId === input.chargeId
      && replayAllocations[0].amountPaise === input.amountPaise
    if (!matchesOriginalCommand) {
      financeError("IDEMPOTENCY_CONFLICT", "This payment request was already used differently.")
    }
    const current = loadChargeView(database, input.chargeId, now)
    if (!current) throw new Error("The idempotent Payment Charge is unavailable.")
    return { paymentId: replay.id, charge: current, reused: true }
  }
  // Preserve the V1 single-Charge command contract. Exact retries are handled
  // by persisted business facts before ledger validation; the optimistic
  // revision is a concurrency token rather than part of that business payload.
  const current = loadChargeView(database, charge.id, now)
  if (!current || current.lifecycle !== "issued") {
    financeError("NOT_FOUND", "Choose an active Charge.", "chargeId")
  }
  if (current.outstandingPaise === 0) {
    financeError("ALREADY_SETTLED", "This Charge is already settled.")
  }
  const result = recordAllocatedPaymentCommand({
    playerId: charge.playerAccountId,
    amountPaise: input.amountPaise,
    receivedOn: input.receivedOn,
    method: input.method,
    externalReference: input.externalReference,
    internalNote: input.internalNote,
    allocations: [{
      chargeId: input.chargeId,
      amountPaise: input.amountPaise,
      expectedChargeRevision: input.expectedChargeRevision,
    }],
  }, idempotencyKey, { coachId, createId, database, now })
  const updatedCharge = result.charges[0]
  if (!updatedCharge) throw new Error("The updated Charge ledger is unavailable.")
  return { paymentId: result.receipt.id, charge: updatedCharge, reused: result.reused }
}

export function reversePayment(
  input: ReversePaymentInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ChargeView {
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const reason = requireText(input.reason, "reason", "A reversal reason")
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      if (replay.eventType !== "payment_reversed" || replay.entityId !== input.paymentId) {
        financeError("IDEMPOTENCY_CONFLICT", "This reversal request was already used.")
      }
      const metadata = parseAuditMetadata<{
        chargeId?: string
        chargeIds?: string[]
        reason: string
      }>(replay.metadata)
      if (metadata.reason !== reason) {
        financeError("IDEMPOTENCY_CONFLICT", "This reversal request was already used differently.")
      }
      const chargeId = metadata.chargeIds?.[0] ?? metadata.chargeId
      if (!chargeId) throw new Error("The reversed Payment audit trail is incomplete.")
      const charge = loadChargeView(tx, chargeId, now)
      if (!charge) throw new Error("The reversed Payment Charge is unavailable.")
      return charge
    }
    const payment = tx.select().from(payments).where(eq(payments.id, input.paymentId)).get()
    if (!payment) financeError("NOT_FOUND", "Payment not found.")
    requireActiveFinanceTarget(tx, payment.playerAccountId)
    if (payment.lifecycle === "reversed") financeError("CONFLICT", "Payment is already reversed.")
    const activeRefund = tx.select({ id: refunds.id }).from(refundAllocations)
      .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
      .innerJoin(
        paymentAllocations,
        eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
      )
      .where(and(
        eq(paymentAllocations.paymentId, payment.id),
        eq(refunds.lifecycle, "recorded"),
      )).get()
    if (activeRefund) financeError("CONFLICT", "Reverse active Refunds before reversing this receipt.")
    const allocations = tx.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment.id)).all()
    if (!allocations.length) throw new Error("The Payment allocations are unavailable.")
    tx.update(payments).set({
      lifecycle: "reversed",
      recordRevision: sql`${payments.recordRevision} + 1`,
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: reason,
    }).where(and(eq(payments.id, payment.id), eq(payments.lifecycle, "recorded"))).run()
    allocations.forEach((allocation) => {
      tx.update(financialCharges).set({
        recordRevision: sql`${financialCharges.recordRevision} + 1`,
      }).where(eq(financialCharges.id, allocation.chargeId)).run()
    })
    const chargeIds = allocations.map((allocation) => allocation.chargeId)
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: payment.id,
      entityType: "payment",
      eventType: "payment_reversed",
      idempotencyKey,
      metadata: { chargeIds, reason },
      now,
    })
    const charge = loadChargeView(tx, chargeIds[0], now)
    if (!charge) throw new Error("The reversed Payment Charge is unavailable.")
    return charge
  }, { behavior: "immediate" })
}

function withdrawalRefundablePaymentAllocations(
  database: SmbaDatabaseExecutor,
  paymentId: string,
  withdrawalEffectiveOn: string,
  now: Date,
) {
  return database.select({
    charge: financialCharges,
  }).from(paymentAllocations)
    .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
    .where(eq(paymentAllocations.paymentId, paymentId))
    .orderBy(
      desc(financialCharges.dueDate),
      desc(financialCharges.issuedAt),
      desc(financialCharges.id),
    ).all().flatMap(({ charge }) => {
      const period = charge.billingPeriod
      if (charge.type !== "monthly_training" || !period || !charge.feeAgreementId
        || period !== withdrawalEffectiveOn.slice(0, 7)
        || withdrawalEffectiveOn <= monthStart(period)
        || withdrawalEffectiveOn >= monthEnd(period)) {
        return []
      }
      const agreement = database.select().from(feeAgreements)
        .where(eq(feeAgreements.id, charge.feeAgreementId)).get()
      const chargeLedger = loadChargeView(database, charge.id, now)
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
      if (!agreement || !agreementCanClose
        || agreement.playerAccountId !== charge.playerAccountId
        || agreement.effectiveFrom > withdrawalEffectiveOn
        || !chargeLedger
        || chargeLedger.lifecycle !== "issued"
        || chargeLedger.effectiveAmountPaise <= 0
        || chargeLedger.outstandingPaise !== 0
        || chargeLedger.receivedPaise !== chargeLedger.effectiveAmountPaise) {
        return []
      }
      const laterCharge = database.select({ id: financialCharges.id })
        .from(financialCharges).where(and(
          eq(financialCharges.playerAccountId, charge.playerAccountId),
          eq(financialCharges.type, "monthly_training"),
          eq(financialCharges.lifecycle, "issued"),
          gt(financialCharges.billingPeriod, period),
        )).get()
      if (laterCharge) return []
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
      if (activeWithdrawalRefund) return []
      const coveredAllocations = database.select({
        allocation: paymentAllocations,
        payment: payments,
      }).from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(and(
          eq(paymentAllocations.chargeId, charge.id),
          eq(payments.lifecycle, "recorded"),
        )).all()
      if (coveredAllocations.some(({ payment }) => (
        payment.receivedOn > withdrawalEffectiveOn
      ))) return []
      return coveredAllocations.sort((left, right) => (
        Number(right.payment.id === paymentId) - Number(left.payment.id === paymentId)
          || right.payment.receivedOn.localeCompare(left.payment.receivedOn)
          || right.allocation.id.localeCompare(left.allocation.id)
      )).flatMap(({ allocation, payment: allocationPayment }) => {
        const refunded = database.select({
          total: sql<number>`coalesce(sum(${refundAllocations.amountPaise}), 0)`,
        }).from(refundAllocations)
          .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
          .where(and(
            eq(refundAllocations.paymentAllocationId, allocation.id),
            eq(refunds.lifecycle, "recorded"),
          )).get()?.total ?? 0
        const refundablePaise = Math.max(0, allocation.amountPaise - Number(refunded))
        return refundablePaise > 0 ? [{
          allocation,
          agreement,
          charge,
          chargeLedger,
          payment: allocationPayment,
          refundablePaise,
        }] : []
      })
    })
}

function validateWithdrawalEffectiveOn(value: unknown, now: Date) {
  if (typeof value !== "string" || !isValidDateKey(value)
    || value > getAcademyDateKey(now)) {
    financeError(
      "INVALID_INPUT",
      "Choose a valid member withdrawal date not later than today.",
      "withdrawalEffectiveOn",
    )
  }
  return value
}

function enforceUnusedDaysRefundLimit(
  amountPaise: number,
  charge: ChargeView,
  withdrawalEffectiveOn: string,
) {
  const billingPeriod = charge.billingPeriod
  if (!billingPeriod) {
    financeError("INVALID_INPUT", "Choose the final paid monthly fee.", "amountPaise")
  }
  const maximumRefundPaise = calculateUnusedMonthRefundLimit(
    charge.effectiveAmountPaise,
    billingPeriod,
    withdrawalEffectiveOn,
  )
  if (amountPaise > maximumRefundPaise) {
    financeError(
      "INVALID_INPUT",
      `The maximum refund for unused days after ${withdrawalEffectiveOn} is INR ${(maximumRefundPaise / 100).toFixed(2)}.`,
      "amountPaise",
    )
  }
  return maximumRefundPaise
}

function validateRefundAllocationSet(
  allocations: RecordRefundInput["allocations"],
  expectedTotal: number,
  { requireSingleAllocation = true }: { requireSingleAllocation?: boolean } = {},
) {
  if (!Array.isArray(allocations) || !allocations.length) {
    financeError("INVALID_INPUT", "Choose the paid monthly fee being refunded.", "amountPaise")
  }
  if (requireSingleAllocation && allocations.length !== 1) {
    financeError(
      "INVALID_INPUT",
      "A mid-term withdrawal refund must belong to one monthly fee.",
      "amountPaise",
    )
  }
  const seen = new Set<string>()
  const normalized = allocations.map((allocation) => {
    if (!allocation || typeof allocation.paymentAllocationId !== "string"
      || seen.has(allocation.paymentAllocationId)) {
      financeError("INVALID_INPUT", "Review the Refund allocations.", "amountPaise")
    }
    seen.add(allocation.paymentAllocationId)
    return {
      paymentAllocationId: allocation.paymentAllocationId,
      amountPaise: validateMoney(allocation.amountPaise),
    }
  }).sort((left, right) => left.paymentAllocationId.localeCompare(right.paymentAllocationId))
  if (normalized.reduce((total, allocation) => total + allocation.amountPaise, 0) !== expectedTotal) {
    financeError("INVALID_INPUT", "Refund allocations must equal the Refund amount.", "amountPaise")
  }
  return normalized
}

export function previewRefundAllocations(
  input: PreviewRefundAllocationsInput,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): RefundAllocationPreview {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  const amountPaise = validateMoney(input.amountPaise)
  const withdrawalEffectiveOn = validateWithdrawalEffectiveOn(
    input.withdrawalEffectiveOn,
    now,
  )
  const expectedPaymentRevision = validateRevision(
    input.expectedPaymentRevision,
    "Review the receipt before preparing a Refund.",
  )
  const payment = database.select().from(payments).where(eq(payments.id, input.paymentId)).get()
  if (!payment || payment.lifecycle !== "recorded") {
    financeError("NOT_FOUND", "Choose an active receipt.", "paymentId")
  }
  requireActiveFinanceTarget(database, payment.playerAccountId)
  if (payment.recordRevision !== expectedPaymentRevision) {
    financeError("BALANCE_CHANGED", "Receipt changed. Review the refundable amount.")
  }
  if (payment.receivedOn > withdrawalEffectiveOn) {
    financeError(
      "INVALID_INPUT",
      "The member withdrawal date cannot precede the offline payment.",
      "withdrawalEffectiveOn",
    )
  }
  const available = withdrawalRefundablePaymentAllocations(
    database,
    payment.id,
    withdrawalEffectiveOn,
    now,
  )
  let allocations: RecordRefundInput["allocations"]
  if (input.allocations) {
    allocations = validateRefundAllocationSet(input.allocations, amountPaise, {
      requireSingleAllocation: false,
    })
  } else {
    let remaining = amountPaise
    allocations = available.flatMap((item) => {
      if (remaining <= 0) return []
      const allocated = Math.min(remaining, item.refundablePaise)
      remaining -= allocated
      return allocated > 0
        ? [{ paymentAllocationId: item.allocation.id, amountPaise: allocated }]
        : []
    })
    if (remaining > 0) {
      financeError(
        "INVALID_INPUT",
        "A refund requires a fully paid monthly fee for the member’s final month.",
        "amountPaise",
      )
    }
  }
  const byAllocation = new Map(available.map((item) => [item.allocation.id, item]))
  const selectedItems = allocations.map((allocation) => {
    const item = byAllocation.get(allocation.paymentAllocationId)
    if (!item || allocation.amountPaise > item.refundablePaise) {
      financeError("BALANCE_CHANGED", "Refundable amount changed. Review the Refund.")
    }
    return item
  })
  const selectedChargeIds = new Set(selectedItems.map((item) => item.charge.id))
  const selectedCharge = selectedItems[0]?.chargeLedger
  if (selectedChargeIds.size !== 1 || !selectedCharge
    || !selectedItems.some((item) => item.payment.id === payment.id)) {
    financeError(
      "INVALID_INPUT",
      "A mid-term withdrawal refund must belong to one monthly fee.",
      "amountPaise",
    )
  }
  const maximumRefundPaise = enforceUnusedDaysRefundLimit(
    amountPaise,
    selectedCharge,
    withdrawalEffectiveOn,
  )
  return {
    paymentId: payment.id,
    amountPaise,
    maximumRefundPaise,
    allocations: allocations.map((allocation) => {
      const item = byAllocation.get(allocation.paymentAllocationId)
      if (!item) throw new Error("The reviewed Refund allocation is unavailable.")
      return {
        ...allocation,
        chargeId: item.charge.id,
        billingPeriod: item.charge.billingPeriod as string,
        feeReference: item.charge.feeReference,
        description: item.charge.description,
        refundablePaise: item.refundablePaise,
        expectedChargeRevision: item.charge.recordRevision,
        expectedAgreementRevision: item.agreement.recordRevision,
      }
    }),
  }
}

export function recordRefund(
  input: RecordRefundInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): RecordRefundResult {
  const mutationId = validateMutationId(input.mutationId)
  const legacyReplay = database.select().from(refunds)
    .where(and(
      eq(refunds.idempotencyKey, mutationId),
      eq(refunds.purpose, "legacy_unclassified"),
    )).get()
  if (legacyReplay) {
    const legacyAmountPaise = validateMoney(input.amountPaise)
    validateRevision(
      input.expectedPaymentRevision,
      "Review the receipt before recording a Refund.",
    )
    if (!isValidDateKey(input.refundedOn) || input.refundedOn > getAcademyDateKey(now)) {
      financeError("INVALID_INPUT", "Choose a valid Refund date not later than today.")
    }
    if (!PAYMENT_METHODS.includes(input.method)) {
      financeError("INVALID_INPUT", "Choose a valid method.")
    }
    const legacyExternalReference = optionalText(
      input.externalReference,
      "externalReference",
      120,
    )
    const legacyInternalNote = optionalText(input.internalNote, "internalNote")
    const legacyAllocations = validateRefundAllocationSet(
      input.allocations,
      legacyAmountPaise,
      { requireSingleAllocation: false },
    )
    const legacyFingerprint = financialPayloadFingerprint({
      ...input,
      allocations: legacyAllocations,
      externalReference: legacyExternalReference,
      internalNote: legacyInternalNote,
    })
    return database.transaction((tx) => {
      requireCoach(tx, coachId)
      requireFinanceActive(tx)
      const replay = tx.select().from(refunds).where(eq(refunds.id, legacyReplay.id)).get()
      if (!replay || replay.payloadFingerprint !== legacyFingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This Refund request was already used differently.")
      }
      const record = loadPlayerFeeRecord(tx, replay.playerAccountId, now)
      const refund = record?.receipts.flatMap((receipt) => receipt.refunds)
        .find((item) => item.id === replay.id)
      if (!refund) throw new Error("The idempotent Refund is unavailable.")
      const chargeIds = new Set(legacyAllocations.flatMap((allocation) => {
        const paymentAllocation = tx.select().from(paymentAllocations)
          .where(eq(paymentAllocations.id, allocation.paymentAllocationId)).get()
        return paymentAllocation ? [paymentAllocation.chargeId] : []
      }))
      const chargeViews = loadChargeViews(tx, [...chargeIds], now)
      const charges = [...chargeIds].map((chargeId) => chargeViews.get(chargeId))
        .filter((charge): charge is ChargeView => Boolean(charge))
      return { refund, charges, reused: true }
    }, { behavior: "immediate" })
  }
  const amountPaise = validateMoney(input.amountPaise)
  const withdrawalEffectiveOn = validateWithdrawalEffectiveOn(
    input.withdrawalEffectiveOn,
    now,
  )
  const expectedPaymentRevision = validateRevision(
    input.expectedPaymentRevision,
    "Review the receipt before recording a Refund.",
  )
  const expectedChargeRevision = validateRevision(
    input.expectedChargeRevision,
    "Review the monthly fee before recording a Refund.",
  )
  const expectedAgreementRevision = validateRevision(
    input.expectedAgreementRevision,
    "Review the fee agreement before recording a Refund.",
  )
  if (!isValidDateKey(input.refundedOn) || input.refundedOn > getAcademyDateKey(now)) {
    financeError("INVALID_INPUT", "Choose a valid Refund date not later than today.")
  }
  if (withdrawalEffectiveOn > input.refundedOn) {
    financeError(
      "INVALID_INPUT",
      "The refund date cannot precede the member withdrawal date.",
      "withdrawalEffectiveOn",
    )
  }
  if (!PAYMENT_METHODS.includes(input.method)) financeError("INVALID_INPUT", "Choose a valid method.")
  const externalReference = optionalText(input.externalReference, "externalReference", 120)
  const internalNote = optionalText(input.internalNote, "internalNote")
  const allocations = validateRefundAllocationSet(input.allocations, amountPaise, {
    requireSingleAllocation: false,
  })
  const payloadFingerprint = financialPayloadFingerprint({
    ...input,
    allocations,
    externalReference,
    internalNote,
  })
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = tx.select().from(refunds).where(eq(refunds.idempotencyKey, mutationId)).get()
    if (replay) {
      if (replay.payloadFingerprint !== payloadFingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This Refund request was already used differently.")
      }
      const record = loadPlayerFeeRecord(tx, replay.playerAccountId, now)
      const refund = record?.receipts.flatMap((receipt) => receipt.refunds)
        .find((item) => item.id === replay.id)
      if (!refund) throw new Error("The idempotent Refund is unavailable.")
      const allocatedChargeIds = allocations.flatMap((allocation) => {
        const paymentAllocation = tx.select().from(paymentAllocations)
          .where(eq(paymentAllocations.id, allocation.paymentAllocationId)).get()
        return paymentAllocation ? [paymentAllocation.chargeId] : []
      })
      const chargeViews = loadChargeViews(tx, allocatedChargeIds, now)
      const charges = allocatedChargeIds.flatMap((chargeId) => {
        const charge = chargeViews.get(chargeId)
        return charge ? [charge] : []
      })
      return { refund, charges, reused: true }
    }
    requireUnusedMutationId(tx, mutationId)
    const payment = tx.select().from(payments).where(eq(payments.id, input.paymentId)).get()
    if (!payment || payment.lifecycle !== "recorded") {
      financeError("NOT_FOUND", "Choose an active receipt.", "paymentId")
    }
    requireActiveFinanceTarget(tx, payment.playerAccountId)
    if (payment.recordRevision !== expectedPaymentRevision) {
      financeError("BALANCE_CHANGED", "Receipt changed. Review the Refund.")
    }
    if (payment.receivedOn > withdrawalEffectiveOn) {
      financeError(
        "INVALID_INPUT",
        "The member withdrawal date cannot precede the offline payment.",
        "withdrawalEffectiveOn",
      )
    }
    const available = new Map(withdrawalRefundablePaymentAllocations(
      tx,
      payment.id,
      withdrawalEffectiveOn,
      now,
    ).map((item) => [item.allocation.id, item]))
    const selectedItems = allocations.map((allocation) => {
      const availableItem = available.get(allocation.paymentAllocationId)
      if (!availableItem || allocation.amountPaise > availableItem.refundablePaise) {
        financeError(
          "BALANCE_CHANGED",
          "A refund requires a fully paid monthly fee for the member’s final month.",
        )
      }
      return availableItem
    })
    const item = selectedItems[0]
    if (!item || new Set(selectedItems.map((selected) => selected.charge.id)).size !== 1
      || !selectedItems.some((selected) => selected.payment.id === payment.id)) {
      financeError(
        "INVALID_INPUT",
        "A mid-term withdrawal refund must belong to one monthly fee.",
        "amountPaise",
      )
    }
    enforceUnusedDaysRefundLimit(
      amountPaise,
      item.chargeLedger,
      withdrawalEffectiveOn,
    )
    if (item.charge.recordRevision !== expectedChargeRevision
      || item.agreement.recordRevision !== expectedAgreementRevision) {
      financeError("BALANCE_CHANGED", "Fee details changed. Review the Refund.")
    }
    const overlappingAgreement = tx.select({ id: feeAgreements.id }).from(feeAgreements)
      .where(and(
        eq(feeAgreements.playerAccountId, item.agreement.playerAccountId),
        ne(feeAgreements.id, item.agreement.id),
        lte(feeAgreements.effectiveFrom, withdrawalEffectiveOn),
        or(
          isNull(feeAgreements.effectiveTo),
          gte(feeAgreements.effectiveTo, withdrawalEffectiveOn),
        ),
      )).get()
    if (overlappingAgreement) {
      financeError(
        "CONFLICT",
        "The corrected withdrawal date overlaps another Fee Plan.",
        "withdrawalEffectiveOn",
      )
    }

    const adjustmentId = createId()
    tx.insert(chargeAdjustments).values({
      id: adjustmentId,
      chargeId: item.charge.id,
      kind: "withdrawal_credit",
      amountPaise,
      reason: `Unused training after mid-term withdrawal on ${withdrawalEffectiveOn}`,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    const refundId = createId()
    const refundReference = allocateFinancialReference(tx, "refund", input.refundedOn, now)
    tx.insert(refunds).values({
      id: refundId,
      refundReference,
      paymentId: payment.id,
      playerAccountId: payment.playerAccountId,
      purpose: "mid_term_withdrawal",
      withdrawalEffectiveOn,
      chargeAdjustmentId: adjustmentId,
      amountPaise,
      currency: FINANCE_CURRENCY,
      refundedOn: input.refundedOn,
      method: input.method,
      externalReference,
      internalNote,
      lifecycle: "recorded",
      idempotencyKey: mutationId,
      payloadFingerprint,
      recordRevision: 0,
      recordedByAccountId: coachId,
      recordedAt: now,
    }).run()
    allocations.forEach((allocation) => {
      tx.insert(refundAllocations).values({
        id: createId(),
        refundId,
        paymentAllocationId: allocation.paymentAllocationId,
        amountPaise: allocation.amountPaise,
        createdAt: now,
      }).run()
    })
    const paymentUpdate = tx.update(payments).set({
      recordRevision: sql`${payments.recordRevision} + 1`,
    }).where(and(
      eq(payments.id, payment.id),
      eq(payments.recordRevision, expectedPaymentRevision),
    )).run()
    const secondaryPaymentUpdates = [...new Set(selectedItems.map((selected) => (
      selected.payment.id
    )))].filter((selectedPaymentId) => selectedPaymentId !== payment.id)
      .map((selectedPaymentId) => tx.update(payments).set({
        recordRevision: sql`${payments.recordRevision} + 1`,
      }).where(and(
        eq(payments.id, selectedPaymentId),
        eq(payments.lifecycle, "recorded"),
      )).run())
    const chargeUpdate = tx.update(financialCharges).set({
      recordRevision: sql`${financialCharges.recordRevision} + 1`,
    }).where(and(
      eq(financialCharges.id, item.charge.id),
      eq(financialCharges.recordRevision, expectedChargeRevision),
    )).run()
    const agreementUpdate = tx.update(feeAgreements).set({
      effectiveTo: withdrawalEffectiveOn,
      status: "ended",
      recordRevision: sql`${feeAgreements.recordRevision} + 1`,
      updatedByAccountId: coachId,
      updatedAt: now,
    }).where(and(
      eq(feeAgreements.id, item.agreement.id),
      eq(feeAgreements.status, item.agreement.status),
      eq(feeAgreements.recordRevision, expectedAgreementRevision),
    )).run()
    if (paymentUpdate.changes !== 1
      || secondaryPaymentUpdates.some((update) => update.changes !== 1)
      || chargeUpdate.changes !== 1
      || agreementUpdate.changes !== 1) {
      financeError("BALANCE_CHANGED", "Fee details changed. Review the Refund.")
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: refundId,
      entityType: "refund",
      eventType: "refund_recorded",
      idempotencyKey: mutationId,
      metadata: {
        adjustmentId,
        agreementId: item.agreement.id,
        amountPaise,
        chargeId: item.charge.id,
        paymentId: payment.id,
        purpose: "mid_term_withdrawal",
        refundReference,
        withdrawalEffectiveOn,
      },
      now,
    })
    const record = loadPlayerFeeRecord(tx, payment.playerAccountId, now)
    const refund = record?.receipts.flatMap((receipt) => receipt.refunds)
      .find((item) => item.id === refundId)
    if (!refund) throw new Error("The recorded Refund is unavailable.")
    const updatedCharge = loadChargeView(tx, item.charge.id, now)
    const charges = updatedCharge ? [updatedCharge] : []
    return { refund, charges, reused: false }
  }, { behavior: "immediate" })
}

export function reverseRefund(
  input: ReverseRefundInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): RecordRefundResult {
  const mutationId = validateMutationId(input.mutationId)
  const expectedRefundRevision = validateRevision(
    input.expectedRefundRevision,
    "Review the Refund before reversing it.",
  )
  const reason = requireText(input.reason, "reason", "A reversal reason")
  const fingerprint = financialPayloadFingerprint({ ...input, reason })
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, mutationId)
    if (replay) {
      const metadata = parseAuditMetadata<{
        chargeIds?: string[]
        fingerprint?: string
        refundId?: string
      }>(replay.metadata)
      if (replay.eventType !== "refund_reversed" || metadata.fingerprint !== fingerprint
        || metadata.refundId !== input.refundId) {
        financeError("IDEMPOTENCY_CONFLICT", "This Refund reversal was already used differently.")
      }
      const row = tx.select().from(refunds).where(eq(refunds.id, input.refundId)).get()
      if (!row) throw new Error("The reversed Refund is unavailable.")
      const record = loadPlayerFeeRecord(tx, row.playerAccountId, now)
      const refund = record?.receipts.flatMap((receipt) => receipt.refunds)
        .find((item) => item.id === row.id)
      if (!refund) throw new Error("The reversed Refund is unavailable.")
      const replayChargeIds = metadata.chargeIds ?? []
      const chargeViews = loadChargeViews(tx, replayChargeIds, now)
      const charges = replayChargeIds
        .map((chargeId) => chargeViews.get(chargeId))
        .filter((charge): charge is ChargeView => Boolean(charge))
      return { refund, charges, reused: true }
    }
    const refundRow = tx.select().from(refunds).where(eq(refunds.id, input.refundId)).get()
    if (!refundRow) financeError("NOT_FOUND", "Refund not found.")
    requireActiveFinanceTarget(tx, refundRow.playerAccountId)
    if (refundRow.lifecycle === "reversed") financeError("CONFLICT", "Refund is already reversed.")
    if (refundRow.recordRevision !== expectedRefundRevision) {
      financeError("BALANCE_CHANGED", "Refund changed. Review it before reversing.")
    }
    const allocations = tx.select({
      allocation: refundAllocations,
      paymentAllocation: paymentAllocations,
    }).from(refundAllocations)
      .innerJoin(
        paymentAllocations,
        eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
      )
      .where(eq(refundAllocations.refundId, refundRow.id)).all()
    const withdrawalAdjustment = refundRow.purpose === "mid_term_withdrawal"
      && refundRow.chargeAdjustmentId
      ? tx.select().from(chargeAdjustments)
        .where(eq(chargeAdjustments.id, refundRow.chargeAdjustmentId)).get()
      : null
    const withdrawalAllocationTotal = allocations.reduce(
      (total, item) => total + item.allocation.amountPaise,
      0,
    )
    const withdrawalChargeIds = new Set(allocations.map(
      (item) => item.paymentAllocation.chargeId,
    ))
    if (refundRow.purpose === "mid_term_withdrawal"
      && (!withdrawalAdjustment
        || withdrawalAdjustment.kind !== "withdrawal_credit"
        || withdrawalAdjustment.amountPaise !== refundRow.amountPaise
        || allocations.length === 0
        || withdrawalAllocationTotal !== refundRow.amountPaise
        || !allocations.some((item) => (
          item.paymentAllocation.paymentId === refundRow.paymentId
        ))
        || withdrawalChargeIds.size !== 1
        || !withdrawalChargeIds.has(withdrawalAdjustment.chargeId)
        || withdrawalAdjustment.reversedAt !== null)) {
      throw new Error("The withdrawal Refund credit is inconsistent.")
    }
    const update = tx.update(refunds).set({
      lifecycle: "reversed",
      recordRevision: sql`${refunds.recordRevision} + 1`,
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: reason,
    }).where(and(
      eq(refunds.id, refundRow.id),
      eq(refunds.lifecycle, "recorded"),
      eq(refunds.recordRevision, expectedRefundRevision),
    )).run()
    if (update.changes !== 1) financeError("BALANCE_CHANGED", "Refund changed. Review it.")
    if (withdrawalAdjustment) {
      const adjustmentUpdate = tx.update(chargeAdjustments).set({
        reversedByAccountId: coachId,
        reversedAt: now,
        reversalReason: reason,
      }).where(and(
        eq(chargeAdjustments.id, withdrawalAdjustment.id),
        isNull(chargeAdjustments.reversedAt),
      )).run()
      if (adjustmentUpdate.changes !== 1) {
        financeError("BALANCE_CHANGED", "Withdrawal credit changed. Review the Refund.")
      }
    }
    const paymentIds = [...new Set(allocations.map(({ paymentAllocation }) => (
      paymentAllocation.paymentId
    )))]
    paymentIds.forEach((paymentId) => {
      tx.update(payments).set({
        recordRevision: sql`${payments.recordRevision} + 1`,
      }).where(eq(payments.id, paymentId)).run()
    })
    const chargeIds = [...new Set(allocations.map(({ paymentAllocation }) => (
      paymentAllocation.chargeId
    )))]
    chargeIds.forEach((chargeId) => {
      tx.update(financialCharges).set({
        recordRevision: sql`${financialCharges.recordRevision} + 1`,
      }).where(eq(financialCharges.id, chargeId)).run()
    })
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: refundRow.id,
      entityType: "refund",
      eventType: "refund_reversed",
      idempotencyKey: mutationId,
      metadata: {
        adjustmentId: withdrawalAdjustment?.id ?? null,
        chargeIds,
        fingerprint,
        refundId: refundRow.id,
      },
      now,
    })
    const record = loadPlayerFeeRecord(tx, refundRow.playerAccountId, now)
    const refund = record?.receipts.flatMap((receipt) => receipt.refunds)
      .find((item) => item.id === refundRow.id)
    if (!refund) throw new Error("The reversed Refund is unavailable.")
    const chargeViews = loadChargeViews(tx, chargeIds, now)
    const charges = chargeIds.map((chargeId) => chargeViews.get(chargeId))
      .filter((charge): charge is ChargeView => Boolean(charge))
    return { refund, charges, reused: false }
  }, { behavior: "immediate" })
}

export function createConcession(
  input: CreateConcessionInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ConcessionMutationResult {
  const validated = validateConcessionDefinition(input)
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = tx.select().from(concessions)
      .where(eq(concessions.idempotencyKey, validated.mutationId)).get()
    if (replay) {
      if (replay.payloadFingerprint !== validated.fingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This Concession request was already used differently.")
      }
      return { concession: toConcessionView(replay), reused: true }
    }
    requireUnusedMutationId(tx, validated.mutationId)
    requireActiveFinanceTarget(tx, input.playerId)
    if (input.mode === "recurring") {
      const overlap = tx.select({ id: concessions.id }).from(concessions).where(and(
        eq(concessions.playerAccountId, input.playerId),
        eq(concessions.mode, "recurring"),
        eq(concessions.lifecycle, "active"),
        validated.endsPeriod
          ? lte(concessions.startsPeriod, validated.endsPeriod)
          : undefined,
        or(
          isNull(concessions.endsPeriod),
          gte(concessions.endsPeriod, validated.startsPeriod as string),
        ),
      )).get()
      if (overlap) {
        financeError(
          "CONFLICT",
          "This player already has a recurring Concession for part of that period.",
          "period",
        )
      }
    }
    const concessionId = createId()
    tx.insert(concessions).values({
      id: concessionId,
      playerAccountId: input.playerId,
      mode: input.mode,
      valueKind: input.valueKind,
      value: validated.value,
      startsPeriod: validated.startsPeriod,
      endsPeriod: validated.endsPeriod,
      reason: validated.reason,
      lifecycle: "active",
      idempotencyKey: validated.mutationId,
      payloadFingerprint: validated.fingerprint,
      recordRevision: 0,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: concessionId,
      entityType: "concession",
      eventType: "concession_created",
      idempotencyKey: validated.mutationId,
      metadata: { fingerprint: validated.fingerprint, playerId: input.playerId },
      now,
    })
    const concession = tx.select().from(concessions)
      .where(eq(concessions.id, concessionId)).get()
    if (!concession) throw new Error("The Concession could not be read.")
    return { concession: toConcessionView(concession), reused: false }
  }, { behavior: "immediate" })
}

type ApplyConcessionCommand = {
  chargeId: string
  concessionId: string
  expectedChargeRevision: number
  expectedConcessionRevision: number
  fingerprint: string
  mutationId: string
  reusePriorApplication?: boolean
  skipIfSettled?: boolean
}

function applyConcessionInTransaction(
  database: SmbaDatabaseExecutor,
  input: ApplyConcessionCommand,
  {
    actorId,
    createId,
    now,
  }: { actorId: string; createId: () => string; now: Date },
): ConcessionApplicationResult | null {
  const replay = database.select().from(concessionApplications)
    .where(eq(concessionApplications.idempotencyKey, input.mutationId)).get()
  if (replay) {
    if (replay.payloadFingerprint !== input.fingerprint
      || replay.concessionId !== input.concessionId
      || replay.chargeId !== input.chargeId) {
      financeError("IDEMPOTENCY_CONFLICT", "This Concession application was already used differently.")
    }
    const concession = database.select().from(concessions)
      .where(eq(concessions.id, replay.concessionId)).get()
    const charge = loadChargeView(database, replay.chargeId, now)
    if (!concession || !charge) throw new Error("The Concession application is unavailable.")
    return {
      applicationId: replay.id,
      concession: toConcessionView(concession),
      charge,
      reused: true,
    }
  }
  requireUnusedMutationId(database, input.mutationId)

  const concession = database.select().from(concessions)
    .where(eq(concessions.id, input.concessionId)).get()
  if (!concession || concession.lifecycle !== "active") {
    financeError("NOT_FOUND", "Choose an active Concession.", "concessionId")
  }
  const chargeRow = readCharge(database, input.chargeId)
  if (!chargeRow || chargeRow.lifecycle !== "issued"
    || chargeRow.playerAccountId !== concession.playerAccountId) {
    financeError("NOT_FOUND", "Choose an active Charge belonging to this player.", "chargeId")
  }
  requireActiveFinanceTarget(database, concession.playerAccountId)
  if (concession.recordRevision !== input.expectedConcessionRevision
    || chargeRow.recordRevision !== input.expectedChargeRevision) {
    financeError("BALANCE_CHANGED", "Financial details changed. Review the Concession.")
  }
  if (concession.mode === "recurring") {
    const period = chargeRow.billingPeriod
    if (chargeRow.type !== "monthly_training" || !period
      || !concession.startsPeriod || period < concession.startsPeriod
      || (concession.endsPeriod !== null && period > concession.endsPeriod)) {
      financeError("INVALID_INPUT", "This Charge is outside the recurring Concession period.")
    }
    if (input.reusePriorApplication) {
      const priorApplication = database.select().from(concessionApplications).where(and(
        eq(concessionApplications.concessionId, concession.id),
        eq(concessionApplications.chargeId, chargeRow.id),
      )).orderBy(desc(concessionApplications.createdAt), desc(concessionApplications.id)).get()
      if (priorApplication) {
        const charge = loadChargeView(database, chargeRow.id, now)
        if (!charge) throw new Error("The Concession Charge is unavailable.")
        return {
          applicationId: priorApplication.id,
          concession: toConcessionView(concession),
          charge,
          reused: true,
        }
      }
    }
    const activeApplication = database.select().from(concessionApplications).where(and(
        eq(concessionApplications.concessionId, concession.id),
        eq(concessionApplications.chargeId, chargeRow.id),
        isNull(concessionApplications.reversedAt),
      )).get()
    if (activeApplication) {
      financeError("CONFLICT", "This Concession is already applied to the Charge.")
    }
  } else {
    const previous = database.select({ id: concessionApplications.id })
      .from(concessionApplications)
      .where(eq(concessionApplications.concessionId, concession.id)).get()
    if (previous) {
      financeError("CONFLICT", "This one-off Concession has already been applied.")
    }
  }
  const charge = loadChargeView(database, chargeRow.id, now)
  if (!charge) throw new Error("The Concession Charge is unavailable.")
  const amountPaise = calculateConcessionAmount({
    originalAmountPaise: charge.originalAmountPaise,
    outstandingPaise: charge.outstandingPaise,
    value: concession.value,
    valueKind: concession.valueKind,
  })
  if (amountPaise === 0) {
    if (input.skipIfSettled) return null
    financeError("ALREADY_SETTLED", "This Charge has no remaining balance for a Concession.")
  }

  const adjustmentId = createId()
  const applicationId = createId()
  database.insert(chargeAdjustments).values({
    id: adjustmentId,
    chargeId: charge.id,
    kind: "concession_credit",
    amountPaise,
    reason: concession.reason,
    createdByAccountId: actorId,
    createdAt: now,
  }).run()
  database.insert(concessionApplications).values({
    id: applicationId,
    concessionId: concession.id,
    chargeId: charge.id,
    chargeAdjustmentId: adjustmentId,
    amountPaise,
    appliedOn: getAcademyDateKey(now),
    idempotencyKey: input.mutationId,
    payloadFingerprint: input.fingerprint,
    createdByAccountId: actorId,
    createdAt: now,
  }).run()
  const concessionUpdate = database.update(concessions).set({
    recordRevision: sql`${concessions.recordRevision} + 1`,
  }).where(and(
    eq(concessions.id, concession.id),
    eq(concessions.lifecycle, "active"),
    eq(concessions.recordRevision, input.expectedConcessionRevision),
  )).run()
  const chargeUpdate = database.update(financialCharges).set({
    recordRevision: sql`${financialCharges.recordRevision} + 1`,
  }).where(and(
    eq(financialCharges.id, charge.id),
    eq(financialCharges.recordRevision, input.expectedChargeRevision),
  )).run()
  if (concessionUpdate.changes !== 1 || chargeUpdate.changes !== 1) {
    financeError("BALANCE_CHANGED", "Financial details changed. Review the Concession.")
  }
  insertAudit(database, {
    actorId,
    createId,
    entityId: applicationId,
    entityType: "concession_application",
    eventType: "concession_applied",
    idempotencyKey: input.mutationId,
    metadata: {
      amountPaise,
      chargeId: charge.id,
      concessionId: concession.id,
      fingerprint: input.fingerprint,
    },
    now,
  })
  const updatedConcession = database.select().from(concessions)
    .where(eq(concessions.id, concession.id)).get()
  const updatedCharge = loadChargeView(database, charge.id, now)
  if (!updatedConcession || !updatedCharge) {
    throw new Error("The applied Concession is unavailable.")
  }
  return {
    applicationId,
    concession: toConcessionView(updatedConcession),
    charge: updatedCharge,
    reused: false,
  }
}

export function applyConcession(
  input: ApplyConcessionInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ConcessionApplicationResult {
  const mutationId = validateMutationId(input.mutationId)
  const expectedChargeRevision = validateRevision(
    input.expectedChargeRevision,
    "Review the Charge before applying the Concession.",
  )
  const expectedConcessionRevision = validateRevision(
    input.expectedConcessionRevision,
    "Review the Concession before applying it.",
  )
  const fingerprint = financialPayloadFingerprint(input)
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const result = applyConcessionInTransaction(tx, {
      ...input,
      expectedChargeRevision,
      expectedConcessionRevision,
      fingerprint,
      mutationId,
    }, { actorId: coachId, createId, now })
    if (!result) throw new Error("The Concession could not be applied.")
    return result
  }, { behavior: "immediate" })
}

export function reverseConcessionApplication(
  input: ReverseConcessionApplicationInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ConcessionApplicationResult {
  const mutationId = validateMutationId(input.mutationId)
  const reason = requireText(input.reason, "reason", "A reversal reason")
  const fingerprint = financialPayloadFingerprint({ ...input, reason })
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, mutationId)
    if (replay) {
      const metadata = parseAuditMetadata<{
        applicationId?: string
        fingerprint?: string
      }>(replay.metadata)
      if (replay.eventType !== "concession_application_reversed"
        || metadata.applicationId !== input.applicationId
        || metadata.fingerprint !== fingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This reversal request was already used differently.")
      }
      const application = tx.select().from(concessionApplications)
        .where(eq(concessionApplications.id, input.applicationId)).get()
      const concession = application
        ? tx.select().from(concessions).where(eq(concessions.id, application.concessionId)).get()
        : null
      const charge = application ? loadChargeView(tx, application.chargeId, now) : null
      if (!application || !concession || !charge) {
        throw new Error("The reversed Concession application is unavailable.")
      }
      return {
        applicationId: application.id,
        concession: toConcessionView(concession),
        charge,
        reused: true,
      }
    }
    const application = tx.select().from(concessionApplications)
      .where(eq(concessionApplications.id, input.applicationId)).get()
    if (!application) financeError("NOT_FOUND", "Concession application not found.")
    const targetConcession = tx.select({ playerId: concessions.playerAccountId })
      .from(concessions)
      .where(eq(concessions.id, application.concessionId))
      .get()
    if (!targetConcession) throw new Error("The Concession is unavailable.")
    requireActiveFinanceTarget(tx, targetConcession.playerId)
    if (application.reversedAt) financeError("CONFLICT", "Concession application is already reversed.")
    const applicationUpdate = tx.update(concessionApplications).set({
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: reason,
    }).where(and(
      eq(concessionApplications.id, application.id),
      isNull(concessionApplications.reversedAt),
    )).run()
    const adjustmentUpdate = tx.update(chargeAdjustments).set({
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: reason,
    }).where(and(
      eq(chargeAdjustments.id, application.chargeAdjustmentId),
      isNull(chargeAdjustments.reversedAt),
    )).run()
    if (applicationUpdate.changes !== 1 || adjustmentUpdate.changes !== 1) {
      financeError("BALANCE_CHANGED", "Concession application changed. Review it.")
    }
    tx.update(financialCharges).set({
      recordRevision: sql`${financialCharges.recordRevision} + 1`,
    }).where(eq(financialCharges.id, application.chargeId)).run()
    tx.update(concessions).set({
      recordRevision: sql`${concessions.recordRevision} + 1`,
    }).where(eq(concessions.id, application.concessionId)).run()
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: application.id,
      entityType: "concession_application",
      eventType: "concession_application_reversed",
      idempotencyKey: mutationId,
      metadata: { applicationId: application.id, fingerprint },
      now,
    })
    const concession = tx.select().from(concessions)
      .where(eq(concessions.id, application.concessionId)).get()
    const charge = loadChargeView(tx, application.chargeId, now)
    if (!concession || !charge) throw new Error("The reversed Concession is unavailable.")
    return {
      applicationId: application.id,
      concession: toConcessionView(concession),
      charge,
      reused: false,
    }
  }, { behavior: "immediate" })
}

export function reverseConcession(
  input: ReverseConcessionInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ConcessionMutationResult {
  const mutationId = validateMutationId(input.mutationId)
  const expectedConcessionRevision = validateRevision(
    input.expectedConcessionRevision,
    "Review the Concession before reversing it.",
  )
  const reason = requireText(input.reason, "reason", "A reversal reason")
  const fingerprint = financialPayloadFingerprint({ ...input, reason })
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, mutationId)
    if (replay) {
      const metadata = parseAuditMetadata<{
        concessionId?: string
        fingerprint?: string
      }>(replay.metadata)
      if (replay.eventType !== "concession_reversed"
        || metadata.concessionId !== input.concessionId
        || metadata.fingerprint !== fingerprint) {
        financeError("IDEMPOTENCY_CONFLICT", "This reversal request was already used differently.")
      }
      const concession = tx.select().from(concessions)
        .where(eq(concessions.id, input.concessionId)).get()
      if (!concession) throw new Error("The reversed Concession is unavailable.")
      return { concession: toConcessionView(concession), reused: true }
    }
    const concession = tx.select().from(concessions)
      .where(eq(concessions.id, input.concessionId)).get()
    if (!concession) financeError("NOT_FOUND", "Concession not found.", "concessionId")
    requireActiveFinanceTarget(tx, concession.playerAccountId)
    if (concession.lifecycle === "reversed") financeError("CONFLICT", "Concession is already reversed.")
    if (concession.recordRevision !== expectedConcessionRevision) {
      financeError("BALANCE_CHANGED", "Concession changed. Review it before reversing.")
    }
    const update = tx.update(concessions).set({
      lifecycle: "reversed",
      recordRevision: sql`${concessions.recordRevision} + 1`,
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: reason,
    }).where(and(
      eq(concessions.id, concession.id),
      eq(concessions.lifecycle, "active"),
      eq(concessions.recordRevision, expectedConcessionRevision),
    )).run()
    if (update.changes !== 1) financeError("BALANCE_CHANGED", "Concession changed. Review it.")
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: concession.id,
      entityType: "concession",
      eventType: "concession_reversed",
      idempotencyKey: mutationId,
      metadata: { concessionId: concession.id, fingerprint },
      now,
    })
    const updated = tx.select().from(concessions)
      .where(eq(concessions.id, concession.id)).get()
    if (!updated) throw new Error("The reversed Concession is unavailable.")
    return { concession: toConcessionView(updated), reused: false }
  }, { behavior: "immediate" })
}

/**
 * `recurringByPlayer`, when supplied, replaces this function's own lookup with
 * an entry from a caller that already read every player's recurring concession
 * in one statement. It must be built with the same ordering used below --
 * earliest `createdAt`, then `id` -- because that is which concession applies
 * when a player has more than one covering the period. Omitting it keeps the
 * per-charge read, which is what a single-charge caller wants.
 */
function applyRecurringConcessionForCharge(
  database: SmbaDatabaseExecutor,
  charge: typeof financialCharges.$inferSelect,
  period: string,
  { actorId, createId, now }: { actorId: string; createId: () => string; now: Date },
  recurringByPlayer?: Map<string, typeof concessions.$inferSelect>,
) {
  const concession = recurringByPlayer
    ? recurringByPlayer.get(charge.playerAccountId) ?? null
    : database.select().from(concessions).where(and(
      eq(concessions.playerAccountId, charge.playerAccountId),
      eq(concessions.mode, "recurring"),
      eq(concessions.lifecycle, "active"),
      lte(concessions.startsPeriod, period),
      or(isNull(concessions.endsPeriod), gte(concessions.endsPeriod, period)),
    )).orderBy(asc(concessions.createdAt), asc(concessions.id)).get() ?? null
  if (!concession) return null
  const mutationId = `recurring:${concession.id}:${charge.id}`
  const fingerprint = financialPayloadFingerprint({
    chargeId: charge.id,
    concessionId: concession.id,
    operation: "recurring-concession-application",
  })
  return applyConcessionInTransaction(database, {
    chargeId: charge.id,
    concessionId: concession.id,
    expectedChargeRevision: charge.recordRevision,
    expectedConcessionRevision: concession.recordRevision,
    fingerprint,
    mutationId,
    reusePriorApplication: true,
    skipIfSettled: true,
  }, { actorId, createId, now })
}

export function applyChargeAdjustment(
  input: ApplyAdjustmentInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ChargeView {
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const amountPaise = validateMoney(input.amountPaise)
  const reason = requireText(input.reason, "reason", "An adjustment reason")
  if (!["manual_credit", "manual_debit"].includes(input.kind)) {
    financeError("INVALID_INPUT", "Choose a valid adjustment type.")
  }
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      if (replay.eventType !== "adjustment_created") {
        financeError("IDEMPOTENCY_CONFLICT", "This adjustment request was already used.")
      }
      const metadata = parseAuditMetadata<{
        amountPaise: number; chargeId: string; kind: string; reason: string
      }>(replay.metadata)
      if (metadata.chargeId !== input.chargeId || metadata.amountPaise !== amountPaise
        || metadata.kind !== input.kind || metadata.reason !== reason) {
        financeError("IDEMPOTENCY_CONFLICT", "This adjustment request was already used differently.")
      }
      const charge = loadChargeView(tx, metadata.chargeId, now)
      if (!charge) throw new Error("The adjusted Charge is unavailable.")
      return charge
    }
    const chargeRow = readCharge(tx, input.chargeId)
    if (!chargeRow || chargeRow.lifecycle !== "issued") {
      financeError("NOT_FOUND", "Choose an active Charge.")
    }
    requireActiveFinanceTarget(tx, chargeRow.playerAccountId)
    const charge = loadChargeView(tx, chargeRow.id, now)
    if (!charge) throw new Error("The Charge ledger is unavailable.")
    if (input.kind !== "manual_debit" && amountPaise > charge.outstandingPaise) {
      financeError("INVALID_INPUT", "Credit cannot exceed the outstanding balance.", "amountPaise")
    }
    const adjustmentId = createId()
    tx.insert(chargeAdjustments).values({
      id: adjustmentId,
      chargeId: charge.id,
      kind: input.kind,
      amountPaise,
      reason,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    tx.update(financialCharges).set({
      recordRevision: sql`${financialCharges.recordRevision} + 1`,
    }).where(eq(financialCharges.id, charge.id)).run()
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: adjustmentId,
      entityType: "adjustment",
      eventType: "adjustment_created",
      idempotencyKey,
      metadata: { amountPaise, chargeId: charge.id, kind: input.kind, reason },
      now,
    })
    const updated = loadChargeView(tx, charge.id, now)
    if (!updated) throw new Error("The adjusted Charge is unavailable.")
    return updated
  }, { behavior: "immediate" })
}

export function reverseChargeAdjustment(
  input: ReverseAdjustmentInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ChargeView {
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const reason = requireText(input.reason, "reason", "A reversal reason")
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const adjustment = tx.select().from(chargeAdjustments)
      .where(eq(chargeAdjustments.id, input.adjustmentId)).get()
    if (!adjustment) financeError("NOT_FOUND", "Adjustment not found.", "adjustmentId")
    if (adjustment.kind === "concession_credit") {
      financeError(
        "CONFLICT",
        "Reverse this credit through its Concession application so the ledger remains consistent.",
        "adjustmentId",
      )
    }
    if (adjustment.kind === "withdrawal_credit") {
      financeError(
        "CONFLICT",
        "Reverse this credit through its linked Refund so the ledger remains consistent.",
        "adjustmentId",
      )
    }
    if (adjustment.kind === "legacy_settlement") {
      financeError(
        "CONFLICT",
        "Historical credit adjustments are read-only.",
        "adjustmentId",
      )
    }
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      if (replay.eventType !== "adjustment_reversed" || replay.entityId !== input.adjustmentId) {
        financeError("IDEMPOTENCY_CONFLICT", "This adjustment reversal was already used.")
      }
      const metadata = parseAuditMetadata<{ chargeId: string; reason: string }>(replay.metadata)
      if (metadata.reason !== reason) {
        financeError("IDEMPOTENCY_CONFLICT", "This adjustment reversal was already used differently.")
      }
      const charge = loadChargeView(tx, metadata.chargeId, now)
      if (!charge) throw new Error("The adjusted Charge is unavailable.")
      return charge
    }
    const targetCharge = readCharge(tx, adjustment.chargeId)
    if (!targetCharge) throw new Error("The adjusted Charge is unavailable.")
    requireActiveFinanceTarget(tx, targetCharge.playerAccountId)
    if (adjustment.reversedAt) financeError("CONFLICT", "Adjustment is already reversed.")
    if (adjustment.kind === "manual_debit") {
      const charge = loadChargeView(tx, adjustment.chargeId, now)
      if (!charge) throw new Error("The adjusted Charge is unavailable.")
      const effectiveAfterReversal = Math.max(
        0,
        charge.effectiveAmountPaise - adjustment.amountPaise,
      )
      if (charge.receivedPaise > effectiveAfterReversal) {
        financeError(
          "CONFLICT",
          "Reverse or correct recorded Payments before removing this debit Adjustment.",
        )
      }
    }
    tx.update(chargeAdjustments).set({
      reversedByAccountId: coachId,
      reversedAt: now,
      reversalReason: reason,
    }).where(and(
      eq(chargeAdjustments.id, adjustment.id),
      isNull(chargeAdjustments.reversedAt),
    )).run()
    tx.update(financialCharges).set({
      recordRevision: sql`${financialCharges.recordRevision} + 1`,
    }).where(eq(financialCharges.id, adjustment.chargeId)).run()
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: adjustment.id,
      entityType: "adjustment",
      eventType: "adjustment_reversed",
      idempotencyKey,
      metadata: { chargeId: adjustment.chargeId, reason },
      now,
    })
    const charge = loadChargeView(tx, adjustment.chargeId, now)
    if (!charge) throw new Error("The adjusted Charge is unavailable.")
    return charge
  }, { behavior: "immediate" })
}

export function voidCharge(
  input: VoidChargeInput,
  {
    coachId,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ChargeView {
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const reason = requireText(input.reason, "reason", "A void reason")
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      if (replay.eventType !== "charge_voided" || replay.entityId !== input.chargeId) {
        financeError("IDEMPOTENCY_CONFLICT", "This void request was already used.")
      }
      const metadata = parseAuditMetadata<{ reason: string }>(replay.metadata)
      if (metadata.reason !== reason) {
        financeError("IDEMPOTENCY_CONFLICT", "This void request was already used differently.")
      }
      const charge = loadChargeView(tx, input.chargeId, now)
      if (!charge) throw new Error("The void Charge is unavailable.")
      return charge
    }
    const chargeRow = readCharge(tx, input.chargeId)
    if (!chargeRow) financeError("NOT_FOUND", "Charge not found.", "chargeId")
    requireActiveFinanceTarget(tx, chargeRow.playerAccountId)
    const charge = loadChargeView(tx, chargeRow.id, now)
    if (!charge) throw new Error("The Charge ledger is unavailable.")
    if (charge.lifecycle === "void") financeError("CONFLICT", "Charge is already void.")
    if (!Number.isInteger(input.expectedChargeRevision)
      || input.expectedChargeRevision !== charge.recordRevision) {
      financeError("BALANCE_CHANGED", "Balance changed. Review the Charge before voiding it.")
    }
    if (!charge.canVoid) {
      financeError("CONFLICT", "Reverse recorded Payments before voiding this Charge.")
    }
    const update = tx.update(financialCharges).set({
      lifecycle: "void",
      recordRevision: sql`${financialCharges.recordRevision} + 1`,
      voidedByAccountId: coachId,
      voidedAt: now,
      voidReason: reason,
    }).where(and(
      eq(financialCharges.id, charge.id),
      eq(financialCharges.lifecycle, "issued"),
      eq(financialCharges.recordRevision, input.expectedChargeRevision),
    )).run()
    if (update.changes !== 1) {
      financeError("BALANCE_CHANGED", "Balance changed. Review the Charge before voiding it.")
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: charge.id,
      entityType: "charge",
      eventType: "charge_voided",
      idempotencyKey,
      metadata: { reason },
      now,
    })
    const updated = loadChargeView(tx, charge.id, now)
    if (!updated) throw new Error("The void Charge is unavailable.")
    return updated
  }, { behavior: "immediate" })
}

export function getFinanceActivation(
  { database = initializeDatabase() }: Pick<QueryContext, "database"> = {},
) {
  return readFinanceActivation(database)
}

export function readPlayerFinancialCloseoutState(
  database: SmbaDatabaseExecutor,
  playerId: string,
  now = new Date(),
): PlayerFinancialCloseoutState {
  // The fee record projects every issued Charge through the canonical ledger
  // calculation, including future billing periods and all later corrections.
  const outstandingPaise = loadPlayerFeeRecord(database, playerId, now)?.currentBalancePaise ?? 0
  return {
    hasOpenFeePlan: Boolean(readActiveFeeAgreement(database, playerId)),
    hasOutstandingBalance: outstandingPaise > 0,
    outstandingPaise,
  }
}

export function resolveExistingRegistrationFee(
  input: ResolveExistingRegistrationFeeInput,
  {
    coachId,
    createFeeReference = createOpaqueFeeReference,
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): ChargeView {
  if (!input || typeof input !== "object"
    || input.status !== "pending") {
    financeError("INVALID_INPUT", "Choose a valid registration-fee status.")
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  return database.transaction((tx) => {
    requireCoach(tx, coachId)
    requireFinanceActive(tx)
    const replay = readAuditEventByIdempotencyKey(tx, idempotencyKey)
    if (replay) {
      const metadata = parseAuditMetadata<{
        chargeId?: string
        playerId?: string
        registrationStatus?: string
      }>(replay.metadata)
      if (replay.eventType !== "historical_reconciled"
        || replay.entityType !== "player"
        || metadata.playerId !== input.playerId
        || metadata.registrationStatus !== input.status
        || !metadata.chargeId) {
        financeError("IDEMPOTENCY_CONFLICT", "This registration reconciliation was already used.")
      }
      const charge = loadChargeView(tx, metadata.chargeId, now, true)
      if (!charge) throw new Error("The reconciled registration Charge is unavailable.")
      return charge
    }
    requireActiveFinanceTarget(tx, input.playerId)
    const issued = tx.select().from(financialCharges).where(and(
      eq(financialCharges.playerAccountId, input.playerId),
      eq(financialCharges.type, "registration"),
      eq(financialCharges.lifecycle, "issued"),
    )).get()
    let charge = issued
    if (!charge) {
      const approvedAt = tx.select({ approvedAt: accounts.approvedAt }).from(accounts)
        .where(eq(accounts.id, input.playerId)).get()?.approvedAt
      if (!approvedAt) throw new Error("The player approval date is unavailable.")
      charge = issueCharge(tx, {
        actorId: coachId,
        amountPaise: REGISTRATION_FEE_PAISE,
        createFeeReference,
        createId,
        description: "SMBA registration fee",
        dueDate: getAcademyDateKey(approvedAt),
        now,
        playerId: input.playerId,
        type: "registration",
      }).charge
    }
    const current = loadChargeView(tx, charge.id, now, true)
    if (!current) throw new Error("The registration Charge is unavailable.")
    if (input.status === "pending"
      && !["pending", "overdue"].includes(current.status)) {
      financeError("CONFLICT", "The registration Charge has already been financially resolved.")
    }
    insertAudit(tx, {
      actorId: coachId,
      createId,
      entityId: input.playerId,
      entityType: "player",
      eventType: "historical_reconciled",
      idempotencyKey,
      metadata: {
        chargeId: charge.id,
        playerId: input.playerId,
        registrationStatus: input.status,
      },
      now,
    })
    return current
  }, { behavior: "immediate" })
}

export const reconcileRegistrationStatus = resolveExistingRegistrationFee

export function getPlayerFeeRecord(
  playerId: string,
  { database = initializeDatabase(), now = new Date() }: QueryContext = {},
): PlayerFeeRecord | null {
  return loadPlayerFeeRecord(database, playerId, now)
}

export async function getPlayerFinanceDashboardSummary(
  playerId: string,
  context: QueryContext = {},
): Promise<PlayerFinanceDashboardSummary> {
  const record = getPlayerFeeRecord(playerId, context)
  if (!record) return { status: "setup_required", currentBalancePaise: 0, nextDueDate: null }
  const outstanding = [record.registrationCharge, ...record.monthlyCharges]
    .filter((charge): charge is ChargeView => charge !== null && charge.outstandingPaise > 0)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
  return {
    status: record.status,
    currentBalancePaise: record.currentBalancePaise,
    nextDueDate: outstanding[0]?.dueDate ?? null,
  }
}

export function getCoachFinancePlayerRecord(
  playerId: string,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): PlayerFeeRecord | null {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if (typeof playerId !== "string" || !playerId.trim()) {
    financeError("INVALID_INPUT", "Choose a player.", "playerId")
  }
  return loadPlayerFeeRecord(database, playerId, now, true)
}

export function getCoachMonthlyPreparationPreview(
  period: string,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): MonthlyPreparationPreview {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if (!isValidMonthKey(period)) {
    financeError("INVALID_INPUT", "Choose a valid fee month.", "period")
  }
  return monthlyPreparationPreview(database, period, now)
}

export function getCoachFinanceRapidDesk(
  input: {
    period: string
    scope?: FinanceRapidScope
    query?: string
    playerId?: string
  },
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): CoachFinanceRapidDesk {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if (!isValidMonthKey(input.period)) {
    financeError("INVALID_INPUT", "Choose a valid fee month.", "period")
  }
  const scope = input.scope ?? "outstanding"
  if (!(["outstanding", "all"] satisfies FinanceRapidScope[]).includes(scope)) {
    financeError("INVALID_INPUT", "Choose a valid payment scope.")
  }
  const lookupPlayers = listFinancePlayers(database, {
    now,
    period: input.period,
    query: input.query,
  }).filter((player) => !player.archived)
  const players = lookupPlayers
    .filter((player) => scope === "all" || player.paymentEligible)
    .sort((left, right) => (
      (scope === "outstanding"
        ? (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
        : 0)
      || left.fullName.localeCompare(right.fullName, "en-IN")
      || left.academyId.localeCompare(right.academyId)
    ))
  const loadedSelectedLedger = input.playerId
    ? loadPlayerFeeRecord(database, input.playerId, now, true)
    : null
  const selectedSummary = loadedSelectedLedger && !loadedSelectedLedger.archived
    ? listFinancePlayers(database, {
      now,
      period: input.period,
      query: loadedSelectedLedger.academyId,
    }).find((player) => player.playerId === loadedSelectedLedger.playerId) ?? null
    : null
  const selectedLedger = loadedSelectedLedger && selectedSummary?.paymentEligible
    ? {
      ...loadedSelectedLedger,
      status: selectedSummary.status,
      currentBalancePaise: selectedSummary.outstandingPaise,
      monthlyCharges: loadedSelectedLedger.monthlyCharges.filter((charge) => (
        charge.billingPeriod !== null && charge.billingPeriod <= input.period
      )),
    }
    : null

  return {
    period: input.period,
    scope,
    players,
    selectedLedger,
  }
}

export function getCoachFinanceWorkspace(
  input: {
    period: string
    view?: "attention" | "paid" | "all"
    query?: string
    playerId?: string
  },
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): CoachFinanceWorkspace {
  requireCoach(database, coachId)
  if (!isValidMonthKey(input.period)) {
    financeError("INVALID_INPUT", "Choose a valid fee month.", "period")
  }
  const view = input.view ?? "attention"
  if (!["attention", "paid", "all"].includes(view)) {
    financeError("INVALID_INPUT", "Choose a valid financial view.")
  }
  const allPlayers = listFinancePlayers(database, {
    now,
    period: input.period,
    query: input.query,
  })
  const players = allPlayers.filter((player) => {
    if (view === "all") return true
    if (view === "paid") return player.status === "paid"
    return ["overdue", "not_prepared", "partially_paid", "pending", "setup_required"]
      .includes(player.status)
  }).sort((left, right) => {
    const weight = {
      overdue: 0,
      not_prepared: 1,
      partially_paid: 2,
      pending: 3,
      setup_required: 4,
    } as const
    const leftWeight = left.status in weight ? weight[left.status as keyof typeof weight] : 5
    const rightWeight = right.status in weight ? weight[right.status as keyof typeof weight] : 5
    return leftWeight - rightWeight
      || (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999")
      || left.fullName.localeCompare(right.fullName)
  })
  const activation = readFinanceActivation(database)
  return {
    activation,
    period: input.period,
    summary: {
      receivedPaise: readPeriodReceivedPaise(database, input.period),
      outstandingPaise: allPlayers.reduce((total, player) => total + player.outstandingPaise, 0),
      attentionCount: allPlayers.filter((player) => [
        "overdue", "not_prepared", "partially_paid", "pending", "setup_required",
      ].includes(player.status)).length,
      paidCount: allPlayers.filter((player) => player.status === "paid").length,
    },
    players,
    selectedLedger: input.playerId
      ? loadPlayerFeeRecord(database, input.playerId, now, true)
      : null,
    preparation: monthlyPreparationPreview(database, input.period, now),
  }
}

export function getCoachFinanceDashboardSummary(
  period: string,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): CoachFinanceDashboardSummary {
  requireCoach(database, coachId)
  if (!isValidMonthKey(period)) {
    financeError("INVALID_INPUT", "Choose a valid fee month.", "period")
  }
  const players = listFinancePlayers(database, { now, period })
  const candidates = monthlyPreparationCandidates(database, period, now)
  const preparedIds = new Set(listPreparedPlayerIds(database, period))
  const activation = readFinanceActivation(database)
  const beforeCutover = !activation || period < activation.trackingMonth
  return {
    attentionCount: players.filter((player) => [
      "overdue", "not_prepared", "partially_paid", "pending", "setup_required",
    ].includes(player.status)).length,
    outstandingPaise: players.reduce((total, player) => total + player.outstandingPaise, 0),
    preparation: {
      ready: beforeCutover ? 0 : candidates.filter(({ agreement, hasAssignment }) => (
        hasAssignment && !preparedIds.has(agreement.playerAccountId)
      )).length,
      alreadyPrepared: beforeCutover ? 0 : candidates.filter(({ agreement }) => (
        preparedIds.has(agreement.playerAccountId)
      )).length,
    },
  }
}

/**
 * Returns the coach-facing receipt/refund register without exposing ledger IDs,
 * private notes, contact data, or audit metadata.
 */
export function listFinanceCollectionEvents(
  input: { from: string; to: string },
  {
    coachId,
    database = initializeDatabase(),
  }: CoachContext,
): FinanceCollectionEvent[] {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if (!isValidDateKey(input.from) || !isValidDateKey(input.to) || input.from > input.to) {
    financeError("INVALID_INPUT", "Choose a valid collection date range.", "period")
  }
  const from = Date.parse(`${input.from}T00:00:00.000Z`)
  const to = Date.parse(`${input.to}T00:00:00.000Z`)
  if ((to - from) / 86_400_000 + 1 > 366) {
    financeError("INVALID_INPUT", "Collection history is limited to 366 days.", "period")
  }

  const paymentRows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    amountPaise: payments.amountPaise,
    eventDate: payments.receivedOn,
    fullName: accounts.fullName,
    method: payments.method,
    paymentId: payments.id,
    reference: payments.receiptReference,
  }).from(payments)
    .innerJoin(accounts, eq(accounts.id, payments.playerAccountId))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(payments.lifecycle, "recorded"),
      gte(payments.receivedOn, input.from),
      lte(payments.receivedOn, input.to),
    )).all()

  const refundRows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    amountPaise: refunds.amountPaise,
    eventDate: refunds.refundedOn,
    fullName: accounts.fullName,
    method: refunds.method,
    paymentId: refunds.paymentId,
    reference: refunds.refundReference,
    refundId: refunds.id,
  }).from(refunds)
    .innerJoin(accounts, eq(accounts.id, refunds.playerAccountId))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(refunds.lifecycle, "recorded"),
      gte(refunds.refundedOn, input.from),
      lte(refunds.refundedOn, input.to),
    )).all()

  // Both reads cover every event in the range at once. The charge ID breaks ties
  // in the shared sort, so grouping by parent keeps each list in the order a
  // single-parent read produced.
  const groupReferences = <Row extends { feeReference: string }>(
    rows: Row[],
    parentOf: (row: Row) => string,
  ) => {
    const grouped = new Map<string, string[]>()
    rows.forEach((row) => {
      const references = grouped.get(parentOf(row)) ?? []
      if (!references.includes(row.feeReference)) references.push(row.feeReference)
      grouped.set(parentOf(row), references)
    })
    return grouped
  }
  const paymentIds = [...new Set(paymentRows.map((row) => row.paymentId))]
  const refundIds = [...new Set(refundRows.map((row) => row.refundId))]

  const feeReferencesByPayment = groupReferences(paymentIds.length
    ? database.select({
      feeReference: financialCharges.feeReference,
      paymentId: paymentAllocations.paymentId,
    }).from(paymentAllocations)
      .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
      .where(inArray(paymentAllocations.paymentId, paymentIds))
      .orderBy(asc(financialCharges.dueDate), asc(financialCharges.id))
      .all()
    : [], (row) => row.paymentId)
  const feeReferencesByRefund = groupReferences(refundIds.length
    ? database.select({
      feeReference: financialCharges.feeReference,
      refundId: refundAllocations.refundId,
    }).from(refundAllocations)
      .innerJoin(
        paymentAllocations,
        eq(paymentAllocations.id, refundAllocations.paymentAllocationId),
      )
      .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
      .where(inArray(refundAllocations.refundId, refundIds))
      .orderBy(asc(financialCharges.dueDate), asc(financialCharges.id))
      .all()
    : [], (row) => row.refundId)

  return [
    ...paymentRows.map((row): FinanceCollectionEvent => ({
      eventDate: row.eventDate,
      eventType: "payment",
      reference: row.reference,
      playerFullName: row.fullName,
      academyId: formatAcademyId(row.academyIdSerial),
      method: row.method as PaymentMethod,
      amountPaise: row.amountPaise,
      coveredFeeReferences: feeReferencesByPayment.get(row.paymentId) ?? [],
    })),
    ...refundRows.map((row): FinanceCollectionEvent => ({
      eventDate: row.eventDate,
      eventType: "refund",
      reference: row.reference,
      playerFullName: row.fullName,
      academyId: formatAcademyId(row.academyIdSerial),
      method: row.method as PaymentMethod,
      amountPaise: row.amountPaise,
      coveredFeeReferences: feeReferencesByRefund.get(row.refundId) ?? [],
    })),
  ].sort((left, right) => (
    right.eventDate.localeCompare(left.eventDate)
    || right.reference.localeCompare(left.reference)
  ))
}

function validateRecordsLimit(value: unknown, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    financeError("INVALID_INPUT", "Choose a record-page size from 1 to 100.")
  }
  return value as number
}

function validateRecordsQuery(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim().length > 120) {
    financeError("INVALID_INPUT", "Financial-record search cannot exceed 120 characters.")
  }
  return value.trim() || undefined
}

function validateRecordsCursor(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    financeError("INVALID_INPUT", "The financial-records cursor is invalid.")
  }
  return value
}

function recordsQuery<T>(load: () => T) {
  try {
    return load()
  } catch (error) {
    if (error instanceof FinanceRecordsCursorError) {
      financeError("INVALID_INPUT", "The financial-records cursor is invalid.")
    }
    throw error
  }
}

export function getFeeRegister(
  input: FinanceRegisterInput,
  {
    coachId,
    database = initializeDatabase(),
    now = new Date(),
  }: CoachContext,
): FinanceRegisterResult {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if (!input || !["monthly", "registration"].includes(input.mode)) {
    financeError("INVALID_INPUT", "Choose a valid fee-register mode.")
  }
  if (input.mode === "monthly" && (!input.period || !isValidMonthKey(input.period))) {
    financeError("INVALID_INPUT", "Choose a valid fee month.", "period")
  }
  if (input.playerScope && !["active", "archived", "all"].includes(input.playerScope)) {
    financeError("INVALID_INPUT", "Choose a valid player filter.")
  }
  if (input.statuses && (!Array.isArray(input.statuses)
    || input.statuses.some((status) => !FINANCE_STATUSES.includes(status)))) {
    financeError("INVALID_INPUT", "Choose valid financial statuses.")
  }
  return recordsQuery(() => loadFeeRegister(database, {
    ...input,
    query: validateRecordsQuery(input.query),
    cursor: validateRecordsCursor(input.cursor),
    limit: validateRecordsLimit(input.limit, 25),
  }, now))
}

export function getCollectionsDayBook(
  input: FinanceDayBookInput,
  {
    coachId,
    database = initializeDatabase(),
  }: CoachContext,
): FinanceDayBookResult {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if (!input || !isValidDateKey(input.from) || !isValidDateKey(input.to)
    || input.from > input.to) {
    financeError("INVALID_INPUT", "Choose a valid collection date range.", "period")
  }
  const from = Date.parse(`${input.from}T00:00:00.000Z`)
  const to = Date.parse(`${input.to}T00:00:00.000Z`)
  if ((to - from) / 86_400_000 + 1 > 366) {
    financeError("INVALID_INPUT", "Collection history is limited to 366 days.", "period")
  }
  if (input.methods && (!Array.isArray(input.methods)
    || input.methods.some((method) => !PAYMENT_METHODS.includes(method)))) {
    financeError("INVALID_INPUT", "Choose valid payment methods.", "method")
  }
  return recordsQuery(() => loadCollectionsDayBook(database, {
    ...input,
    query: validateRecordsQuery(input.query),
    cursor: validateRecordsCursor(input.cursor),
    limit: validateRecordsLimit(input.limit, 50),
  }))
}

export function getFinancialActivity(
  input: FinanceActivityInput = {},
  {
    coachId,
    database = initializeDatabase(),
  }: CoachContext,
): FinanceActivityResult {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  if ((input.from && !isValidDateKey(input.from)) || (input.to && !isValidDateKey(input.to))
    || (input.from && input.to && input.from > input.to)) {
    financeError("INVALID_INPUT", "Choose a valid activity date range.", "period")
  }
  if (input.eventTypes && (!Array.isArray(input.eventTypes)
    || !input.eventTypes.every(isFinanceAuditEventType))) {
    financeError("INVALID_INPUT", "Choose valid financial activity types.")
  }
  if (input.coachId !== undefined
    && (typeof input.coachId !== "string" || input.coachId.trim().length === 0)) {
    financeError("INVALID_INPUT", "Choose a valid coach.")
  }
  return recordsQuery(() => loadFinancialActivity(database, {
    ...input,
    query: validateRecordsQuery(input.query),
    cursor: validateRecordsCursor(input.cursor),
    limit: validateRecordsLimit(input.limit, 50),
  }))
}

export function listFinanceActivityCoaches(
  {
    coachId,
    database = initializeDatabase(),
  }: CoachContext,
): FinanceActivityCoachOption[] {
  requireCoach(database, coachId)
  requireFinanceActive(database)
  return loadFinanceActivityCoaches(database)
}
