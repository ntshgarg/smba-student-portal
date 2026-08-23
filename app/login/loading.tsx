import { RouteLoadingState } from "@/components/route-recovery"

export default function LoginLoading() {
  return (
    <RouteLoadingState
      eyebrow="SMBA portal"
      status="Loading portal login…"
      title="Opening the portal…"
    />
  )
}
