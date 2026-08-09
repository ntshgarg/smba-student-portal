"use client"

import { RouteErrorState } from "@/components/route-recovery"

export default function AppError({ reset }: { reset: () => void }) {
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
