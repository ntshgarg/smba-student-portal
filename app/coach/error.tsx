"use client"

import { RouteErrorState } from "@/components/route-recovery"

export default function CoachError({ reset }: { reset: () => void }) {
  return (
    <RouteErrorState
      body="Try loading it again. If the problem continues, return to the Coach Dashboard."
      eyebrow="Coach Workspace"
      onRetry={reset}
      returnHref="/coach"
      returnLabel="Back to dashboard"
      title="Something went wrong."
    />
  )
}
