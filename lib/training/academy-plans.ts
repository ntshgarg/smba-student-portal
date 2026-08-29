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

/*
 * Competitive levels train five weekdays and nothing else. Advanced was already
 * five-day on weekdays, but the Weekend branch below used to be tested first, so
 * Advanced plus Weekend quietly resolved to the weekend plan -- and that plan had
 * a published price. Testing the level first removes the combination rather than
 * pricing it.
 */
const weekdayOnlyLevels = new Set<TrainingProgramme>(["Advanced", "Elite"])

/**
 * The batches a level can train in. Elite and Advanced offer only Weekday, so the
 * assessment form can narrow the choice instead of accepting a pair it will later
 * refuse.
 */
export function academyBatchesFor(level: TrainingProgramme): TrainingBatch[] {
  return weekdayOnlyLevels.has(level) ? ["Weekday"] : ["Weekday", "Weekend"]
}

export function academyPlansFor(
  level: TrainingProgramme,
  batch: TrainingBatch,
): AcademyPlan[] {
  // No plans rather than a fallback: an empty list makes `academyPlanIsValid`
  // reject the pair, so a weekend Elite cannot be saved by any route.
  if (weekdayOnlyLevels.has(level)) return batch === "Weekday" ? ["weekday-5-day"] : []
  if (batch === "Weekend") return ["weekend-standard"]
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
