"use server"

import { revalidatePath } from "next/cache"

import {
  OperationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getAcademyDateKey } from "@/lib/format"
import {
  cancelTrainingChange,
  changeScheduleThisMonth,
  endTrainingNow,
  nextMonthStartOf,
  previewScheduleChange,
  scheduleEndOfTraining,
  scheduleTrainingChange,
  type ChangeThisMonthInput,
} from "@/lib/training/changes"
import {
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
export async function changeScheduleAction(input: ChangeThisMonthInput) {
  return run((coachId) => {
    if (input.startsOn === nextMonthStartOf(getAcademyDateKey(academyNow()))) {
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
