import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { createActivityCsvStream } from "@/lib/finance/records-csv"
import { FinanceServiceError, getFinancialActivity } from "@/lib/finance/service"
import type {
  FinanceActivityInput,
  FinanceActivityResult,
  FinanceAuditEventType,
} from "@/lib/finance/types"

export const runtime = "nodejs"

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const

const EVENT_TYPES: FinanceAuditEventType[] = [
  "finance_activated",
  "fee_agreement_created",
  "fee_agreement_replaced",
  "fee_agreement_paused",
  "fee_agreement_ended",
  "charge_issued",
  "charge_voided",
  "monthly_fees_prepared",
  "payment_recorded",
  "payment_reversed",
  "refund_recorded",
  "refund_reversed",
  "concession_created",
  "concession_applied",
  "concession_application_reversed",
  "concession_reversed",
  "adjustment_created",
  "adjustment_reversed",
  "historical_reconciled",
]

function allItems(
  first: FinanceActivityResult,
  input: FinanceActivityInput,
  coachId: string,
) {
  return (function* generateItems() {
    let page = first
    const seen = new Set<string>()
    while (true) {
      yield* page.items
      if (!page.nextCursor || seen.has(page.nextCursor)) return
      seen.add(page.nextCursor)
      page = getFinancialActivity({ ...input, cursor: page.nextCursor, limit: 100 }, { coachId })
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
  const fromValue = url.searchParams.get("from") ?? ""
  const toValue = url.searchParams.get("to") ?? ""
  const from = fromValue && isValidDateKey(fromValue) ? fromValue : undefined
  const to = toValue && isValidDateKey(toValue) ? toValue : undefined
  if ((fromValue && !from) || (toValue && !to) || (from && to && from > to)) {
    return new Response("Choose a valid activity date range.", {
      headers: privateHeaders,
      status: 400,
    })
  }
  const eventValue = url.searchParams.get("eventType")
  const eventTypes = EVENT_TYPES.includes(eventValue as FinanceAuditEventType)
    ? [eventValue as FinanceAuditEventType]
    : undefined
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
    return new Response(createActivityCsvStream(allItems(first, input, identity.subjectId)), {
      headers: {
        ...privateHeaders,
        "Content-Disposition": "attachment; filename=\"smba-financial-activity.csv\"",
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
    console.error("Financial activity export failed.", { from, to })
    return new Response("Unable to generate the financial activity export.", {
      headers: privateHeaders,
      status: 500,
    })
  }
}
