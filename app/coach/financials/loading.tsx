import { ArrowLeft } from "lucide-react"
import Link from "next/link"

import styles from "@/components/coach/financials/financials.module.css"

export default function CoachFinancialsLoading() {
  return (
    <div className={`${styles.workspace} page-shell`} aria-busy="true">
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>
      <header className={styles.activationHeader}>
        <span className="eyebrow">Academy operations</span>
        <h1>Financials</h1>
        <p>Track fees clearly, one player at a time.</p>
      </header>
      <p className="sr-only" role="status">Loading Financials.</p>
      <div className={styles.loadingSummary} aria-hidden="true" />
      <div className={styles.loadingWorkspace} aria-hidden="true" />
    </div>
  )
}
