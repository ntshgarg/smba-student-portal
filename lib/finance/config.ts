import type { AcademyPlan } from "@/lib/training/academy-plans"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

export const REGISTRATION_FEE_PAISE = 100_000
export const DEFAULT_MONTHLY_DUE_DAY = 5

export const monthlyFeePaise = {
  Beginner: {
    "weekday-3-day": 350_000,
    "weekday-4-day": 400_000,
    "weekday-5-day": 450_000,
    "weekend-standard": 300_000,
  },
  Intermediate: {
    "weekday-3-day": 600_000,
    "weekday-4-day": 650_000,
    "weekday-5-day": 700_000,
    "weekend-standard": 500_000,
  },
  Advanced: {
    "weekday-5-day": 1_250_000,
    "weekend-standard": 700_000,
  },
  Adult: {
    "weekday-3-day": 400_000,
    "weekday-4-day": 450_000,
    "weekday-5-day": 500_000,
    "weekend-standard": 350_000,
  },
} as const satisfies Record<TrainingProgramme, Partial<Record<AcademyPlan, number>>>

export function defaultMonthlyFeePaise({
  academyPlan,
  batch,
  level,
}: {
  academyPlan: AcademyPlan
  batch: TrainingBatch
  level: TrainingProgramme
}) {
  if ((batch === "Weekend") !== (academyPlan === "weekend-standard")) return null
  return (monthlyFeePaise[level] as Partial<Record<AcademyPlan, number>>)[academyPlan] ?? null
}
