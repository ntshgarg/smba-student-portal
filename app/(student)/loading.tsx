import { RouteLoadingState } from "@/components/route-recovery"

export default function PlayerLoading() {
  return (
    <RouteLoadingState
      eyebrow="Player Journal"
      status="Loading your Player Journal…"
      title="Opening your journal…"
    />
  )
}
