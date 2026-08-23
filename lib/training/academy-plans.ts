import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

export type AcademyPlan =
  | "weekday-3-day"
  | "weekday-4-day"
  | "weekday-5-day"
  | "weekend-standard"

const academyPlanLabels: Record<AcademyPlan, string> = {
  "weekday-3-day": "3-day plan",
  "weekday-4-day": "4-day plan",
  "weekday-5-day": "5-day plan",
  "weekend-standard": "Weekend plan",
}

const academyPlanWeekdayLimits: Record<AcademyPlan, number> = {
  "weekday-3-day": 3,
  "weekday-4-day": 4,
  "weekday-5-day": 5,
  "weekend-standard": 2,
}

const weekdayPlans: AcademyPlan[] = [
  "weekday-3-day",
  "weekday-4-day",
  "weekday-5-day",
]

export function academyPlansFor(
  level: TrainingProgramme,
  batch: TrainingBatch,
): AcademyPlan[] {
  if (batch === "Weekend") return ["weekend-standard"]
  if (level === "Advanced") return ["weekday-5-day"]
  return weekdayPlans
}

export function academyPlanIsValid(
  plan: AcademyPlan | null,
  level: TrainingProgramme,
  batch: TrainingBatch,
) {
  return plan !== null && academyPlansFor(level, batch).includes(plan)
}

export function academyPlanLabel(plan: AcademyPlan | null) {
  return plan ? academyPlanLabels[plan] : "Needs review"
}

export function academyPlanAssignmentLimit(plan: AcademyPlan) {
  return academyPlanWeekdayLimits[plan]
}

export function academyPlanRequiredWeekdayCount(plan: AcademyPlan) {
  return plan === "weekend-standard" ? null : academyPlanWeekdayLimits[plan]
}

export function academyPlanSummary(batch: TrainingBatch, plan: AcademyPlan | null) {
  return `${batch} · ${academyPlanLabel(plan)}`
}
