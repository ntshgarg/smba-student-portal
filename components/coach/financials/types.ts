export type FinanceStatus =
  | "setup_required"
  | "not_prepared"
  | "pending"
  | "partially_paid"
  | "overdue"
  | "paid"
  | "void"

export type FinancialPlayerListView = {
  playerId: string
  academyId: string
  archived: boolean
  fullName: string
  hasActiveFeePlan: boolean
  paymentEligible: boolean
  status: FinanceStatus
  outstandingPaise: number
  dueDate: string | null
  feeReference: string | null
}

export type FinancialPaymentView = {
  id: string
  amountPaise: number
  method: string
  receivedOn: string
  reference: string | null
  internalNote: string | null
  reversed: boolean
}

export type FinancialChargeView = {
  adjustments: Array<{
    amountPaise: number
    createdAt: string
    id: string
    kind: import("@/lib/finance/types").AdjustmentKind
    reason: string
    reversed: boolean
    canReverse: boolean
  }>
  id: string
  billingPeriod: string | null
  description: string
  dueDate: string
  effectiveAmountPaise: number
  feeReference: string
  originalAmountPaise: number
  outstandingPaise: number
  payments: FinancialPaymentView[]
  receivedPaise: number
  revision: number
  status: FinanceStatus
  type: "registration" | "monthly_training"
  canVoid: boolean
}

export type PlayerFinancialLedgerView = {
  academyId: string
  archived: boolean
  charges: FinancialChargeView[]
  feePlanSetupReady: boolean
  feePlan: {
    id: string
    academyPlan: import("@/lib/training/academy-plans").AcademyPlan
    agreedMonthlyFeePaise: number
    batch: import("@/lib/sessions/types").TrainingBatch
    effectiveFrom: string
    label: string
    level: import("@/lib/sessions/types").TrainingProgramme
    recordRevision: number
    status: "active" | "paused" | "ended"
  } | null
  enrollmentDefaults: {
    academyPlan: import("@/lib/training/academy-plans").AcademyPlan
    academyPlanLabel: string
    batch: import("@/lib/sessions/types").TrainingBatch
    level: import("@/lib/sessions/types").TrainingProgramme
    suggestedMonthlyFeePaise: number
  } | null
  setupDefaults: {
    academyPlan: import("@/lib/training/academy-plans").AcademyPlan
    academyPlanLabel: string
    batch: import("@/lib/sessions/types").TrainingBatch
    level: import("@/lib/sessions/types").TrainingProgramme
    suggestedMonthlyFeePaise: number
  } | null
  fullName: string
  management: import("@/lib/finance/types").CoachFinanceManagementView
  playerId: string
  status: FinanceStatus
  outstandingPaise: number
}

export type RapidFinancialWorkspaceView = {
  period: string
  scope: import("@/lib/finance/types").FinanceRapidScope
  players: FinancialPlayerListView[]
  selectedLedger: PlayerFinancialLedgerView | null
}
