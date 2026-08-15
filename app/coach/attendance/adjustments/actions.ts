"use server"

import { revalidatePath } from "next/cache"

import {
  publishMakeupAttendanceAdjustment,
  voidAttendanceAdjustment,
} from "@/lib/attendance/adjustments"
import {
  OperationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"

async function requireCoach() {
  return requireHeadAdminAction()
}

function runOperationalAction<T>(operation: () => T): OperationalActionResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return operationalActionFailure(error)
    }
    throw error
  }
}

function revalidateAttendanceSurfaces() {
  revalidatePath("/coach")
  revalidatePath("/coach/attendance/players/register")
  revalidatePath("/coach/attendance/players/record")
  revalidatePath("/coach/attendance/adjustments")
  revalidatePath("/coach/reports")
  revalidatePath("/coach/reports/write")
  revalidatePath("/player")
  revalidatePath("/player/reports")
}

export async function publishAttendanceAdjustmentAction(input: {
  completionOccurrenceId: string
  playerId: string
  sourceOccurrenceId: string
  reason?: string
}) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    const adjustment = publishMakeupAttendanceAdjustment({
      ...input,
      coachId: coach.subjectId,
    })
    revalidateAttendanceSurfaces()
    return adjustment
  })
}

export async function voidAttendanceAdjustmentAction(adjustmentId: string) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    const adjustment = voidAttendanceAdjustment({
      adjustmentId,
      coachId: coach.subjectId,
    })
    revalidateAttendanceSurfaces()
    return adjustment
  })
}
