import { isValidMonthKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { createFeeRegisterCsvStream } from "@/lib/finance/records-csv"
import { getFeeRegister } from "@/lib/finance/service"
import type {
  FinancePlayerScope,
  FinanceRegisterInput,
  FinanceStatus,
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

const STATUSES: FinanceStatus[] = [
  "setup_required",
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "not_prepared",
  "void",
]

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
  const mode = url.searchParams.get("mode") === "registration" ? "registration" : "monthly"
  const period = url.searchParams.get("period") ?? undefined
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120)
  const scopeValue = url.searchParams.get("scope")
  const playerScope: FinancePlayerScope = scopeValue === "archived" || scopeValue === "all"
    ? scopeValue
    : "active"
  const statusValue = url.searchParams.get("status")
  const statuses = STATUSES.includes(statusValue as FinanceStatus)
    ? [statusValue as FinanceStatus]
    : undefined

  if (mode === "monthly" && (!period || !isValidMonthKey(period))) {
    return privateDownloadResponse("Choose a valid fee month.", 400)
  }

  const input: FinanceRegisterInput = {
    mode,
    period: mode === "monthly" ? period : undefined,
    playerScope,
    query,
    statuses,
  }

  try {
    const first = getFeeRegister({ ...input, limit: 100 }, { coachId: identity.subjectId })
    const rows = drainCursorPages(
      first,
      (page) => page.rows,
      (cursor) => getFeeRegister(
        { ...input, cursor, limit: 100 },
        { coachId: identity.subjectId },
      ),
    )
    const suffix = mode === "monthly" ? period : "registration"

    // `rows` is drained by the stream, so every page after the first fails
    // outside this `try`. `financeExportTruncation` is that `catch`'s mid-stream
    // twin: the same context reaches the log, and the same reading of a refusal
    // against a fault reaches the coach, in the file's own last line.
    return privateAttachmentResponse(
      createFeeRegisterCsvStream(rows, financeExportTruncation({
        context: { mode, period },
        label: "Financial fee-register export stopped before its last row.",
      })),
      {
        contentType: "text/csv; charset=utf-8",
        fileName: `smba-fee-register-${suffix}.csv`,
      },
    )
  } catch (error) {
    return financeDownloadRejection(error) ?? downloadFailureResponse(error, {
      context: { mode, period },
      label: "Financial fee-register export failed.",
      message: "Unable to generate the fee-register export.",
    })
  }
}
