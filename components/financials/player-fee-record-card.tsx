import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { Reveal } from "@/components/reveal"
import type { PlayerFinanceDashboardSummary } from "@/lib/finance/types"
import {
  dashboardFeeRecordCopy,
  financeStatusLabel,
} from "@/components/financials/player-finance-presentation"

export function PlayerFeeRecordCard({
  summary,
}: {
  summary: PlayerFinanceDashboardSummary | null
}) {
  const copy = dashboardFeeRecordCopy(summary)
  const context = !summary
    ? "Unavailable"
    : summary.currentBalancePaise === 0
      ? "Up to date"
      : financeStatusLabel(summary.status)

  return (
    <Reveal
      className="dashboard-card player-ticket-card player-ticket-record-card player-ticket-fee"
      delay={0.1}
    >
      <header className="player-ticket-masthead">
        <h3 className="player-ticket-title">Fee record</h3>
        <span className="player-ticket-context">{context}</span>
      </header>
      <div className="player-ticket-record-primary">
        <strong className="player-ticket-record-value">{copy.status}</strong>
        <p className="player-ticket-record-copy">{copy.detail}</p>
      </div>
      <Link className="player-ticket-action" href="/player/financials">
        <span>Open fee record</span>
        <ArrowUpRight aria-hidden="true" />
      </Link>
    </Reveal>
  )
}
