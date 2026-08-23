"use server"

import { revalidatePath } from "next/cache"

import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import {
  activateFinance,
  applyConcession,
  applyChargeAdjustment,
  createConcession,
  completePlayerOnboardingFinance,
  createOrReplaceFeeAgreement,
  endFeeAgreement,
  FinanceServiceError,
  previewPlayerOnboardingFinance,
  previewPaymentAllocations,
  previewRefundAllocations,
  prepareMonthlyCharges,
  recordAllocatedPayment,
  recordPayment,
  recordRefund,
  reconcileRegistrationStatus,
  redateConfirmedTrainingStart,
  reverseChargeAdjustment,
  reverseConcession,
  reverseConcessionApplication,
  reversePayment,
  reverseRefund,
  setupExistingPlayerFinance,
  voidCharge,
} from "@/lib/finance/service"
import type {
  ApplyAdjustmentInput,
  ApplyConcessionInput,
  CommitOnboardingFinanceInput,
  CreateFeeAgreementInput,
  CreateConcessionInput,
  ExistingPlayerFinanceSetupInput,
  EndFeeAgreementInput,
  FinanceField,
  FinanceServiceErrorCode,
  PrepareMonthlyChargesInput,
  PreviewPaymentAllocationsInput,
  PreviewRefundAllocationsInput,
  PaymentAllocationPreview,
  OnboardingFinancePreview,
  OnboardingFinanceTerms,
  RecordPaymentInput,
  RecordAllocatedPaymentInput,
  RecordRefundInput,
  RedateConfirmedTrainingStartInput,
  RefundAllocationPreview,
  ReversePaymentInput,
  ReverseRefundInput,
  ReconcileRegistrationStatusInput,
  ReverseAdjustmentInput,
  ReverseConcessionApplicationInput,
  ReverseConcessionInput,
  VoidChargeInput,
} from "@/lib/finance/types"

type FinanceActionFailure =
  {
    ok: false
    code: FinanceServiceErrorCode
    field?: FinanceField
    message: string
  }

export type FinanceActionResult =
  | { ok: true; message: string }
  | FinanceActionFailure

export type FinanceDataActionResult<T> =
  | { ok: true; data: T }
  | FinanceActionFailure

async function requireCoach() {
  return requireHeadAdminAction()
}

function revalidateFinance() {
  revalidatePath("/coach")
  revalidatePath("/coach/financials")
  revalidatePath("/coach/financials/record")
  revalidatePath("/coach/financials/records")
  revalidatePath("/coach/financials/players/[playerId]", "page")
  revalidatePath("/coach/onboarding")
  revalidatePath("/player")
  revalidatePath("/player/financials")
}

function failure(error: FinanceServiceError): FinanceActionFailure {
  return {
    ok: false,
    code: error.code,
    field: error.field,
    message: error.message,
  }
}

async function runFinanceQuery<T>(
  operation: (coachId: string) => T,
): Promise<FinanceDataActionResult<T>> {
  const coach = await requireCoach()
  try {
    return { ok: true, data: operation(coach.subjectId) }
  } catch (error) {
    if (error instanceof FinanceServiceError) return failure(error)
    throw error
  }
}

async function runFinanceAction(
  operation: (coachId: string) => { message: string },
): Promise<FinanceActionResult> {
  const coach = await requireCoach()
  try {
    const result = operation(coach.subjectId)
    revalidateFinance()
    return { ok: true, message: result.message }
  } catch (error) {
    if (error instanceof FinanceServiceError) return failure(error)
    throw error
  }
}

export async function activateFinanceAction(input: {
  idempotencyKey: string
  trackingMonth: string
}): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = activateFinance(input, { coachId })
    return {
      message: result.reused ? "Financial tracking is already active" : "Financial tracking activated",
    }
  })
}

export async function setupExistingPlayerFinanceAction(
  input: ExistingPlayerFinanceSetupInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    setupExistingPlayerFinance(input, { coachId })
    return { message: "Fee plan created" }
  })
}

export async function replaceFeeAgreementAction(
  input: CreateFeeAgreementInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    createOrReplaceFeeAgreement(input, { coachId })
    return { message: "Fee plan updated" }
  })
}

export async function completeOnboardingFinanceAction(
  input: CommitOnboardingFinanceInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = completePlayerOnboardingFinance(input, { coachId })
    return {
      message: result.reused
        ? "Onboarding fees were already issued"
        : result.createdMonthlyChargeIds.length
          ? `Onboarding completed; registration and ${result.createdMonthlyChargeIds.length} ${result.createdMonthlyChargeIds.length === 1 ? "monthly fee" : "monthly fees"} issued`
          : "Onboarding completed; registration fee issued and the monthly Fee Plan starts in its derived month",
    }
  })
}

