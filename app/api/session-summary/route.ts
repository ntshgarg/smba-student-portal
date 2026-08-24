import type { SessionSummaryResponse } from "@/lib/auth/session-summary"
import { sessionProvider } from "@/lib/data"
import { describeFailureCause } from "@/lib/telemetry/failure-cause"

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
  } catch (error) {
    console.error("Session summary lookup failed.", {
      cause: describeFailureCause(error),
    })
    return summaryResponse({ status: "unavailable" }, 503)
  }
}
