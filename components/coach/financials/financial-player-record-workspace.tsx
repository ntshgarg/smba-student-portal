"use client"

import { ArrowLeft, Download } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

import { PlayerLedger } from "./player-ledger"
import styles from "./fees.module.css"
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
  canRecordPayment,
  ledger,
  period,
}: {
  backHref: string
  /**
   * Whether the payment desk opens this player, by the desk's own rule
   * (lib/finance/service.ts canRecordPaymentAtDesk). Worked out here from the
   * balance, it could offer "Record payment" for a player the desk then
   * turned away, landing the coach on an empty desk with no word why.
   */
  canRecordPayment: boolean
  ledger: PlayerFinancialLedgerView
  period: string
}) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [ledger.playerId])

  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.back}>
        <Link href={backHref}><ArrowLeft aria-hidden="true" /> Back to Fees</Link>
      </div>
      <h1 className="sr-only">Fee record for {ledger.fullName}</h1>
      <PlayerLedger
        actions={(
          <>
            {canRecordPayment && !ledger.archived ? (
              <Link className={`${styles.button} ${styles.light}`} href={recordPaymentHref(ledger)}>Record payment</Link>
            ) : null}
            <a className={styles.button} href={`/coach/financials/players/${ledger.playerId}/statement/download`}>
              <Download aria-hidden="true" /> Download statement
            </a>
          </>
        )}
        ledger={ledger}
        period={period}
        showReceiptDownloads
      />
    </div>
  )
}
