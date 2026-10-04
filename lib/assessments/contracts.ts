export type AssessmentStatus = "draft" | "published"

export type AssessmentErrorCode =
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
  | { ok: false; code: AssessmentErrorCode; field?: AssessmentField; message: string }
