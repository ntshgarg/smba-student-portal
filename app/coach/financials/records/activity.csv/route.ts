import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { createActivityCsvStream } from "@/lib/finance/records-csv"
import { getFinancialActivity } from "@/lib/finance/service"
import {
  isFinanceAuditEventType,
  type FinanceActivityInput,
} from "@/lib/finance/types"
import {
  authorizeDownload,
  downloadFailureResponse,
  drainCursorPages,
  privateAttachmentResponse,
  privateDownloadResponse,
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
  const fromValue = url.searchParams.get("from") ?? ""
  const toValue = url.searchParams.get("to") ?? ""
  const from = fromValue && isValidDateKey(fromValue) ? fromValue : undefined
  const to = toValue && isValidDateKey(toValue) ? toValue : undefined
  if ((fromValue && !from) || (toValue && !to) || (from && to && from > to)) {
    return privateDownloadResponse("Choose a valid activity date range.", 400)
  }
  const eventValue = url.searchParams.get("eventType")
  const eventTypes = isFinanceAuditEventType(eventValue) ? [eventValue] : undefined
  const coachValue = url.searchParams.get("coachId")
  const input: FinanceActivityInput = {
    coachId: coachValue && coachValue !== "all" ? coachValue : undefined,
    eventTypes,
    from,
    query: (url.searchParams.get("q") ?? "").trim().slice(0, 120),
    to,
  }

  try {
    const first = getFinancialActivity({ ...input, limit: 100 }, {
      coachId: identity.subjectId,
    })
    const items = drainCursorPages(
      first,
      (page) => page.items,
      (cursor) => getFinancialActivity(
        { ...input, cursor, limit: 100 },
        { coachId: identity.subjectId },
      ),
    )

    return privateAttachmentResponse(
      createActivityCsvStream(items, financeExportTruncation({
        context: { from, to },
        label: "Financial activity export stopped before its last row.",
      })),
      {
        contentType: "text/csv; charset=utf-8",
        fileName: "smba-financial-activity.csv",
      },
    )
  } catch (error) {
    return financeDownloadRejection(error) ?? downloadFailureResponse(error, {
      context: { from, to },
      label: "Financial activity export failed.",
      message: "Unable to generate the financial activity export.",
    })
  }
}
