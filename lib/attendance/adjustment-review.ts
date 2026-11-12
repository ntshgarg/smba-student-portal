/**
 * One "Requires review" flag is raised for several different reasons, and the
 * adjustments screen used to answer all of them with the same sentence about
 * checking the attendance on the completed date -- advice that is wrong after a
 * holiday, where the attendance is fine and the session simply no longer ran.
 *
 * Nothing records which reason raised the flag, so it is read back from what
 * the screen can see: the two sessions a make-up joins and whether the player
 * still holds the Present it rests on. `presence` is "unknown" when the screen
 * has not loaded that player's marks (the history lists every player, but marks
 * are only loaded for the one selected).
 */
export type AdjustmentReviewCause =
  | "completion-cancelled"
  | "date-only"
  | "missed-cancelled"
  | "presence-removed"
  | "unclear"

export type AdjustmentReviewAdvice = {
  cause: AdjustmentReviewCause
  /** Whether "Keep make-up" can succeed: the server refuses it without a Present. */
  canKeep: boolean
  message: string
}

type OccurrenceState = { status: "cancelled" | "scheduled" } | undefined

export function adjustmentReviewAdvice({
  completion,
  isDateOnly,
  presence,
  source,
}: {
  completion: OccurrenceState
  isDateOnly: boolean
  presence: "missing" | "present" | "unknown"
  source: OccurrenceState
}): AdjustmentReviewAdvice {
  if (presence === "missing") {
    return {
      cause: "presence-removed",
      canKeep: false,
      message: "The player's Present mark on the session this make-up was completed at has been removed."
        + " Mark them Present on that session again, or void the make-up.",
    }
  }
  if (completion?.status === "cancelled") {
    return {
      cause: "completion-cancelled",
      canKeep: true,
      message: "The session this make-up was completed at was cancelled afterwards, for example by an academy holiday."
        + " Keep the make-up if the player did train that day, or void it.",
    }
  }
  if (source?.status === "cancelled") {
    return {
      cause: "missed-cancelled",
      canKeep: true,
      message: "The missed session was cancelled afterwards, for example by an academy holiday,"
        + " so the absence may no longer need making up. Void the make-up if it is not needed, or keep it.",
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
