import { RouteLoadingState } from "@/components/route-recovery"

export default function RegisterLoading() {
  return (
    <RouteLoadingState
      eyebrow="Request access"
      status="Loading the registration request…"
      title="Opening registration…"
    />
  )
}
