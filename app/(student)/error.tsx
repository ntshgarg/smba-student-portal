"use client"

import { RouteErrorState } from "@/components/route-recovery"

export default function PlayerError({ reset }: { reset: () => void }) {
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
