import type {
  FinancialChargeView,
  PlayerFinancialLedgerView,
  RapidFinancialWorkspaceView,
} from "./types"
import type {
  ChargeView,
  CoachFinanceRapidDesk,
  FeePlanStanding,
  PlayerFeeRecord,
} from "@/lib/finance/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

function planLabel(plan: NonNullable<FeePlanStanding["current"]>) {
  return `${plan.level} · ${plan.batch} · ${academyPlanLabel(plan.academyPlan)}`
}

/*
 * The plan in force today, not just the "active" one, which is the latest:
 * a leaver has no active plan and used to read as "onboarding in progress",
 * and a waiting fee change showed next month's fee as the agreed fee now.
 */
function feePlanView(standing: FeePlanStanding): PlayerFinancialLedgerView["feePlan"] {
  const shown = standing.current ?? standing.upcoming ?? standing.ended
  if (!shown) return null
  const upcoming = standing.current && standing.upcoming
    ? {
        agreedMonthlyFeePaise: standing.upcoming.agreedMonthlyFeePaise,
        effectiveFrom: standing.upcoming.effectiveFrom,
        feeChanges: standing.upcoming.agreedMonthlyFeePaise
          !== standing.current.agreedMonthlyFeePaise,
        label: planLabel(standing.upcoming),
      }
    : null
  return {
    id: shown.id,
    academyPlan: shown.academyPlan,
    agreedMonthlyFeePaise: shown.agreedMonthlyFeePaise,
    batch: shown.batch,
    effectiveFrom: shown.effectiveFrom,
    effectiveTo: shown.effectiveTo,
    label: planLabel(shown),
    level: shown.level,
    recordRevision: shown.recordRevision,
    standing: shown === standing.current
      ? shown.effectiveTo ? "ending" : "running"
      : shown === standing.upcoming ? "starting" : "ended",
    status: shown.status,
    upcoming,
  }
}

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
    feePlanSetupReady: ledger.feePlanSetupReady,
    feePlan: feePlanView(ledger.feePlans),
    onboardingComplete: ledger.onboardingComplete,
    trainsWithoutFeePlan: ledger.trainsWithoutFeePlan,
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
