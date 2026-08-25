"use client"

import { Download } from "lucide-react"

import { formatInr } from "@/lib/format"

import { formatDueDate, paymentMethodLabel } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import { RefundForm } from "./refund-form"
import { RefundReversal } from "./refund-reversal"

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
                  <span><strong>{formatInr(receipt.amountPaise)}</strong><small>{receipt.lifecycle === "reversed" ? "Reversed" : receipt.refundablePaise > 0 ? `${formatInr(receipt.refundablePaise)} refundable` : "Settled"}</small></span>
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
                          <strong>{formatInr(refund.amountPaise)}</strong>
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
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className={styles.emptyLedger}>No receipts have been recorded for this player yet.</div>}
    </section>
  )
}
