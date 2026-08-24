import { listActiveHomepageAnnouncements } from "@/lib/announcements/queries"
import { describeFailureCause } from "@/lib/telemetry/failure-cause"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const publicResponseHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
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
