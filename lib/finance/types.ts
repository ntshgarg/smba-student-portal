import type { AcademyPlan } from "@/lib/training/academy-plans"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

export const FINANCE_CURRENCY = "INR" as const

export type FinanceCurrency = typeof FINANCE_CURRENCY
export type ChargeType = "registration" | "monthly_training"
export type ChargeLifecycle = "issued" | "void"
export type PaymentLifecycle = "recorded" | "reversed"
export type RefundPurpose = "legacy_unclassified" | "mid_term_withdrawal"
export type PaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "card"
  | "cheque"
  | "other"
export type AdjustmentKind =
  | "manual_credit"
  | "manual_debit"
  | "concession_credit"
  | "withdrawal_credit"
export type ManualAdjustmentKind = "manual_credit" | "manual_debit"
export type ConcessionMode = "one_off" | "recurring"
export type ConcessionValueKind = "fixed" | "percentage"
export type FinanceStatus =
  | "setup_required"
  | "pending"
  | "partially_paid"
  | "overdue"
  | "paid"
  | "not_prepared"
  | "void"

export type PaymentView = {
  id: string
  receiptReference: string
  amountPaise: number
  paymentAmountPaise: number
  receivedOn: string
  method: PaymentMethod
  externalReference: string | null
  lifecycle: PaymentLifecycle
  internalNote?: string | null
}

export type PlayerReceiptAllocationView = {
  id: string
  chargeId: string
  chargeType: ChargeType
  billingPeriod: string | null
  feeReference: string
  description: string
  amountPaise: number
}

export type PlayerReceiptView = {
  id: string
  receiptReference: string
  amountPaise: number
  receivedOn: string
  method: PaymentMethod
  externalReference: string | null
  lifecycle: PaymentLifecycle
  allocations: PlayerReceiptAllocationView[]
  refunds: PlayerRefundView[]
  refundedPaise?: number
}

export type PlayerRefundView = {
  id: string
  paymentId: string
  receiptReference: string
  refundReference: string
  purpose: RefundPurpose
  withdrawalEffectiveOn: string | null
  amountPaise: number
  /**
   * The part of this refund paid back from the receipt it is listed under. A
   * withdrawal refund on a fee paid in two instalments can draw on both
   * receipts, so it is listed under each, with each receipt's own share.
   */
  receiptAmountPaise: number
  refundedOn: string
  lifecycle: PaymentLifecycle
}

export type PlayerConcessionEntryView = {
  id: string
  chargeId: string
  feeReference: string
  amountPaise: number
  appliedOn: string
  label: "Fee concession"
  lifecycle: "applied" | "reversed"
}

export type CoachReceiptAllocationView = PlayerReceiptAllocationView & {
  paymentAllocationId: string
  refundablePaise: number
}

export type CoachReceiptView = Omit<PlayerReceiptView, "allocations"> & {
  allocations: CoachReceiptAllocationView[]
  refundablePaise: number
  canRefund: boolean
  /**
   * The receipt's fee could be refunded for unused days, but the player is
   * still training: a withdrawal refund is recorded only after their training
   * is ended in Members (head coach, 13 Nov 2026).
   */
  refundNeedsTrainingEnded: boolean
  /** The days the member's withdrawal can be dated, when a refund is possible. */
  refundWindow: { earliest: string; latest: string } | null
  recordRevision: number
  internalNote: string | null
}

export type CoachRefundAllocationView = {
  paymentAllocationId: string
  chargeId: string
  feeReference: string
  amountPaise: number
}

export type CoachRefundView = PlayerRefundView & {
  paymentId: string
  method: PaymentMethod
  externalReference: string | null
  internalNote: string | null
  allocations: CoachRefundAllocationView[]
  canReverse: boolean
  recordRevision: number
}

export type CoachConcessionApplicationView = PlayerConcessionEntryView & {
  applicationId: string
  concessionId: string
  canReverse: boolean
}

export type CoachConcessionView = ConcessionView & {
  reason: string
  applications: CoachConcessionApplicationView[]
  canReverse: boolean
}

export type CoachFinanceManagementView = {
  receipts: CoachReceiptView[]
  refunds: CoachRefundView[]
  concessions: CoachConcessionView[]
}

export type AdjustmentView = {
  id: string
  kind: AdjustmentKind
  amountPaise: number
  reason: string
  createdAt: string
  reversed: boolean
  canReverse: boolean
}

