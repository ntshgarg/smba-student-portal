"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { startTransition } from "react"

type RouteLoadingStateProps = {
  eyebrow: string
  status: string
  title: string
}

type RouteErrorStateProps = {
  body: string
  eyebrow: string
  onRetry: () => void
  returnHref: string
  returnLabel: string
  title: string
}

export function RouteLoadingState({
  eyebrow,
  status,
  title,
}: RouteLoadingStateProps) {
  return (
    <section
      className="route-recovery page-shell"
      aria-busy="true"
      aria-labelledby="route-recovery-title"
    >
      <div className="route-recovery-panel">
        <span className="route-recovery-mark" aria-hidden="true" />
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="route-recovery-title">{title}</h1>
        <p className="route-recovery-copy" role="status">{status}</p>
      </div>
    </section>
  )
}

export function RouteErrorState({
  body,
  eyebrow,
  onRetry,
  returnHref,
  returnLabel,
  title,
}: RouteErrorStateProps) {
  const router = useRouter()

  function retry() {
    startTransition(() => {
      router.refresh()
      onRetry()
    })
  }

  return (
    <section
      className="route-recovery page-shell"
      aria-labelledby="route-recovery-title"
      role="alert"
    >
      <div className="route-recovery-panel">
        <span className="route-recovery-mark" aria-hidden="true" />
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="route-recovery-title">{title}</h1>
        <p className="route-recovery-copy">{body}</p>
        <div className="route-recovery-actions">
          <button type="button" onClick={retry}>Try again</button>
          <Link href={returnHref}>{returnLabel}</Link>
        </div>
      </div>
    </section>
  )
}
