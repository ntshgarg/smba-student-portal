"use server"

import { revalidatePath } from "next/cache"

import { findAccountContact } from "@/lib/auth/account-service"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { createAuthMailer } from "@/lib/auth/mailer"
import { absoluteSiteUrl } from "@/lib/config"
import {
  activateFinance,
  applyChargeAdjustment,
  completePlayerOnboardingFinance,
  FinanceServiceError,
  previewPlayerOnboardingFinance,
  previewPaymentAllocations,
  previewRefundAllocations,
  prepareMonthlyCharges,
  recordAllocatedPayment,
  recordRefund,
  redateConfirmedTrainingStart,
  reverseChargeAdjustment,
  reverseConcessionApplication,
  reversePayment,
  reverseRefund,
  voidCharge,
} from "@/lib/finance/service"
import type {
  ApplyAdjustmentInput,
  CommitOnboardingFinanceInput,
  FinanceField,
  FinanceServiceErrorCode,
  PrepareMonthlyChargesInput,
  PreviewPaymentAllocationsInput,
  PreviewRefundAllocationsInput,
  PaymentAllocationPreview,
  OnboardingFinancePreview,
  OnboardingFinanceTerms,
  RecordAllocatedPaymentInput,
  RecordRefundInput,
  RedateConfirmedTrainingStartInput,
  RefundAllocationPreview,
  ReversePaymentInput,
  ReverseRefundInput,
  ReverseAdjustmentInput,
  ReverseConcessionApplicationInput,
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

/**
 * The approval email says a password comes later; this is the "later". Onboarding
 * is already committed, so a failed email is reported to the coach, not undone.
 */
async function emailOnboardingFinished(playerId: string) {
  try {
    const contact = findAccountContact(playerId)
    const mailer = createAuthMailer()
    if (!contact?.contactEmail || !mailer.sendSecurityNotice) return false
    await mailer.sendSecurityNotice({
      fullName: contact.fullName,
      lines: [
        "Your coach has finished setting up your training.",
        `You can now create your password: ${absoluteSiteUrl("/activate")}`,
      ],
      subject: "You can now set your SMBA password",
      to: contact.contactEmail,
    })
    return true
  } catch {
    return false
  }
}

export async function completeOnboardingFinanceAction(
  input: CommitOnboardingFinanceInput,
): Promise<FinanceActionResult> {
  const completed = { now: false }
  const result = await runFinanceAction((coachId) => {
    const result = completePlayerOnboardingFinance(input, { coachId })
    completed.now = !result.reused
    return {
      message: result.reused
        ? "Onboarding fees were already issued"
        : result.createdMonthlyChargeIds.length
          ? `Onboarding completed; registration and ${result.createdMonthlyChargeIds.length} ${result.createdMonthlyChargeIds.length === 1 ? "monthly fee" : "monthly fees"} issued`
          : "Onboarding completed; registration fee issued and the monthly Fee Plan starts in its derived month",
    }
  })
  if (!result.ok || !completed.now || await emailOnboardingFinished(input.playerId)) return result
  return {
    ...result,
    message: `${result.message}; the family could not be emailed, so tell them they can now set a password`,
  }
}

export async function previewOnboardingFinanceAction(
  input: OnboardingFinanceTerms,
): Promise<FinanceDataActionResult<OnboardingFinancePreview>> {
  return runFinanceQuery((coachId) => previewPlayerOnboardingFinance(input, { coachId }))
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
    if (result.reused && result.receipt.lifecycle === "reversed") {
      return { message: "This payment was already recorded, and has since been reversed" }
    }
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
    if (result.reused && result.refund.lifecycle === "reversed") {
      return { message: "This refund was already recorded, and has since been reversed" }
    }
    return { message: result.reused ? "Refund already recorded" : "Refund recorded" }
  })
}

export async function reverseRefundAction(
  input: ReverseRefundInput,
): Promise<FinanceActionResult> {
  return runFinanceAction((coachId) => {
    const result = reverseRefund(input, { coachId })
    if (result.reused) return { message: "Refund already reversed" }
    // The coach is told when the fee plan did not go back, so a player still
    // training is not silently left with no fee plan.
    if (result.feePlanRestored === false) {
      return { message: "Refund reversed. The fee plan stays ended" }
    }
    if (result.feePlanRestored) {
      return { message: "Refund reversed. The fee plan is back as it was before the refund" }
    }
    return { message: "Refund reversed" }
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
