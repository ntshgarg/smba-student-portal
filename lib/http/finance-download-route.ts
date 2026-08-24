import { FinanceServiceError } from "@/lib/finance/service"
import { privateDownloadResponse } from "@/lib/http/download-route"

// Kept apart from `download-route.ts` so the two report download routes, whose
// readers never raise a FinanceServiceError, do not pull the finance service in
// to build a response.

/**
 * Maps a decided finance-domain outcome onto a response, or returns null when
 * the failure is not one and the caller should fall through to a 500.
 *
 * A `FinanceServiceError` is a conclusion the finance service reached, not a
 * fault: `AUTHORIZATION` means the caller may not have this record, and every
 * other code means the request itself was refused. Neither is a 500, and the
 * service's own message is already written to be read by a coach.
 */
export function financeDownloadRejection(error: unknown) {
  if (!(error instanceof FinanceServiceError)) return null
  return privateDownloadResponse(
    error.message,
    error.code === "AUTHORIZATION" ? 403 : 400,
  )
}
