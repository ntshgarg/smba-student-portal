import type { CoachMonthlyReportRecord } from "@/lib/coach/types"

export const REPORT_TEXT_MAX_LENGTH = 5_000

export type ReportMutationCode =
  | "INVALID_INPUT"
  | "PLAYER_UNAVAILABLE"
  | "ADJUSTMENT_REVIEW_REQUIRED"
  | "PUBLICATION_CONFLICT"

export type ReportMutationField = "month" | "playerId" | "reportText"

export type SaveReportDraftInput = {
  month: string
  playerId: string
  reportText: string
}

export type PublishReportInput = SaveReportDraftInput & {
  confirmAdjustmentReview?: boolean
  publicationKey: string
}

export type ReportMutationResult =
  | { ok: true; report: CoachMonthlyReportRecord }
  | {
      ok: false
      code: ReportMutationCode
      field?: ReportMutationField
      message: string
    }
