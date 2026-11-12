export type AssessmentStatus = "draft" | "published"

export type AssessmentErrorCode =
  /**
   * Someone saved this assessment after this form last loaded or saved it. The
   * refusal carries when, so the coach can save again on purpose.
   */
  | "CHANGED_ELSEWHERE"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PLAYER_UNAVAILABLE"

export type AssessmentField =
  | "assessedOn"
  | "comments"
  | "improvements"
  | "playerId"
  | "ratings"
  | "strengths"

export type SaveAssessmentInput = {
  /** Absent the first time a coach saves; present once the assessment exists. */
  assessmentId?: string
  /**
   * The id the form chose for a brand-new assessment, sent with every save
   * until the server has confirmed one. A save repeated after a dropped
   * connection then finds the assessment the first attempt created instead of
   * making a second copy.
   */
  newAssessmentId?: string
  /**
   * How many published assessments the player had when this form opened. A
   * first publish, straight from a blank form or of a draft, is refused if
   * another has been published since, which is what a second tab or a second
   * device looks like. The refusal carries the new count, so publishing again
   * after the coach has been told goes through.
   */
  expectedPublishedCount?: number
  /**
   * A draft of this player's that the coach was told about when a first
   * publish was refused because of it. Publishing again with it set publishes
   * this one beside that draft, which is left as it is.
   */
  knownDraftId?: string
  /**
   * When the assessment was last saved, as this form knows it. A save is
   * refused if someone has saved a different version since, rather than
   * silently writing over it.
   */
  expectedUpdatedAt?: string
  assessedOn: string
  comments: string
  improvements: string
  playerId: string
  /** Skill key to a whole rating from 1 to 5. Unrated skills are absent. */
  ratings: Record<string, number>
  strengths: string
}

export type DiscardAssessmentInput = {
  assessmentId: string
}

/** What the pages and the form hold. Dates cross the server/client boundary as strings. */
export type AssessmentRecord = {
  assessedOn: string
  comments: string
  id: string
  improvements: string
  overall: number | null
  playerId: string
  playerName: string
  publishedAt: string | null
  ratings: Record<string, number>
  revision: number
  status: AssessmentStatus
  strengths: string
  updatedAt: string
}

export type AssessmentActionResult =
  | { ok: true; assessment: AssessmentRecord; message: string }
  | { ok: true; discarded: true; message: string }
  | {
    ok: false
    code: AssessmentErrorCode
    /** What the assessment is now, when a refusal is because it changed elsewhere. */
    currentStatus?: AssessmentStatus
    /** When the assessment was last saved, when a refusal is because it changed elsewhere. */
    currentUpdatedAt?: string
    /** How many published assessments the player has now, when a first publish was refused for it. */
    currentPublishedCount?: number
    /** The player's other draft, when a new assessment was refused because of it. */
    currentDraftId?: string
    field?: AssessmentField
    message: string
  }

/** The most recent published assessment before another, for "last time" and for change. */
export type PreviousAssessment = {
  assessedOn: string
  overall: number | null
  ratings: Record<string, number>
}

/**
 * A published assessment the form might compare against, newest first.
 * `createdBefore` says whether it was written before the one being edited (always
 * true for a new form), which settles the order of two on the same date.
 */
export type PreviousAssessmentOption = PreviousAssessment & {
  createdBefore: boolean
  id: string
}

/**
 * The comparison for an assessment dated `assessedOn`: the latest published one
 * dated earlier, or on the same date but written earlier. Without the second
 * condition two assessments on one date each counted the other as "previous".
 * `selfId` is the assessment being edited, never its own "previous": a new
 * form's list is read before the form's first publish and re-read after it,
 * and the second read includes the assessment the form has just published.
 */
export function previousForDate(
  options: readonly PreviousAssessmentOption[],
  assessedOn: string,
  selfId: string | null = null,
): PreviousAssessment | null {
  const found = options.find((option) => option.id !== selfId && (
    option.assessedOn < assessedOn || (option.assessedOn === assessedOn && option.createdBefore)
  ))
  return found
    ? { assessedOn: found.assessedOn, overall: found.overall, ratings: found.ratings }
    : null
}
