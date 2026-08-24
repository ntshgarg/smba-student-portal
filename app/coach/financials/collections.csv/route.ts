import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { createCollectionCsvStream } from "@/lib/finance/collections-csv"
import { getCollectionsDayBook } from "@/lib/finance/service"
import type { FinanceDayBookInput } from "@/lib/finance/types"
import {
  authorizeDownload,
  downloadFailureResponse,
  drainCursorPages,
  privateAttachmentResponse,
} from "@/lib/http/download-route"
import {
  financeDownloadRejection,
  financeExportTruncation,
} from "@/lib/http/finance-download-route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const access = authorizeDownload(
    await sessionProvider.getCurrentIdentity(),
    "coach",
    {
      check: (coach) => requireHeadAdminAccess(coach.subjectId),
      deniedMessage: "Head coach access is required.",
    },
  )
  if (!access.allowed) return access.rejection
  const { identity } = access

  const url = new URL(request.url)
  const from = url.searchParams.get("from") ?? ""
  const to = url.searchParams.get("to") ?? ""
  const includeReversed = ["1", "true", "on"].includes(
    url.searchParams.get("includeReversed") ?? "",
  )
  const input: FinanceDayBookInput = { from, to, includeReversed }

  try {
    const first = getCollectionsDayBook(
      { ...input, limit: 100 },
      { coachId: identity.subjectId },
    )
    const events = drainCursorPages(
      first,
      (page) => page.events,
      (cursor) => getCollectionsDayBook(
        { ...input, cursor, limit: 100 },
        { coachId: identity.subjectId },
      ),
    )
    const rows = (function* collectionRows() {
      for (const event of events) yield {
        academyId: event.academyId,
        amountPaise: event.amountPaise,
        coveredFeeReferences: event.coveredFeeReferences,
        eventDate: event.eventDate,
        eventType: event.eventType,
        lifecycle: event.lifecycle,
        method: event.method,
        playerName: event.playerFullName,
        reference: event.reference,
      }
    })()

    return privateAttachmentResponse(
      createCollectionCsvStream(rows, financeExportTruncation({
        context: { from, to },
        label: "Financial collections export stopped before its last row.",
      })),
      {
        contentType: "text/csv; charset=utf-8",
        fileName: `smba-collections-${from}-to-${to}.csv`,
      },
    )
  } catch (error) {
    return financeDownloadRejection(error) ?? downloadFailureResponse(error, {
      context: { from, to },
      label: "Financial collections export failed.",
      message: "Unable to generate the collections export.",
    })
  }
}
