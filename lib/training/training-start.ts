/**
 * A confirmed training start date may be backdated so that a player who began
 * before the academy recorded them is billed and marked from the day they
 * actually started. Coverage of every intervening month used to bound that
 * backfill, but a paused player legitimately has months no assignment covers,
 * so the bound is stated here instead of being inferred from assignments.
 */
export const MAX_TRAINING_START_BACKFILL_MONTHS = 24

export const IMPLAUSIBLE_TRAINING_START_MESSAGE = "Choose a training start date within the last "
  + `${MAX_TRAINING_START_BACKFILL_MONTHS} months.`

function monthOrdinal(dateKey: string) {
  return Number(dateKey.slice(0, 4)) * 12 + Number(dateKey.slice(5, 7))
}

export function trainingStartBackfillMonths(trainingStartOn: string, referenceDateKey: string) {
  return monthOrdinal(referenceDateKey) - monthOrdinal(trainingStartOn)
}

export function trainingStartIsImplausiblyEarly(
  trainingStartOn: string,
  referenceDateKey: string,
) {
  return trainingStartBackfillMonths(trainingStartOn, referenceDateKey)
    > MAX_TRAINING_START_BACKFILL_MONTHS
}
