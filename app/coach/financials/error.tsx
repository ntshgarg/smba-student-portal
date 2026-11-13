"use client"

import { ArrowLeft, CircleAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

import styles from "@/components/coach/financials/financials.module.css"
import { useErrorReport } from "@/lib/telemetry/use-error-report"

export default function CoachFinancialsError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useErrorReport("coach_financials", error)
  const router = useRouter()
  const [, startRetry] = useTransition()

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>
      <header className={styles.activationHeader}>
        <span className="eyebrow">Academy operations</span>
        <h1>Financials</h1>
        <p>Track fees clearly, one player at a time.</p>
      </header>
      <section className={styles.routeState} role="alert">
        <CircleAlert aria-hidden="true" />
        <h2>Financials are unavailable.</h2>
        <p>This workspace could not be loaded just now. No financial information has been changed.</p>
        <button
          type="button"
          onClick={() => startRetry(() => {
            router.refresh()
            reset()
          })}
        >
          Try again
        </button>
      </section>
    </div>
  )
}
