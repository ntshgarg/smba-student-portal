import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import styles from "@/components/financials/player-financials.module.css"

export default function PlayerFinancialsLoading() {
  return (
    <div className={`${styles.page} interior-page page-shell`} aria-busy="true">
      <div className={styles.toolbar}>
        <Link className="back-link" href="/player">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>
      <header className={styles.pageHeader}>
        <h1>Your fee record.</h1>
      </header>
      <p className="sr-only" role="status">Loading your fee record.</p>
      <div className={styles.loadingOverview} aria-hidden="true" />
      <div className={styles.loadingSection} aria-hidden="true" />
    </div>
  )
}
