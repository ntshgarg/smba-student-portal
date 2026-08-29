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
  },
  Adult: {
    "weekday-3-day": 400_000,
    "weekday-4-day": 450_000,
    "weekday-5-day": 500_000,
    "weekend-standard": 350_000,
  },
  /*
   * Deliberately empty. Elite terms are individual -- sponsored, funded or
   * negotiated -- so there is no rate to default to and none to publish. The
   * coach enters the agreed fee for each player during onboarding, which is how
   * every level already works: the onboarding form never reads this table.
   *
   * `defaultMonthlyFeePaise` therefore returns null for Elite. That is a
   * supported answer, not a failure -- see `enrollmentDefaults` in
   * lib/finance/repository.ts, which carries the enrolment facts whether or not
   * a suggestion exists.
   */
  Elite: {},
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
