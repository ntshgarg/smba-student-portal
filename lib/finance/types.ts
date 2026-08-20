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

export type FeeSetupDefaults = {
  academyPlan: AcademyPlan
  level: TrainingProgramme
  batch: TrainingBatch
  suggestedMonthlyFeePaise: number
}

export type PlayerFeeRecord = {
  playerId: string
  academyId: string
  fullName: string
  archived: boolean
  feePlanSetupReady: boolean
  registrationResolutionRequired: boolean
  status: FinanceStatus
  currentBalancePaise: number
  feeAgreement: FeeAgreementView | null
  enrollmentDefaults?: FeeSetupDefaults | null
  setupDefaults: FeeSetupDefaults | null
  registrationCharge: ChargeView | null
  monthlyCharges: ChargeView[]
  receipts: PlayerReceiptView[]
  concessionEntries: PlayerConcessionEntryView[]
  coachManagement?: CoachFinanceManagementView
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
  firstMonthlyChargeId: string | null
  registrationChargeId: string
  reused: boolean
}

export type PrepareMonthlyChargesInput = {
  period: string
  idempotencyKey: string
}

export type PrepareMonthlyChargesResult = MonthlyPreparationPreview & {
  period: string
  createdChargeIds: string[]
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

export type FinanceAuditEventType =
  | "finance_activated"
  | "fee_agreement_created"
  | "fee_agreement_replaced"
  | "fee_agreement_paused"
  | "fee_agreement_ended"
  | "charge_issued"
  | "charge_voided"
  | "monthly_fees_prepared"
  | "payment_recorded"
  | "payment_reversed"
  | "refund_recorded"
  | "refund_reversed"
  | "concession_created"
  | "concession_applied"
  | "concession_application_reversed"
  | "concession_reversed"
  | "adjustment_created"
  | "adjustment_reversed"
  | "historical_reconciled"

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
