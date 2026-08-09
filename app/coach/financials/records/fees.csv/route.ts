import { isValidMonthKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { createFeeRegisterCsvStream } from "@/lib/finance/records-csv"
import { FinanceServiceError, getFeeRegister } from "@/lib/finance/service"
import type {
  FinancePlayerScope,
  FinanceRegisterInput,
  FinanceRegisterResult,
  FinanceStatus,
} from "@/lib/finance/types"

export const runtime = "nodejs"

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const

const STATUSES: FinanceStatus[] = [
  "setup_required",
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "not_prepared",
  "void",
]

function allRows(
  first: FinanceRegisterResult,
  input: FinanceRegisterInput,
  coachId: string,
) {
  return (function* generateRows() {
    let page = first
    const seen = new Set<string>()
    while (true) {
      yield* page.rows
      if (!page.nextCursor || seen.has(page.nextCursor)) return
      seen.add(page.nextCursor)
      page = getFeeRegister({ ...input, cursor: page.nextCursor, limit: 100 }, { coachId })
    }
  })()
}

export async function GET(request: Request) {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "coach") {
    return new Response("Authentication required.", { headers: privateHeaders, status: 401 })
  }
  try {
    requireHeadAdminAccess(identity.subjectId)
  } catch {
    return new Response("Head coach access is required.", {
      headers: privateHeaders,
      status: 403,
    })
  }

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
    return new Response("Choose a valid fee month.", { headers: privateHeaders, status: 400 })
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
    const suffix = mode === "monthly" ? period : "registration"
    return new Response(createFeeRegisterCsvStream(allRows(first, input, identity.subjectId)), {
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="smba-fee-register-${suffix}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    })
  } catch (error) {
    if (error instanceof FinanceServiceError) {
      return new Response(error.message, {
        headers: privateHeaders,
        status: error.code === "AUTHORIZATION" ? 403 : 400,
      })
    }
    console.error("Financial fee-register export failed.", { mode, period })
    return new Response("Unable to generate the fee-register export.", {
      headers: privateHeaders,
      status: 500,
    })
  }
}
