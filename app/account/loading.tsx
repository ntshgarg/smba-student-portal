import { RouteLoadingState } from "@/components/route-recovery"

export default function AccountLoading() {
  return (
    <RouteLoadingState
      eyebrow="Account security"
      status="Loading account security…"
      title="Opening your account…"
    />
  )
}
