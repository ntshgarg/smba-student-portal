import { listActiveHomepageAnnouncements } from "@/lib/announcements/queries"

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
  } catch {
    console.error("Public announcement lookup failed.")
    return Response.json({ announcements: [] }, { headers: publicResponseHeaders })
  }
}