export type ChargeView = {
  id: string
  feeReference: string
  type: ChargeType
  billingPeriod: string | null
  description: string
  originalAmountPaise: number
  effectiveAmountPaise: number
  receivedPaise: number
  outstandingPaise: number
  currency: FinanceCurrency
  dueDate: string
  lifecycle: ChargeLifecycle
  status: FinanceStatus
  recordRevision: number
  canVoid: boolean
  payments: PaymentView[]
  adjustments?: AdjustmentView[]
  /**
   * Net of the coach's manual debits and credits on this charge, still in force.
   * Shown to the player as "Fee adjusted" so a month whose fee changed after it
   * was issued (a plan change made from Members) still adds up on their screen.
   * Concession and withdrawal credits are shown on their own lines instead.
   */
  manualAdjustmentPaise?: number
}

export type FeeAgreementView = {
  id: string
  academyPlan: AcademyPlan
  level: TrainingProgramme
  batch: TrainingBatch
  agreedMonthlyFeePaise: number
  currency: FinanceCurrency
  monthlyDueDay: number
  effectiveFrom: string
  effectiveTo: string | null
  status: "active" | "paused" | "ended"
  recordRevision: number
}

/*
 * The enrolment facts a fee plan is built from. `suggestedMonthlyFeePaise` is
 * nullable because a level is allowed to have no standard fee -- Elite terms are
 * agreed per player -- and the absence of a price must not imply the absence of a
 * classification. Conflating the two is what used to make the fee-plan editor
 * disappear for such a player instead of letting the coach set their fee.
 */
export type FeeSetupDefaults = {
  academyPlan: AcademyPlan
  level: TrainingProgramme
  batch: TrainingBatch
  suggestedMonthlyFeePaise: number | null
}

/**
 * A player's fee plans read against today, so a screen can say which fee is in
 * force, which one is coming and whether the plans have ended. `feeAgreement`
 * on the record is only the "active" plan, which is the latest one: a fee
 * change makes next month's plan active while this month's has already ended,
 * and a player who left has no active plan at all.
 */
export type FeePlanStanding = {
  /** The plan in force today, running on or ending with this month. */
  current: FeeAgreementView | null
  /** A plan that starts after today: a fee change, or a new player's first fee month. */
  upcoming: FeeAgreementView | null
  /** The plan that ended last, when none is in force or coming. */
  ended: FeeAgreementView | null
  /** The day the first plan began. */
  startsOn: string | null
  /** The last day the plans cover, once none runs on. */
  endsOn: string | null
}

export type PlayerFeeRecord = {
  playerId: string
  academyId: string
  fullName: string
  archived: boolean
  feePlanSetupReady: boolean
  financeTrackingMonth: string | null
  registrationResolutionRequired: boolean
  status: FinanceStatus
  currentBalancePaise: number
  feeAgreement: FeeAgreementView | null
  feePlans: FeePlanStanding
  /** Player onboarding has finished, so a missing fee plan is not onboarding's to set. */
  onboardingComplete: boolean
  enrollmentDefaults?: FeeSetupDefaults | null
  setupDefaults: FeeSetupDefaults | null
  registrationCharge: ChargeView | null
  monthlyCharges: ChargeView[]
  receipts: PlayerReceiptView[]
  concessionEntries: PlayerConcessionEntryView[]
  coachManagement?: CoachFinanceManagementView
  /**
   * The last day of the player's term while every place they hold is on a
   * schedule that has run out (lib/sessions/term.ts); otherwise null. No fee
   * is issued for the months after it, and the fee page says why.
   */
  termFinishedOn: string | null
  /**
   * The 1st of the month a move booked in Members starts (a scheduled
   * training change), while the term has finished; otherwise null. That
   * month and those after it are billed as usual, so only the months between
   * the term's end and this one have no fee.
   */
  termFeeResumesOn: string | null
}

export type PlayerFinanceDashboardSummary = {
  status: FinanceStatus
  currentBalancePaise: number
  nextDueDate: string | null
}

export type PlayerFinancialCloseoutState = {
  hasOpenFeePlan: boolean
  hasOutstandingBalance: boolean
  outstandingPaise: number
}

