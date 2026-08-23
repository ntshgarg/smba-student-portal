import { RouteLoadingState } from "@/components/route-recovery"

export default function PublicAnnouncementLoading() {
  return (
    <RouteLoadingState
      eyebrow="From the academy"
      status="Loading the announcement…"
      title="Opening this notice…"
    />
  )
}
