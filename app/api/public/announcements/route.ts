import { listActiveHomepageAnnouncements } from "@/lib/announcements/queries"
import { describeFailureCause } from "@/lib/telemetry/failure-cause"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * No `stale-while-revalidate`. It used to carry 300 seconds, which made the worst
 * case for a withdrawal `s-maxage` plus that window -- six minutes of the CDN
 * handing out a notice the coach had already pulled. Withdrawal is the control a
 * coach reaches for the moment they realise a message named a child, so its cost
 * is measured in what a stranger can still read, not in origin hits. Without the
 * directive the ceiling is `s-maxage` alone: one minute. What that spends is one
 * synchronous read per minute at most -- `listActiveHomepageAnnouncements` is a
 * single indexed query, and `s-maxage` still collapses the traffic behind it.
 */
const publicResponseHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60",
  "X-Content-Type-Options": "nosniff",
} as const

export async function GET() {
  try {
    return Response.json({
      announcements: listActiveHomepageAnnouncements(),
    }, { headers: publicResponseHeaders })
  } catch (error) {
    console.error("Public announcement lookup failed.", {
      cause: describeFailureCause(error),
    })
    return Response.json({ announcements: [] }, { headers: publicResponseHeaders })
  }
}
