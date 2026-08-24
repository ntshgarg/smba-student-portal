import {
  CsvExportValueError,
  type ExportTruncation,
} from "@/lib/finance/csv-truncation"
import { FinanceServiceError } from "@/lib/finance/service"
import {
  exportTruncationLog,
  privateDownloadResponse,
} from "@/lib/http/download-route"

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

/**
 * What `financeDownloadRejection` does once the response has already gone out.
 *
 * A finance export streams, so only its first page is read inside the handler's
 * `try`; every later page is pulled after 200 and the filename are on the wire.
 * The same three outcomes still arrive there, and flattening them into one
 * "run it again" is how a coach ends up retrying a file that will stop in the
 * same place every time:
 *
 * - A `FinanceServiceError` is a decided refusal, and the service reruns
 *   `requireCoach`, `requireFinanceActive` and cursor validation on every page,
 *   so it can be decided mid-export -- a cursor row that has left the re-read
 *   result set raises one. Its message is already written for a coach, and
 *   discarding it mid-stream would lose the only account of why the file stops.
 * - A `CsvExportValueError` is a row this export cannot write. Running it again
 *   reaches the same row, so the notice says so rather than asking.
 * - Anything else is a fault of the moment -- a locked database, a dropped
 *   connection -- and a retry is the coach's best move.
 *
 * The log runs for all three: the coach is told what to do, an operator is told
 * what happened.
 */
export function financeExportTruncation(failure: {
  context?: Record<string, unknown>
  label: string
}): ExportTruncation {
  const log = exportTruncationLog(failure)

  return (error, rowsWritten) => {
    log(error, rowsWritten)
    if (error instanceof FinanceServiceError) return error.message
    if (error instanceof CsvExportValueError) {
      return "The next record holds an amount this file cannot write, so the "
        + "export stops there. Running it again will not help; the ledger entry "
        + "has to be corrected first."
    }
    return "Run the export again."
  }
}
