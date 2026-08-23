"use client"

import { RouteErrorState } from "@/components/route-recovery"
import { useErrorReport } from "@/lib/telemetry/use-error-report"

export default function CoachError({ error, reset }: { error: Error; reset: () => void }) {
  useErrorReport("coach", error)

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
