import { RouteLoadingState } from "@/components/route-recovery"

export default function CoachLoading() {
  return (
    <RouteLoadingState
      eyebrow="Coach Workspace"
      status="Loading Coach Workspace…"
      title="Opening your workspace…"
    />
  )
}