export type FinancePlayerListItem = {
  playerId: string
  academyId: string
  fullName: string
  archived: boolean
  hasActiveFeePlan: boolean
  /** Every fee plan the player had has ended: they left or stopped fees. */
  feePlanEnded: boolean
  paymentEligible: boolean
  status: FinanceStatus
  outstandingPaise: number
  dueDate: string | null
  feeReference: string | null
}

export type CoachFinanceSummary = {
  receivedPaise: number
  outstandingPaise: number
  attentionCount: number
  paidCount: number
}

export type CoachFinanceDashboardSummary = Pick<
  CoachFinanceSummary,
  "attentionCount" | "outstandingPaise"
> & {
  preparation: Pick<MonthlyPreparationPreview, "ready" | "alreadyPrepared">
}

export type FinanceRapidScope = "outstanding" | "all"

export type MonthlyPreparationPreview = {
  ready: number
  alreadyPrepared: number
  awaitingAssignment: number
  setupRequired: number
}

export type CoachFinanceWorkspace = {
  activation: FinanceActivation | null
  period: string
  summary: CoachFinanceSummary
  players: FinancePlayerListItem[]
  selectedLedger: PlayerFeeRecord | null
  preparation: MonthlyPreparationPreview
}

export type CoachFinanceRapidDesk = {
  period: string
  scope: FinanceRapidScope
  players: FinancePlayerListItem[]
  selectedLedger: PlayerFeeRecord | null
}

export type CreateFeeAgreementInput = {
  playerId: string
  academyPlan: AcademyPlan
  level: TrainingProgramme
  batch: TrainingBatch
  agreedMonthlyFeePaise: number
  effectiveFrom: string
  monthlyDueDay?: number
  expectedAgreementRevision?: number
  idempotencyKey: string
}

export type CompleteOnboardingFinanceResult = {
  agreementId: string
  createdMonthlyChargeIds: string[]
  firstMonthlyChargeId: string | null
  firstMonthlyFeePaise: number | null
  firstMonthlyRemainingSessions: number | null
  firstMonthlyTotalSessions: number | null
  registrationChargeId: string
  reused: boolean
}

export type OnboardingFinanceTerms = Omit<
  CreateFeeAgreementInput,
  "effectiveFrom" | "expectedAgreementRevision" | "idempotencyKey"
>

export type OnboardingFinancePreviewLine = {
  amountPaise: number | null
  denominator: number | null
  description: string
  dueDate: string | null
  kind: "registration" | "monthly_training" | "before_tracking"
  numerator: number | null
  period: string | null
}

export type OnboardingFinancePreview = {
  academyDateKey: string
  blockers: string[]
  /** The last month the new Fee Plan bills when the first place has ended; else null. */
  feePlanEndsAfter: string | null
  feePlanStartOn: string
  fingerprint: string
  lines: OnboardingFinancePreviewLine[]
  playerRecordRevision: number
  totalIssuedPaise: number
  trackingMonth: string
  trainingStartOn: string
  warnings: string[]
}

export type CommitOnboardingFinanceInput = OnboardingFinanceTerms & {
  previewFingerprint: string
}

export type PrepareMonthlyChargesInput = {
  period: string
  idempotencyKey: string
}

export type PrepareMonthlyChargesResult = MonthlyPreparationPreview & {
  period: string
  createdChargeIds: string[]
  /** Candidates whose first month prorates to nothing billable. */
  deferred: number
  reused: boolean
}

export type RecordPaymentInput = {
  chargeId: string
  expectedChargeRevision: number
  amountPaise: number
  receivedOn: string
  method: PaymentMethod
  externalReference?: string
  internalNote?: string
  idempotencyKey: string
}

export type RecordPaymentResult = {
  paymentId: string
  charge: ChargeView
  reused: boolean
}

export type ReversePaymentInput = {
  paymentId: string
  reason: string
  idempotencyKey: string
}

export type ReverseAdjustmentInput = {
  adjustmentId: string
  reason: string
  idempotencyKey: string
}

export type VoidChargeInput = {
  chargeId: string
  expectedChargeRevision: number
  reason: string
  idempotencyKey: string
}

export type ApplyAdjustmentInput = {
  chargeId: string
  kind: ManualAdjustmentKind
  amountPaise: number
  reason: string
  idempotencyKey: string
}

export type PaymentAllocationInput = {
  chargeId: string
  amountPaise: number
  expectedChargeRevision: number
}

