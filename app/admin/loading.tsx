import { RouteLoadingState } from "@/components/route-recovery"

export default function AdminLoading() {
  return (
    <RouteLoadingState
      eyebrow="Platform owner"
      status="Loading the academy directory…"
      title="Opening oversight…"
    />
  )
}
