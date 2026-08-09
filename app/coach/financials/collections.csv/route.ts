import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { createCollectionCsvStream } from "@/lib/finance/collections-csv"
import {
  FinanceServiceError,
  getCollectionsDayBook,
} from "@/lib/finance/service"
import type { FinanceDayBookInput, FinanceDayBookResult } from "@/lib/finance/types"

export const runtime = "nodejs"

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const

function allEvents(first: FinanceDayBookResult, input: FinanceDayBookInput, coachId: string) {
  return (function* generateEvents() {
    let page = first
    const seen = new Set<string>()
    while (true) {
      yield* page.events
      if (!page.nextCursor || seen.has(page.nextCursor)) return
      seen.add(page.nextCursor)
      page = getCollectionsDayBook({ ...input, cursor: page.nextCursor, limit: 100 }, { coachId })
    }
  })()
}

export async function GET(request: Request) {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "coach") {
    return new Response("Authentication required.", {
      headers: privateHeaders,
      status: 401,
    })
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
    const rows = (function* collectionRows() {
      for (const event of allEvents(first, input, identity.subjectId)) yield {
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

    return new Response(createCollectionCsvStream(rows), {
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="smba-collections-${from}-to-${to}.csv"`,
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
    console.error("Financial collections export failed.", {
      from,
      to,
    })
    return new Response("Unable to generate the collections export.", {
      headers: privateHeaders,
      status: 500,
    })
  }
}
