import { RouteLoadingState } from "@/components/route-recovery"

export default function AuthLoading() {
  return (
    <RouteLoadingState
      eyebrow="Secure access"
      status="Loading secure access…"
      title="Checking your account…"
    />
  )
}
