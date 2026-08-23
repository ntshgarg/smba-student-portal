"use client"

import { RouteErrorState } from "@/components/route-recovery"
import { useErrorReport } from "@/lib/telemetry/use-error-report"

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useErrorReport("root", error)

  return (
    <RouteErrorState
      body="Try loading it again. If the problem continues, return to the academy homepage."
      eyebrow="SMBA portal"
      onRetry={reset}
      returnHref="/"
      returnLabel="Return to academy"
      title="Something went wrong."
    />
  )
}
