import type {
  FinancialChargeView,
  PlayerFinancialLedgerView,
  RapidFinancialWorkspaceView,
} from "./types"
import type {
  ChargeView,
  CoachFinanceRapidDesk,
  PlayerFeeRecord,
} from "@/lib/finance/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

function chargeView(charge: ChargeView): FinancialChargeView {
  return {
    adjustments: charge.adjustments ?? [],
    id: charge.id,
    billingPeriod: charge.billingPeriod,
    canVoid: charge.canVoid,
    description: charge.description,
    dueDate: charge.dueDate,
    effectiveAmountPaise: charge.effectiveAmountPaise,
    feeReference: charge.feeReference,
    originalAmountPaise: charge.originalAmountPaise,
    outstandingPaise: charge.outstandingPaise,
    payments: charge.payments.map((payment) => ({
      id: payment.id,
      amountPaise: payment.amountPaise,
      method: payment.method,
      receivedOn: payment.receivedOn,
      reference: payment.externalReference,
      internalNote: payment.internalNote ?? null,
      reversed: payment.lifecycle === "reversed",
    })),
    receivedPaise: charge.receivedPaise,
    revision: charge.recordRevision,
    status: charge.status,
    type: charge.type,
  }
}

export function toPlayerFinancialLedgerView(ledger: PlayerFeeRecord): PlayerFinancialLedgerView {
  return {
    academyId: ledger.academyId,
    archived: "archived" in ledger ? Boolean(ledger.archived) : false,
    charges: [ledger.registrationCharge, ...ledger.monthlyCharges]
      .filter((charge): charge is ChargeView => Boolean(charge))
      .map(chargeView),
    feePlan: ledger.feeAgreement ? {
      id: ledger.feeAgreement.id,
      academyPlan: ledger.feeAgreement.academyPlan,
      agreedMonthlyFeePaise: ledger.feeAgreement.agreedMonthlyFeePaise,
      batch: ledger.feeAgreement.batch,
      effectiveFrom: ledger.feeAgreement.effectiveFrom,
      label: `${ledger.feeAgreement.level} · ${ledger.feeAgreement.batch} · ${academyPlanLabel(ledger.feeAgreement.academyPlan)}`,
      level: ledger.feeAgreement.level,
      recordRevision: ledger.feeAgreement.recordRevision,
      status: ledger.feeAgreement.status,
    } : null,
    enrollmentDefaults: ledger.enrollmentDefaults ? {
      ...ledger.enrollmentDefaults,
      academyPlanLabel: academyPlanLabel(ledger.enrollmentDefaults.academyPlan),
    } : null,
    fullName: ledger.fullName,
    management: ledger.coachManagement ?? {
      concessions: [],
      receipts: [],
      refunds: [],
    },
    outstandingPaise: ledger.currentBalancePaise,
    playerId: ledger.playerId,
    setupDefaults: ledger.setupDefaults ? {
      ...ledger.setupDefaults,
      academyPlanLabel: academyPlanLabel(ledger.setupDefaults.academyPlan),
    } : null,
    status: ledger.status,
  }
}

export function toRapidFinancialWorkspaceView(
  workspace: CoachFinanceRapidDesk,
): RapidFinancialWorkspaceView {
  return {
    period: workspace.period,
    scope: workspace.scope,
    players: workspace.players.map((player) => ({
      ...player,
      archived: "archived" in player ? Boolean(player.archived) : false,
    })),
    selectedLedger: workspace.selectedLedger
      ? toPlayerFinancialLedgerView(workspace.selectedLedger)
      : null,
  }
}
