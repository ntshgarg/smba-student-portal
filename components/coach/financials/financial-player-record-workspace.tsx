"use client"

import { ArrowLeft, Download, ReceiptIndianRupee } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

import { PlayerLedger } from "./player-ledger"
import recordsStyles from "./financial-records.module.css"
import financialStyles from "./financials.module.css"
import type { PlayerFinancialLedgerView } from "./types"

function recordPaymentHref(ledger: PlayerFinancialLedgerView) {
  const search = new URLSearchParams({
    player: ledger.playerId,
    query: ledger.academyId,
    scope: "outstanding",
  })
  return `/coach/financials/record?${search.toString()}`
}

export function FinancialPlayerRecordWorkspace({
  backHref,
  ledger,
  paymentPeriod,
  period,
}: {
  backHref: string
  ledger: PlayerFinancialLedgerView
  paymentPeriod: string
  period: string
}) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [ledger.playerId])
  const hasPayableBalance = ledger.charges.some((charge) => (
    charge.outstandingPaise > 0
      && (charge.type === "registration" || (charge.billingPeriod ?? paymentPeriod) <= paymentPeriod)
  ))

  return (
    <div className={`${financialStyles.workspace} ${financialStyles.recordsWorkspace} page-shell`}>
      <div className={financialStyles.backRow}>
        <Link href={backHref}><ArrowLeft aria-hidden="true" /> Back to Fee Records</Link>
      </div>

      <header className={recordsStyles.playerRecordHeader}>
        <div>
          <span className="eyebrow">Fee records</span>
          <h1>Player fee record</h1>
          <p>Review the player’s fee plan, charges, receipts and corrections.</p>
        </div>
        <div className={recordsStyles.playerRecordActions}>
          {hasPayableBalance && !ledger.archived ? (
            <Link href={recordPaymentHref(ledger)}>
              <ReceiptIndianRupee aria-hidden="true" /> Record payment
            </Link>
          ) : null}
          <a href={`/coach/financials/players/${ledger.playerId}/statement/download`}>
            <Download aria-hidden="true" /> Download statement
          </a>
        </div>
      </header>

      <div className={recordsStyles.playerRecordLedger}>
        <PlayerLedger
          focused
          ledger={ledger}
          period={period}
          showReceiptDownloads
        />
      </div>
    </div>
  )
}
