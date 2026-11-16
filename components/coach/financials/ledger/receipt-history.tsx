"use client"

import { Download } from "lucide-react"
import Link from "next/link"

import { formatInr } from "@/lib/format"
import type { CoachReceiptView } from "@/lib/finance/types"

import { formatDueDate, paymentMethodLabel } from "../financials-client-utils"
import styles from "../fees.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import { RefundForm } from "./refund-form"
import { RefundReversal } from "./refund-reversal"

/*
 * What became of the money on a receipt. It used to read "Settled" for
 * anything not refundable, so a part-payment on an unpaid fee looked like a
 * paid month, and a receipt whose money was given back looked untouched.
 */
function receiptOutcome(receipt: CoachReceiptView) {
  if (receipt.lifecycle === "reversed") return "Reversed"
  const refundedPaise = receipt.refundedPaise ?? 0
  if (refundedPaise >= receipt.amountPaise) return "Refunded"
  if (refundedPaise > 0) return `${formatInr(refundedPaise)} refunded`
  if (receipt.canRefund) return "Refund available"
  return "Recorded"
}

function outcomeTone(outcome: string) {
  if (outcome === "Reversed") return "red"
  if (outcome === "Recorded" || outcome === "Refund available") return "green"
  return "amber"
}

export function ReceiptHistory({
  ledger,
  readOnly = false,
  showDownloads = false,
}: {
  ledger: PlayerFinancialLedgerView
  readOnly?: boolean
  showDownloads?: boolean
}) {
  const receipts = ledger.management.receipts
  const refunds = ledger.management.refunds

  if (!receipts.length) {
    return <p className={styles.note}>No receipts have been recorded for this player yet.</p>
  }

  return (
    <div className={styles.cards}>
      {receipts.map((receipt) => {
        const receiptRefunds = refunds.filter((refund) => refund.paymentId === receipt.id)
        const outcome = receiptOutcome(receipt)
        return (
          <details key={receipt.id} className={`${styles.card} ${styles.receiptCard}`}>
            <summary>
              <span className={styles.cardTitle}>
                <b>{receipt.receiptReference}</b>
                <small>{formatDueDate(receipt.receivedOn)} · {paymentMethodLabel(receipt.method)}</small>
              </span>
              <span className={styles.pill} data-tone={outcomeTone(outcome)}>{outcome}</span>
              <span className={styles.cardNum}>{formatInr(receipt.amountPaise)}</span>
              <span className={styles.chev} aria-hidden="true" />
            </summary>
            <div className={styles.cardBody}>
              <ul className={styles.entries} aria-label="Paid toward">
                {receipt.allocations.map((allocation) => (
                  <li key={allocation.paymentAllocationId}>
                    <span><b>{allocation.description}</b> · {allocation.feeReference}</span>
                    <b>{formatInr(allocation.amountPaise)}</b>
                  </li>
                ))}
                {receipt.externalReference ? <li><span>Reference · {receipt.externalReference}</span></li> : null}
                {receipt.internalNote ? <li><span>Internal note · {receipt.internalNote}</span></li> : null}
              </ul>

              {receiptRefunds.map((refund) => (
                <article key={refund.id} className={styles.notice} data-tone="amber">
                  <p>
                    {refund.purpose === "mid_term_withdrawal" ? "Mid-term withdrawal" : "Legacy refund"}
                    {" · "}{refund.refundReference} · {formatInr(refund.receiptAmountPaise)}
                  </p>
                  <small>
                    {refund.withdrawalEffectiveOn
                      ? `Member withdrew ${formatDueDate(refund.withdrawalEffectiveOn)} · `
                      : ""}
                    Refunded {formatDueDate(refund.refundedOn)} · {paymentMethodLabel(refund.method)} · {refund.lifecycle === "reversed" ? "Reversed" : "Recorded"}
                  </small>
                  {refund.receiptAmountPaise !== refund.amountPaise ? (
                    <small>
                      {formatInr(refund.receiptAmountPaise)} of this {formatInr(refund.amountPaise)} refund
                      came from this receipt; the rest from another receipt for the same fee.
                    </small>
                  ) : null}
                  {refund.externalReference ? <small>Reference · {refund.externalReference}</small> : null}
                  {refund.internalNote ? <small>{refund.internalNote}</small> : null}
                  <ul className={styles.entries} aria-label={`Fees covered by refund ${refund.refundReference}`}>
                    {refund.allocations.map((allocation) => (
                      <li key={allocation.paymentAllocationId}>
                        <span>{allocation.feeReference}</span>
                        <b>{formatInr(allocation.amountPaise)}</b>
                      </li>
                    ))}
                  </ul>
                  {readOnly ? null : <RefundReversal refund={refund} />}
                </article>
              ))}

              {showDownloads ? (
                <div>
                  <a
                    aria-label={`Download receipt ${receipt.receiptReference}`}
                    className={styles.button}
                    href={`/coach/financials/receipts/${receipt.id}/download`}
                  >
                    <Download aria-hidden="true" /> Download receipt
                  </a>
                </div>
              ) : null}
              {receipt.canRefund && !readOnly ? <RefundForm receipt={receipt} /> : null}
              {receipt.refundNeedsTrainingEnded && !readOnly ? (
                <p className={styles.notice}>
                  If this player is leaving, end their training in Members first, then record
                  the refund here.{" "}
                  <Link href={`/coach/members?player=${encodeURIComponent(ledger.playerId)}`}>
                    Open in Members
                  </Link>
                </p>
              ) : null}
            </div>
          </details>
        )
      })}
    </div>
  )
}