export type PreviewPaymentAllocationsInput = {
  playerId: string
  amountPaise: number
  allocations?: PaymentAllocationInput[]
}

export type PaymentAllocationPreviewItem = PaymentAllocationInput & {
  feeReference: string
  description: string
  dueDate: string
  availablePaise: number
}

export type PaymentAllocationPreview = {
  playerId: string
  amountPaise: number
  allocations: PaymentAllocationPreviewItem[]
}

export type RecordAllocatedPaymentInput = {
  playerId: string
  amountPaise: number
  receivedOn: string
  method: PaymentMethod
  externalReference?: string
  internalNote?: string
  allocations: PaymentAllocationInput[]
  mutationId: string
}

export type RecordAllocatedPaymentResult = {
  receipt: PlayerReceiptView
  charges: ChargeView[]
  reused: boolean
}

export type RefundAllocationInput = {
  paymentAllocationId: string
  amountPaise: number
}

export type PreviewRefundAllocationsInput = {
  paymentId: string
  expectedPaymentRevision: number
  amountPaise: number
  withdrawalEffectiveOn: string
  allocations?: RefundAllocationInput[]
}

export type RefundAllocationPreviewItem = RefundAllocationInput & {
  chargeId: string
  billingPeriod: string
  feeReference: string
  description: string
  refundablePaise: number
  expectedChargeRevision: number
  expectedAgreementRevision: number
}

export type RefundAllocationPreview = {
  paymentId: string
  amountPaise: number
  maximumRefundPaise: number
  allocations: RefundAllocationPreviewItem[]
}

export type RecordRefundInput = {
  paymentId: string
  expectedPaymentRevision: number
  expectedChargeRevision: number
  expectedAgreementRevision: number
  amountPaise: number
  withdrawalEffectiveOn: string
  refundedOn: string
  method: PaymentMethod
  externalReference?: string
  internalNote?: string
  allocations: RefundAllocationInput[]
  mutationId: string
}

export type RecordRefundResult = {
  refund: PlayerRefundView
  charges: ChargeView[]
  reused: boolean
  /**
   * Reversing a withdrawal refund only: whether the fee plan went back to how
   * it was before the refund. False when it stays ended.
   */
  feePlanRestored?: boolean
}

export type ReverseRefundInput = {
  refundId: string
  expectedRefundRevision: number
  reason: string
  mutationId: string
}

export type CreateConcessionInput = {
  playerId: string
  mode: ConcessionMode
  valueKind: ConcessionValueKind
  value: number
  startsPeriod?: string
  endsPeriod?: string
  reason: string
  mutationId: string
}

export type ConcessionView = {
  id: string
  playerId: string
  mode: ConcessionMode
  valueKind: ConcessionValueKind
  value: number
  startsPeriod: string | null
  endsPeriod: string | null
  lifecycle: "active" | "reversed"
  recordRevision: number
}

export type ConcessionMutationResult = {
  concession: ConcessionView
  reused: boolean
}

export type ConcessionApplicationResult = {
  applicationId: string
  concession: ConcessionView
  charge: ChargeView
  reused: boolean
}

export type ApplyConcessionInput = {
  concessionId: string
  chargeId: string
  expectedConcessionRevision: number
  expectedChargeRevision: number
  mutationId: string
}

export type ReverseConcessionApplicationInput = {
  applicationId: string
  reason: string
  mutationId: string
}

export type ReverseConcessionInput = {
  concessionId: string
  expectedConcessionRevision: number
  reason: string
  mutationId: string
}

export type FinanceCollectionEvent = {
  eventDate: string
  eventType: "payment" | "refund"
  reference: string
  playerFullName: string
  academyId: string
  method: PaymentMethod
  amountPaise: number
  coveredFeeReferences: string[]
}

export type FinanceRegisterMode = "monthly" | "registration"
export type FinancePlayerScope = "active" | "archived" | "all"

export type FinanceRegisterRow = {
  playerId: string
  academyId: string
  fullName: string
  archived: boolean
  chargeId: string | null
  feeReference: string | null
  type: ChargeType
  billingPeriod: string | null
  originalAmountPaise: number
  creditAdjustmentsPaise: number
  debitAdjustmentsPaise: number
  effectiveAmountPaise: number
  receivedPaise: number
  outstandingPaise: number
  dueDate: string | null
  status: FinanceStatus
}

