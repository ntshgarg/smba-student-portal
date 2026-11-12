/**
 * One "Requires review" flag is raised for several different reasons, and the
 * adjustments screen used to answer all of them with the same sentence about
 * checking the attendance on the completed date -- advice that is wrong after a
 * holiday, where the attendance is fine and the session simply no longer ran.
 *
 * Nothing records which reason raised the flag, so it is read back from the
 * facts the server reports for each flagged make-up (`describeAdjustmentReviews`
 * in lib/attendance/adjustments.ts) and the missed session's status. `presence`
 * is "unknown" only when those facts are missing.
 */
export type AdjustmentReviewCause =
  | "completion-cancelled"
  | "date-only"
  | "missed-cancelled"
  | "presence-removed"
  | "unclear"

/** What the server knows about one flagged make-up, whoever is selected. */
export type AdjustmentReviewFacts = {
  /** The completion session was cancelled, or for a date-only make-up its day was closed. */
  completionCancelled: boolean
  /** The Present it rests on is still there, exactly as "Keep" checks it. */
  hasPresence: boolean
}

export type AdjustmentReviewAdvice = {
  cause: AdjustmentReviewCause
  /** Whether "Keep make-up" can succeed: the server refuses it without a Present. */
  canKeep: boolean
  message: string
}

export function adjustmentReviewAdvice({
  completionCancelled,
  isDateOnly,
  missedCancelled,
  presence,
}: {
  completionCancelled: boolean
  isDateOnly: boolean
  missedCancelled: boolean
  presence: "missing" | "present" | "unknown"
}): AdjustmentReviewAdvice {
  if (presence === "missing") {
    if (completionCancelled) {
      return {
        cause: "presence-removed",
        canKeep: false,
        message: isDateOnly
          ? "This older make-up was recorded against a date that has since been closed as a holiday,"
            + " and the player has no Present mark that day it can rest on. Void the make-up."
          : "The player's Present mark on the session this make-up was completed at has been removed,"
            + " and that session has since been cancelled, so the mark cannot be put back. Void the make-up.",
      }
    }
    return {
      cause: "presence-removed",
      canKeep: false,
      message: isDateOnly
        ? "This older make-up was recorded against a date, and the player has no Present mark left that day"
          + " that another make-up is not already using. Mark them Present at a session that day, or void the make-up."
        : "The player's Present mark on the session this make-up was completed at has been removed."
          + " Mark them Present on that session again, or void the make-up.",
    }
  }
  if (completionCancelled) {
    return {
      cause: "completion-cancelled",
      canKeep: true,
      message: isDateOnly
        ? "The day this older make-up was completed on has since been closed as a holiday."
          + " Keep the make-up if the player did train that day, or void it."
        : "The session this make-up was completed at was cancelled afterwards, for example by an academy holiday."
          + " Keep the make-up if the player did train that day, or void it.",
    }
  }
  if (missedCancelled) {
    return {
      cause: "missed-cancelled",
      canKeep: true,
      message: "The missed session was cancelled afterwards, for example by an academy holiday,"
        + " so the absence no longer counts and may not need making up. Void the make-up if it is not needed, or keep it.",
    }
  }
  if (isDateOnly) {
    return {
      cause: "date-only",
      canKeep: true,
      message: "This older make-up was recorded against a date rather than a session."
        + " Keep it if the player trained on that date, or void it.",
    }
  }
  return {
    cause: "unclear",
    canKeep: true,
    message: "Check the attendance recorded on its completion date, then keep or void the make-up.",
  }
}
