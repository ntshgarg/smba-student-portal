"use client"

import { RouteErrorState } from "@/components/route-recovery"
import { useErrorReport } from "@/lib/telemetry/use-error-report"

export default function PlayerError({ error, reset }: { error: Error; reset: () => void }) {
  useErrorReport("student", error)

  return (
    <RouteErrorState
      body="Try loading it again. If the problem continues, return to the Player Dashboard."
      eyebrow="Player Journal"
      onRetry={reset}
      returnHref="/player"
      returnLabel="Back to dashboard"
      title="Something went wrong."
    />
  )
}