export type FinanceRegisterSummary = {
  totalRows: number
  originalAmountPaise: number
  effectiveAmountPaise: number
  receivedPaise: number
  outstandingPaise: number
  statusCounts: Partial<Record<FinanceStatus, number>>
}

export type FinanceRegisterResult = {
  rows: FinanceRegisterRow[]
  summary: FinanceRegisterSummary
  nextCursor: string | null
}

export type FinanceRegisterInput = {
  mode: FinanceRegisterMode
  period?: string
  query?: string
  statuses?: FinanceStatus[]
  playerScope?: FinancePlayerScope
  cursor?: string
  limit?: number
}

export type FinanceDayBookEvent = {
  id: string
  eventDate: string
  recordedAt: string
  eventType: "payment" | "refund"
  reference: string
  playerId: string
  playerFullName: string
  academyId: string
  method: PaymentMethod
  amountPaise: number
  coveredFeeReferences: string[]
  lifecycle: PaymentLifecycle
}

export type FinanceDayBookSummary = {
  grossReceivedPaise: number
  refundsPaise: number
  netCollectionsPaise: number
  byMethod: Record<PaymentMethod, number>
}

export type FinanceDayBookResult = {
  events: FinanceDayBookEvent[]
  summary: FinanceDayBookSummary
  nextCursor: string | null
}

export type FinanceDayBookInput = {
  from: string
  to: string
  query?: string
  methods?: PaymentMethod[]
  includeReversed?: boolean
  cursor?: string
  limit?: number
}

/**
 * The finance audit event set. Every consumer of the list derives from this array —
 * the `financial_audit_events.event_type` column type, the service input validator,
 * the activity log's action text, the activity filter dropdown and the activity CSV
 * allow-list — so none of them can hold a copy that has fallen behind.
 *
 * The order is the order the activity filter offers, and it follows the billing
 * workflow (activation, then fee plans, charges, payments, refunds, concessions,
 * adjustments, corrections) rather than the alphabet.
 */
export const FINANCE_AUDIT_EVENT_TYPES = [
  "finance_activated",
  "fee_agreement_created",
  "fee_agreement_replaced",
  "fee_agreement_paused",
  "fee_agreement_ended",
  "fee_agreement_corrected",
  "charge_issued",
  "charge_voided",
  "monthly_fees_prepared",
  "payment_recorded",
  "payment_reversed",
  "refund_recorded",
  "refund_reversed",
  "concession_created",
  "concession_applied",
  "concession_application_reversed",
  "concession_reversed",
  "adjustment_created",
  "adjustment_reversed",
  "historical_reconciled",
  "training_start_redated",
] as const

export type FinanceAuditEventType = (typeof FINANCE_AUDIT_EVENT_TYPES)[number]

type FinanceAuditEventDescriptor = {
  /** What happened, past tense, for an activity row and the activity CSV. */
  action: string
  /** The same event named as a filter category, for the activity filter dropdown. */
  filterLabel: string
}

/**
 * Both labels for each event. The two are different vocabularies and four events read
 * differently in each: the log says "Concession ended", the filter that selects those
 * rows says "Concession reversed".
 *
 * The `Record` is what makes the list above the only place to edit — adding an event
 * type does not compile until it has both of its labels here.
 */
