"use client"

import { Download } from "lucide-react"
import Link from "next/link"

import { formatInr } from "@/lib/format"
import type { CoachReceiptView } from "@/lib/finance/types"

import { formatDueDate, paymentMethodLabel } from "../financials-client-utils"
import styles from "../financials.module.css"
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

export function ReceiptHistory({
  focused = false,
  ledger,
  readOnly = false,
  showDownloads = false,
}: {
  focused?: boolean
  ledger: PlayerFinancialLedgerView
  readOnly?: boolean
  showDownloads?: boolean
}) {
  const receipts = ledger.management.receipts
  const refunds = ledger.management.refunds

  return (
    <section className={styles.receiptSection} aria-labelledby="receipt-history-title">
      <div className={styles.sectionHeading}>
        <div><span>Collection history</span><h3 id="receipt-history-title">Receipts and refunds</h3></div>
        <p>{receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}</p>
      </div>

      {receipts.length ? (
        <div className={styles.receiptList}>
          {receipts.map((receipt, index) => {
            const receiptRefunds = refunds.filter((refund) => refund.paymentId === receipt.id)
            return (
              <details key={receipt.id} className={styles.receipt}>
                <summary>
                  {focused ? <span className={styles.receiptFolio} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}
                  <span><strong>{receipt.receiptReference}</strong><small>{formatDueDate(receipt.receivedOn)} · {paymentMethodLabel(receipt.method)}</small></span>
                  <span><strong>{formatInr(receipt.amountPaise)}</strong><small>{receiptOutcome(receipt)}</small></span>
                </summary>
                <div className={styles.receiptBody}>
                  {showDownloads ? (
                    <a
                      aria-label={`Download receipt ${receipt.receiptReference}`}
                      className={styles.receiptDownload}
                      href={`/coach/financials/receipts/${receipt.id}/download`}
                    >
                      Download receipt
                      <Download aria-hidden="true" />
                    </a>
                  ) : null}
                  {receipt.externalReference || receipt.internalNote ? (
                    <dl className={styles.receiptMeta}>
                      {receipt.externalReference ? <div><dt>Reference</dt><dd>{receipt.externalReference}</dd></div> : null}
                      {receipt.internalNote ? <div><dt>Internal note</dt><dd>{receipt.internalNote}</dd></div> : null}
                    </dl>
                  ) : null}

                  <div className={styles.receiptAllocations}>
                    <span>Allocated to</span>
                    <ul>
                      {receipt.allocations.map((allocation) => (
                        <li key={allocation.paymentAllocationId}>
                          <span><strong>{allocation.description}</strong><small>{allocation.feeReference}</small></span>
                          <strong>{formatInr(allocation.amountPaise)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {receiptRefunds.length ? (
                    <div className={styles.refundHistory}>
                      <span>Refunds</span>
                      {receiptRefunds.map((refund) => (
                        <article key={refund.id}>
                          <div>
                            <strong>
                              {refund.purpose === "mid_term_withdrawal"
                                ? "Mid-term withdrawal"
                                : "Legacy refund"}
                              {" · "}{refund.refundReference}
                            </strong>
                            <small>
                              {refund.withdrawalEffectiveOn
                                ? `Member withdrew ${formatDueDate(refund.withdrawalEffectiveOn)} · `
                                : ""}
                              Refunded {formatDueDate(refund.refundedOn)} · {paymentMethodLabel(refund.method)} · {refund.lifecycle === "reversed" ? "Reversed" : "Recorded"}
                            </small>
                          </div>
                          <strong>{formatInr(refund.receiptAmountPaise)}</strong>
                          {refund.receiptAmountPaise !== refund.amountPaise ? (
                            <p>
                              {formatInr(refund.receiptAmountPaise)} of this {formatInr(refund.amountPaise)} refund
                              came from this receipt; the rest from another receipt for the same fee.
                            </p>
                          ) : null}
                          {refund.externalReference ? <p>Reference · {refund.externalReference}</p> : null}
                          {refund.internalNote ? <p>{refund.internalNote}</p> : null}
                          <ul className={styles.refundAllocations} aria-label={`Fees covered by refund ${refund.refundReference}`}>
                            {refund.allocations.map((allocation) => (
                              <li key={allocation.paymentAllocationId}>
                                <span>{allocation.feeReference}</span>
                                <strong>{formatInr(allocation.amountPaise)}</strong>
                              </li>
                            ))}
                          </ul>
                          {readOnly ? null : <RefundReversal refund={refund} />}
                        </article>
                      ))}
                    </div>
                  ) : null}

                  {receipt.canRefund && !readOnly ? <RefundForm receipt={receipt} /> : null}
                  {receipt.refundNeedsTrainingEnded && !readOnly ? (
                    <p className={styles.refundNeedsTrainingEnded}>
                      To refund the unused days of this fee, first end the player&apos;s training in
                      Members: choose End training, then &ldquo;They have left already&rdquo;.{" "}
                      <Link href={`/coach/members?player=${encodeURIComponent(ledger.playerId)}`}>
                        Open the player&apos;s record in Members
                      </Link>
                    </p>
                  ) : null}
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className={styles.emptyLedger}>No receipts have been recorded for this player yet.</div>}
    </section>
  )
}
