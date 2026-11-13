"use server"

import { revalidatePath } from "next/cache"

import {
  OperationalActionError,
  operationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getAcademyDateKey } from "@/lib/format"
import {
  cancelTrainingChange,
  changeScheduleThisMonth,
  dismissTrainingNotice,
  endTrainingNow,
  nextMonthStartOf,
  previewScheduleChange,
  scheduleEndOfTraining,
  scheduleTrainingChange,
  stopFeePlan,
  type ChangeThisMonthInput,
} from "@/lib/training/changes"
import {
  cancelFeeChange,
  changeMonthlyFee,
  giveConcession,
  stopConcession,
  type GiveConcessionInput,
} from "@/lib/training/fees"

/*
 * Server actions behind the training and fee actions on a player's record in
 * Members. Every one refreshes the screens whose data it can change: the
 * directory, schedules and rosters, attendance, the dashboard, Fee records
 * and the player's own pages.
 */

function refreshAfterTrainingChange() {
  revalidatePath("/coach")
  revalidatePath("/coach/members")
  revalidatePath("/coach/schedules")
  revalidatePath("/coach/calendar")
  revalidatePath("/coach/attendance/players/register")
  revalidatePath("/coach/attendance/players/record")
  revalidatePath("/coach/financials")
  revalidatePath("/coach/financials/records")
  revalidatePath("/coach/financials/players/[playerId]", "page")
  revalidatePath("/player")
  revalidatePath("/player/financials")
}

async function run<T>(operation: (coachId: string) => T): Promise<OperationalActionResult<T>> {
  try {
    // Inside the try so an expired sign-in comes back as a result the form can
    // explain, not as a thrown error that production replaces with a digest.
    const coach = await requireHeadAdminAction()
    const data = operation(coach.subjectId)
    refreshAfterTrainingChange()
    return { ok: true, data }
  } catch (error) {
    if (error instanceof OperationalActionError) return operationalActionFailure(error)
    throw error
  }
}

/**
 * "Change schedule": starting on the 1st of next month it is scheduled and can
 * change anything; starting on a day this month it happens now, under the
 * paid-fee rule in lib/training/changes.ts.
 */
export async function changeScheduleAction(input: ChangeThisMonthInput & { when?: "next" | "this" }) {
  return run((coachId) => {
    const nextMonthStart = nextMonthStartOf(getAcademyDateKey(academyNow()))
    // A "next month" form sent after midnight on the last day must not apply at once.
    if (input.when === "next" && input.startsOn !== nextMonthStart) {
      operationalActionError(
        "CONFLICT",
        "A new month has started since this form was opened. Close it and open it again.",
      )
    }
    if (input.startsOn === nextMonthStart) {
      const scheduled = scheduleTrainingChange(input, { coachId })
      return { kind: "scheduled" as const, startsOn: scheduled.effectiveOn, result: null }
    }
    const result = changeScheduleThisMonth(input, { coachId })
    return { kind: "changed" as const, startsOn: result.startsOn, result }
  })
}

export async function scheduleEndOfTrainingAction(input: { playerId: string; stopFees: boolean }) {
  return run((coachId) => scheduleEndOfTraining(input, { coachId }))
}

export async function endTrainingNowAction(input: { playerId: string; stopFees: boolean }) {
  return run((coachId) => {
    endTrainingNow(input, { coachId })
    return true
  })
}

export async function cancelTrainingChangeAction(input: { changeId: string }) {
  return run((coachId) => {
    cancelTrainingChange(input, { coachId })
    return true
  })
}

export async function previewScheduleChangeAction(input: { playerId: string; startsOn: string }) {
  const coach = await requireHeadAdminAction()
  return previewScheduleChange(input, { coachId: coach.subjectId })
}

export async function changeMonthlyFeeAction(
  input: { idempotencyKey: string; monthlyFeePaise: number; playerId: string },
) {
  return run((coachId) => changeMonthlyFee(input, { coachId }))
}

export async function giveConcessionAction(input: GiveConcessionInput) {
  return run((coachId) => giveConcession(input, { coachId }))
}

export async function stopConcessionAction(
  input: { concessionId: string; expectedRevision: number; mutationId: string },
) {
  return run((coachId) => {
    stopConcession(input, { coachId })
    return true
  })
}

/** "Stop fees" for a player on no schedule with a fee plan still kept. */
export async function stopFeePlanAction(input: { playerId: string }) {
  return run((coachId) => stopFeePlan(input, { coachId }))
}

/** "Cancel this fee change" for a fee change waiting for next month. */
export async function cancelFeeChangeAction(
  input: { agreementId: string; expectedRevision: number; playerId: string },
) {
  return run((coachId) => cancelFeeChange(input, { coachId }))
}

/** Dismisses the notice a booked change that did not happen left on the record. */
export async function dismissTrainingNoticeAction(input: { playerId: string }) {
  return run((coachId) => {
    dismissTrainingNotice(input, { coachId })
    return true
  })
}
