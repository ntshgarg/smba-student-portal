import { RouteLoadingState } from "@/components/route-recovery"

export default function SetupLoading() {
  return (
    <RouteLoadingState
      eyebrow="One-time academy setup"
      status="Loading academy setup…"
      title="Opening secure setup…"
    />
  )
}
