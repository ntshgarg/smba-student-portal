"use server"

import { revalidatePath } from "next/cache"

import {
  OperationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { initializeDatabase } from "@/lib/db/client"
import { assignSessionRecords } from "@/lib/sessions/service"

export async function assignOnboardingSessionAction(input: {
  effectiveFrom: string
  playerId: string
  seriesId: string
  weekdays: number[]
}): Promise<OperationalActionResult<{ playerId: string }>> {
  const coach = await requireHeadAdminAction()

  try {
    assignSessionRecords({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      ...input,
      now: new Date(),
    })
    revalidatePath("/coach")
    revalidatePath("/coach/onboarding")
    revalidatePath("/coach/schedules")
    revalidatePath("/coach/members")
    revalidatePath("/player")
    return { ok: true, data: { playerId: input.playerId } }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return operationalActionFailure(error)
    }
    throw error
  }
}
