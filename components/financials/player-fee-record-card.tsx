import Link from "next/link"
import { ArrowRight, ReceiptText } from "lucide-react"

import { Reveal } from "@/components/reveal"
import type { PlayerFinanceDashboardSummary } from "@/lib/finance/types"
import { dashboardFeeRecordCopy } from "@/components/financials/player-finance-presentation"
import styles from "@/components/financials/player-financials.module.css"

export function PlayerFeeRecordCard({
  summary,
}: {
  summary: PlayerFinanceDashboardSummary | null
}) {
  const copy = dashboardFeeRecordCopy(summary)

  return (
    <Reveal className={`${styles.dashboardCard} dashboard-card`} delay={0.1}>
      <Link className={styles.dashboardLink} href="/player/financials">
        <span className={styles.dashboardIcon} aria-hidden="true">
          <ReceiptText />
        </span>
        <div className={styles.dashboardCopy}>
          <p className={styles.dashboardEyebrow}>Fee record</p>
          <h3>{copy.status}</h3>
          <span>{copy.detail}</span>
        </div>
        <span className={styles.dashboardArrow} aria-hidden="true">
          <ArrowRight />
        </span>
      </Link>
    </Reveal>
  )
}
