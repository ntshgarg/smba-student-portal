import { RouteLoadingState } from "@/components/route-recovery"

export default function LoginLoading() {
  return (
    <RouteLoadingState
      eyebrow="Sign in"
      status="Loading portal login…"
      title="Opening the portal…"
    />
  )
}
