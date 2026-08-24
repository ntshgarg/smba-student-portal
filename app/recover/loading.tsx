import { RouteLoadingState } from "@/components/route-recovery"

export default function RecoverLoading() {
  return (
    <RouteLoadingState
      eyebrow="Account recovery"
      status="Loading account recovery…"
      title="Opening password reset…"
    />
  )
}
