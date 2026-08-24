import { requestSecurityContext } from "@/lib/auth/security-context"
import { getRawAuthSession } from "@/lib/auth/session"
import {
  MAX_CLIENT_ERROR_REPORT_BYTES,
  parseClientErrorReport,
} from "@/lib/telemetry/error-report"
import { recordClientErrorReport } from "@/lib/telemetry/record-client-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const

// Kept in memory rather than in auth_login_attempts on purpose: a database
// backed limiter would write a row for every request, which is the amplification
// this limit exists to prevent. Per instance is enough here -- it bounds the work
// one caller can cause, and the duplicate window in the write path bounds how
// many rows the table can gain regardless of how many instances are running.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_PER_WINDOW = 20
const RATE_LIMIT_TRACKED_KEYS = 2_000

const attempts = new Map<string, { count: number; windowStartedAt: number }>()

function withinRateLimit(key: string, now: number) {
  if (attempts.size > RATE_LIMIT_TRACKED_KEYS) attempts.clear()

  const current = attempts.get(key)
  if (!current || now - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    attempts.set(key, { count: 1, windowStartedAt: now })
    return true
  }

  current.count += 1
  return current.count <= RATE_LIMIT_PER_WINDOW
}

function reply(status: number) {
  return new Response(null, { headers: responseHeaders, status })
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function currentAccountId() {
  try {
    // The authenticated account, not the previewed subject. During admin preview
    // the session identity is impersonated, and a fault belongs to whoever was
    // actually at the keyboard.
    return (await getRawAuthSession())?.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Receives a sanitized client error report.
 *
 * No session is required. Requiring one would blind the portal on `/`, `/login`,
 * `/register` and `/recover` -- the pages a stranger reaches first and where a
 * break costs the academy the most. The endpoint is instead bounded on four
 * sides: a same-site check, a body size cap, a per-caller rate limit, and field
 * normalization that leaves a caller no way to control what is stored beyond a
 * fixed vocabulary, a route pattern and a hash.
 */
export async function POST(request: Request) {
  try {
    // Sent by every current browser, including sendBeacon, and not settable by
    // page script. A missing header is allowed so an intermediary that strips it
    // does not silence reporting entirely.
    if (request.headers.get("sec-fetch-site") === "cross-site") return reply(403)

    const declaredLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CLIENT_ERROR_REPORT_BYTES) {
      return reply(413)
    }

    const body = await request.text()
    if (Buffer.byteLength(body, "utf8") > MAX_CLIENT_ERROR_REPORT_BYTES) return reply(413)

    const { ipHash } = requestSecurityContext(request.headers)
    if (!withinRateLimit(ipHash, Date.now())) return reply(429)

    // A body that is not a report is accepted and dropped. Explaining the
    // rejection would only help someone probing the endpoint, and a rejected
    // report must never look retryable to the browser.
    const report = parseClientErrorReport(parseJson(body))
    if (!report) return reply(204)

    recordClientErrorReport({ accountId: await currentAccountId(), report })

    return reply(204)
  } catch {
    // The user is already looking at an error boundary. Never answer a failed
    // report with a failure the browser might act on.
    console.error("SMBA could not persist a sanitized client error report.")
    return reply(204)
  }
}
