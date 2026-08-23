"use server"

import { revalidatePath } from "next/cache"

import {
  OperationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { initializeDatabase } from "@/lib/db/client"
import {
  resetOnboardingSessionAssignment,
  saveOnboardingAssessment,
  type SaveOnboardingAssessmentInput,
} from "@/lib/coach/onboarding-service"
import { assignSessionRecords } from "@/lib/sessions/service"

function revalidateOnboarding() {
  revalidatePath("/coach")
  revalidatePath("/coach/onboarding")
  revalidatePath("/coach/schedules")
  revalidatePath("/coach/members")
  revalidatePath("/player")
}

export async function resetOnboardingSessionAssignmentAction(
  playerId: string,
): Promise<OperationalActionResult<{ playerId: string }>> {
  const coach = await requireHeadAdminAction()

  try {
    const result = resetOnboardingSessionAssignment({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      playerId,
    })
    revalidateOnboarding()
    return { ok: true, data: { playerId: result.playerId } }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return operationalActionFailure(error)
    }
    throw error
  }
}

export async function saveOnboardingAssessmentAction(
  input: SaveOnboardingAssessmentInput,
): Promise<OperationalActionResult<{ playerId: string }>> {
  const coach = await requireHeadAdminAction()

  try {
    const result = saveOnboardingAssessment({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      input,
    })
    revalidateOnboarding()
    return { ok: true, data: { playerId: result.playerId } }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return operationalActionFailure(error)
    }
    throw error
  }
}

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
    revalidateOnboarding()
    return { ok: true, data: { playerId: input.playerId } }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return operationalActionFailure(error)
    }
    throw error
  }
}
