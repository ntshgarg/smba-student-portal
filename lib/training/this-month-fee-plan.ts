/*
 * The sum behind "this month's fee changes too" when the head coach changes a
 * player's level, batch or plan this month before the fee is paid. Kept free of
 * server imports because the Members form runs the same sum for its
 * confirmation that the server runs to post the adjustment: the figure the
 * coach approves is the figure the family is billed.
 *
 * The month's fee is rebuilt from the fee as it stands now, not from the amount
 * first issued. Two things went wrong when it started from the issued amount:
 *
 * - A second change in the same month was scaled from the issued amount against
 *   a plan already holding the first change's fee, so ₹2,000 → ₹2,500 → ₹2,000
 *   left ₹2,100 due.
 * - A percentage concession stayed at its share of the old fee, so a 20% (or
 *   100%) concession no longer meant 20% (or 100%) of the new one.
 *
 * Fixed-amount concessions and every other adjustment stay as they are.
 */

/** Idempotency-key prefixes that mark the adjustments a schedule change posts. */
export const SCHEDULE_CHANGE_FEE_KEY = "schedule-change-adj:"
export const SCHEDULE_CHANGE_CONCESSION_KEY = "schedule-change-concession:"

export type ThisMonthFeeBasis = {
  /** What is due this month now, after every concession and adjustment. */
  amountPaise: number
  /** The plan fee this month's amount currently reflects. */
  feePaise: number
  /**
   * This month's fee before concessions and other adjustments: the issued
   * amount plus any schedule-change corrections already made this month.
   */
  grossPaise: number
  /** Percentage concessions on this month's fee, in basis points (2,000 = 20%). */
  percentages: number[]
  /** What those percentage concessions currently take off this month's fee. */
  percentageCreditPaise: number
}

function percentageShare(grossPaise: number, basisPoints: number) {
  // The same rounding as the concession itself (lib/finance/domain.ts).
  return Math.floor((grossPaise * basisPoints + 5_000) / 10_000)
}

export function planThisMonthFeeCorrection(basis: ThisMonthFeeBasis, newFeePaise: number) {
  if (!(basis.feePaise > 0) || newFeePaise === basis.feePaise) {
    return { concessionDeltaPaise: 0, grossDeltaPaise: 0, newAmountPaise: basis.amountPaise }
  }
  // A first month may have been charged for part of the month, so the new
  // amount keeps that same share of the new fee.
  const newGrossPaise = Math.round(basis.grossPaise * newFeePaise / basis.feePaise)
  const grossDeltaPaise = newGrossPaise - basis.grossPaise
  const concessionDeltaPaise = basis.percentages
    .reduce((total, value) => total + percentageShare(newGrossPaise, value), 0)
    - basis.percentageCreditPaise
  return {
    concessionDeltaPaise,
    grossDeltaPaise,
    newAmountPaise: Math.max(0, basis.amountPaise + grossDeltaPaise - concessionDeltaPaise),
  }
}
