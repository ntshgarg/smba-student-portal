import type { SessionSummaryResponse } from "@/lib/auth/session-summary"
import { sessionProvider } from "@/lib/data"

export const runtime = "nodejs"

const privateResponseHeaders = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const

function summaryResponse(body: SessionSummaryResponse, status = 200) {
  return Response.json(body, {
    headers: privateResponseHeaders,
    status,
  })
}

export async function GET() {
  try {
    const identity = await sessionProvider.getCurrentIdentity()
    if (!identity) return summaryResponse({ status: "anonymous" })

    return summaryResponse({
      status: "authenticated",
      account: {
        name: identity.fullName,
        initials: identity.initials,
        role: identity.role,
      },
    })
  } catch {
    console.error("Session summary lookup failed.")
    return summaryResponse({ status: "unavailable" }, 503)
  }
}
