"use server"

import { revalidatePath } from "next/cache"

import type {
  AssessmentActionResult,
  DiscardAssessmentInput,
  SaveAssessmentInput,
} from "@/lib/assessments/contracts"
import { getCoachAssessment } from "@/lib/assessments/queries"
import {
  AssessmentServiceError,
  discardAssessmentDraft,
  publishAssessment,
  saveAssessmentDraft,
} from "@/lib/assessments/service"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"

function revalidateAssessments(playerId: string, assessmentId?: string) {
  revalidatePath("/coach/assessments")
  revalidatePath(`/coach/assessments/players/${playerId}`)
  revalidatePath("/player/reports")
  if (assessmentId) {
    revalidatePath(`/coach/assessments/${assessmentId}`)
    revalidatePath(`/player/reports/assessments/${assessmentId}`)
  }
}

function failure(error: AssessmentServiceError): AssessmentActionResult {
  return { ok: false, code: error.code, field: error.field, message: error.message }
}

function saved(
  assessmentId: string,
  coachId: string,
  playerId: string,
  message: string,
): AssessmentActionResult {
  const loaded = getCoachAssessment(assessmentId, coachId)
  if (!loaded) throw new Error("The saved assessment could not be reloaded.")
  revalidateAssessments(playerId, assessmentId)
  return { ok: true, assessment: loaded.assessment, message }
}

export async function saveAssessmentDraftAction(
  input: SaveAssessmentInput,
): Promise<AssessmentActionResult> {
  const coach = await requireHeadAdminAction()
  try {
    const { assessmentId } = saveAssessmentDraft(input, { coachId: coach.subjectId })
    return saved(assessmentId, coach.subjectId, input.playerId, "Draft saved")
  } catch (error) {
    if (error instanceof AssessmentServiceError) return failure(error)
    throw error
  }
}

export async function publishAssessmentAction(
  input: SaveAssessmentInput,
): Promise<AssessmentActionResult> {
  const coach = await requireHeadAdminAction()
  try {
    const { assessmentId } = publishAssessment(input, { coachId: coach.subjectId })
    return saved(assessmentId, coach.subjectId, input.playerId, "Assessment published")
  } catch (error) {
    if (error instanceof AssessmentServiceError) return failure(error)
    throw error
  }
}

export async function discardAssessmentDraftAction(
  input: DiscardAssessmentInput & { playerId: string },
): Promise<AssessmentActionResult> {
  const coach = await requireHeadAdminAction()
  try {
    discardAssessmentDraft({ assessmentId: input.assessmentId }, { coachId: coach.subjectId })
    revalidateAssessments(input.playerId)
    return { ok: true, discarded: true, message: "Draft discarded" }
  } catch (error) {
    if (error instanceof AssessmentServiceError) return failure(error)
    throw error
  }
}