export const FINANCE_AUDIT_EVENTS: Record<FinanceAuditEventType, FinanceAuditEventDescriptor> = {
  finance_activated: {
    action: "Financial tracking activated",
    filterLabel: "Financials activated",
  },
  fee_agreement_created: { action: "Fee plan created", filterLabel: "Fee plan created" },
  fee_agreement_replaced: { action: "Fee plan replaced", filterLabel: "Fee plan changed" },
  fee_agreement_paused: { action: "Fee plan paused", filterLabel: "Fee plan paused" },
  fee_agreement_ended: { action: "Fee plan ended", filterLabel: "Fee plan ended" },
  fee_agreement_corrected: { action: "Fee plan corrected", filterLabel: "Fee plan corrected" },
  charge_issued: { action: "Fee issued", filterLabel: "Fee issued" },
  charge_voided: { action: "Fee voided", filterLabel: "Fee voided" },
  monthly_fees_prepared: { action: "Monthly fees issued", filterLabel: "Monthly fees issued" },
  payment_recorded: { action: "Payment recorded", filterLabel: "Payment recorded" },
  payment_reversed: { action: "Payment reversed", filterLabel: "Payment reversed" },
  refund_recorded: { action: "Refund recorded", filterLabel: "Refund recorded" },
  refund_reversed: { action: "Refund reversed", filterLabel: "Refund reversed" },
  concession_created: { action: "Concession created", filterLabel: "Concession created" },
  concession_applied: { action: "Concession applied", filterLabel: "Concession applied" },
  concession_application_reversed: {
    action: "Concession application reversed",
    filterLabel: "Concession application reversed",
  },
  concession_reversed: { action: "Concession ended", filterLabel: "Concession reversed" },
  adjustment_created: {
    action: "Fee adjustment recorded",
    filterLabel: "Fee adjustment recorded",
  },
  adjustment_reversed: {
    action: "Fee adjustment reversed",
    filterLabel: "Fee adjustment reversed",
  },
  historical_reconciled: {
    action: "Historical fee status recorded",
    filterLabel: "Historical status recorded",
  },
  training_start_redated: {
    action: "Training start date corrected",
    filterLabel: "Training start date corrected",
  },
}

const FINANCE_AUDIT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(FINANCE_AUDIT_EVENT_TYPES)

/** Narrows an untrusted query parameter, so callers never have to assert the type. */
export function isFinanceAuditEventType(value: unknown): value is FinanceAuditEventType {
  return typeof value === "string" && FINANCE_AUDIT_EVENT_TYPE_SET.has(value)
}

export type FinanceActivityItem = {
  id: string
  occurredAt: string
  eventType: FinanceAuditEventType
  action: string
  actorId: string
  actorName: string
  playerId: string | null
  playerName: string | null
  academyId: string | null
  reference: string | null
  amountPaise: number | null
  reason: string | null
}

export type FinanceActivityResult = {
  items: FinanceActivityItem[]
  nextCursor: string | null
}

export type FinanceActivityCoachOption = {
  id: string
  name: string
}

export type FinanceActivityInput = {
  from?: string
  to?: string
  query?: string
  eventTypes?: FinanceAuditEventType[]
  coachId?: string
  cursor?: string
  limit?: number
}

export type EndFeeAgreementInput = {
  agreementId: string
  effectiveThroughPeriod: string
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export type EndFeeAgreementResult = {
  agreement: FeeAgreementView
  reused: boolean
}

export type RedateConfirmedTrainingStartInput = {
  playerId: string
  trainingStartOn: string
  reason: string
  expectedRevision: number
  idempotencyKey: string
}

export type RedateConfirmedTrainingStartResult = {
  playerId: string
  previousTrainingStartOn: string
  trainingStartOn: string
  recordRevision: number
  agreementId: string | null
  agreementEffectiveFrom: string | null
  /** Months the correction opens for attendance and monthly fee preparation. */
  reopenedPeriods: string[]
  reused: boolean
}

export type ExistingPlayerFinanceSetupInput = CreateFeeAgreementInput & {
  registrationStatus: "pending" | "unresolved"
  idempotencyKey: string
}

export type ResolveExistingRegistrationFeeInput = {
  playerId: string
  status: "pending"
  idempotencyKey: string
}

export type ReconcileRegistrationStatusInput = ResolveExistingRegistrationFeeInput

export type FinanceActivation = {
  activatedAt: string
  trackingMonth: string
}

export type FinanceServiceErrorCode =
  | "AUTHORIZATION"
  | "INVALID_INPUT"
  | "FINANCE_NOT_ACTIVE"
  | "ALREADY_ACTIVE"
  | "PLAYER_UNAVAILABLE"
  | "SETUP_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ALREADY_SETTLED"
  | "BALANCE_CHANGED"
  | "IDEMPOTENCY_CONFLICT"

export type FinanceField =
  | "playerId"
  | "academyPlan"
  | "level"
  | "batch"
  | "agreedMonthlyFeePaise"
  | "effectiveFrom"
  | "monthlyDueDay"
  | "trainingStartOn"
  | "period"
  | "chargeId"
  | "paymentId"
  | "refundId"
  | "concessionId"
  | "adjustmentId"
  | "amountPaise"
  | "withdrawalEffectiveOn"
  | "receivedOn"
  | "method"
  | "reason"
  | "externalReference"
  | "internalNote"
  | "idempotencyKey"
