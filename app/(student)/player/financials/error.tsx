"use client"

import Link from "next/link"
import { ArrowLeft, CircleAlert } from "lucide-react"

import styles from "@/components/financials/player-financials.module.css"
import { useErrorReport } from "@/lib/telemetry/use-error-report"

export default function PlayerFinancialsError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useErrorReport("player_financials", error)

  return (
    <div className={`${styles.page} interior-page page-shell`}>
      <div className={styles.toolbar}>
        <Link className="back-link" href="/player">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>
      <header className={styles.pageHeader}>
        <h1>Your fee record.</h1>
      </header>
      <section className={`${styles.pageState} empty-state`} role="alert">
        <CircleAlert aria-hidden="true" />
        <h2>Fee record unavailable.</h2>
        <p>Your record could not be loaded just now. No financial information has been changed.</p>
        <button className={styles.retryButton} onClick={reset} type="button">Try again</button>
      </section>
    </div>
  )
}