export async function previewOnboardingFinanceAction(
  input: OnboardingFinanceTerms,
): Promise<FinanceDataActionResult<OnboardingFinancePreview>> {
  return runFinanceQuery((coachId) => previewPlayerOnboardingFinance(input, { coachId }))
}

export async function endFeeAgreementAction(
  input: EndFeeAgreementInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = endFeeAgreement(input, { coachId })
    return { message: result.reused ? "Fee plan already ended" : "Fee plan ended" }
  })
}

export async function redateConfirmedTrainingStartAction(
  input: RedateConfirmedTrainingStartInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = redateConfirmedTrainingStart(input, { coachId })
    return {
      message: result.reused
        ? "Training start date already corrected"
        : `Training start date corrected to ${result.trainingStartOn}`,
    }
  })
}

export async function reconcileRegistrationFeeAction(
  input: ReconcileRegistrationStatusInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    reconcileRegistrationStatus(input, { coachId })
    return { message: "Registration fee issued" }
  })
}

export async function prepareMonthlyChargesAction(
  input: PrepareMonthlyChargesInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = prepareMonthlyCharges(input, { coachId })
    const count = result.createdChargeIds.length
    return {
      message: result.reused
        ? "Monthly fees were already issued"
        : `${count} ${count === 1 ? "monthly fee" : "monthly fees"} issued`,
    }
  })
}

export async function recordPaymentAction(
  input: RecordPaymentInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = recordPayment(input, { coachId })
    return { message: result.reused ? "Payment already recorded" : "Payment recorded" }
  })
}

export async function previewPaymentAllocationsAction(
  input: PreviewPaymentAllocationsInput,
): Promise<FinanceDataActionResult<PaymentAllocationPreview>> {
  return runFinanceQuery((coachId) => previewPaymentAllocations(input, { coachId }))
}

export async function recordAllocatedPaymentAction(
  input: RecordAllocatedPaymentInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = recordAllocatedPayment(input, { coachId })
    return { message: result.reused ? "Payment already recorded" : "Payment recorded" }
  })
}

export async function previewRefundAllocationsAction(
  input: PreviewRefundAllocationsInput,
): Promise<FinanceDataActionResult<RefundAllocationPreview>> {
  return runFinanceQuery((coachId) => previewRefundAllocations(input, { coachId }))
}

export async function recordRefundAction(
  input: RecordRefundInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = recordRefund(input, { coachId })
    return { message: result.reused ? "Refund already recorded" : "Refund recorded" }
  })
}

export async function reverseRefundAction(
  input: ReverseRefundInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = reverseRefund(input, { coachId })
    return { message: result.reused ? "Refund already reversed" : "Refund reversed" }
  })
}

export async function createConcessionAction(
  input: CreateConcessionInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = createConcession(input, { coachId })
    return { message: result.reused ? "Concession already created" : "Concession created" }
  })
}

export async function applyConcessionAction(
  input: ApplyConcessionInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = applyConcession(input, { coachId })
    return { message: result.reused ? "Concession already applied" : "Concession applied" }
  })
}

export async function reverseConcessionApplicationAction(
  input: ReverseConcessionApplicationInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = reverseConcessionApplication(input, { coachId })
    return {
      message: result.reused ? "Concession application already reversed" : "Concession application reversed",
    }
  })
}

export async function reverseConcessionAction(
  input: ReverseConcessionInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = reverseConcession(input, { coachId })
    return { message: result.reused ? "Concession already reversed" : "Concession reversed" }
  })
}

export async function reversePaymentAction(
  input: ReversePaymentInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    reversePayment(input, { coachId })
    return { message: "Payment reversed" }
  })
}

export async function reverseChargeAdjustmentAction(
  input: ReverseAdjustmentInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    reverseChargeAdjustment(input, { coachId })
    return { message: "Adjustment reversed" }
  })
}

export async function applyChargeAdjustmentAction(
  input: Omit<ApplyAdjustmentInput, "kind"> & {
    kind: "manual_credit" | "manual_debit"
  },
): Promise<FinanceActionResult> {
  if (input.kind !== "manual_credit" && input.kind !== "manual_debit") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Choose a valid correction",
    }
  }
  return runFinanceAction((coachId) => {
    applyChargeAdjustment(input, { coachId })
    return {
      message: input.kind === "manual_credit" ? "Credit applied" : "Additional charge applied",
    }
  })
}

export async function voidChargeAction(
  input: VoidChargeInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    voidCharge(input, { coachId })
    return { message: "Charge voided" }
  })
}
