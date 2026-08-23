import { RouteLoadingState } from "@/components/route-recovery"

export default function ActivateLoading() {
  return (
    <RouteLoadingState
      eyebrow="Private account setup"
      status="Loading account setup…"
      title="Opening your account…"
    />
  )
}
