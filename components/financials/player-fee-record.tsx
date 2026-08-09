import type { ElementType } from "react"

import { ReceiptText, WalletCards } from "lucide-react"

import type {
  PlayerFeeRecord,
  ChargeView,
} from "@/lib/finance/types"
import {
  financeStatusLabel,
  financeStatusTone,
  formatBillingPeriod,
  formatFinanceAmount,
  formatFinanceDate,
  groupMonthlyChargesByYear,
  paymentMethodLabel,
} from "@/components/financials/player-finance-presentation"
import styles from "@/components/financials/player-financials.module.css"

function ChargeRecord({
  charge,
  headingLevel = 3,
}: {
  charge: ChargeView
  headingLevel?: 3 | 4
}) {
  const Heading = `h${headingLevel}` as ElementType

  return (
    <article className={styles.chargeRecord} aria-labelledby={`fee-charge-${charge.id}`}>
      <div className={styles.chargeHeading}>
        <div>
          <span>
            {charge.type === "registration" ? "One-time academy fee" : formatBillingPeriod(charge.billingPeriod)}
          </span>
          <Heading id={`fee-charge-${charge.id}`}>{charge.description}</Heading>
        </div>
        <span
          className={styles.status}
          data-tone={financeStatusTone(charge.status)}
        >
          {financeStatusLabel(charge.status)}
        </span>
      </div>

      <dl className={styles.chargeFacts}>
        <div>
          <dt>Amount</dt>
          <dd>{formatFinanceAmount(charge.effectiveAmountPaise)}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{formatFinanceAmount(charge.receivedPaise)}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{formatFinanceAmount(charge.outstandingPaise)}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd><time dateTime={charge.dueDate}>{formatFinanceDate(charge.dueDate)}</time></dd>
        </div>
      </dl>

      <p className={styles.feeReference}>
        <span>Fee reference</span>
        <strong>{charge.feeReference}</strong>
      </p>
    </article>
  )
}

function EmptyRecord({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.inlineEmpty}>
      <ReceiptText aria-hidden="true" />
      <p>{children}</p>
    </div>
  )
}

export function PlayerFeeRecordView({ record }: { record: PlayerFeeRecord }) {
  const monthlyGroups = groupMonthlyChargesByYear(record.monthlyCharges)
  const receiptHistory = [...record.receipts]
    .sort((first, second) => (
      second.receivedOn.localeCompare(first.receivedOn) || second.id.localeCompare(first.id)
    ))
  const concessionHistory = [...record.concessionEntries]
    .sort((first, second) => (
      second.appliedOn.localeCompare(first.appliedOn) || second.id.localeCompare(first.id)
    ))

  return (
    <>
      <section className={styles.overview} aria-labelledby="fee-overview-title">
        <div>
          <p className={styles.sectionEyebrow}>Current position</p>
          <h2 id="fee-overview-title">Your fee record</h2>
          <p>
            Charges and receipts are shown here as they are recorded by the academy.
          </p>
        </div>
        <dl className={styles.balanceSummary}>
          <div>
            <dt>Current balance</dt>
            <dd>{formatFinanceAmount(record.currentBalancePaise)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span
                className={styles.status}
                data-tone={financeStatusTone(record.status)}
              >
                {financeStatusLabel(record.status)}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.recordSection} aria-labelledby="registration-fee-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>One-time charge</p>
            <h2 id="registration-fee-title">Registration fee</h2>
          </div>
          <p>The academy registration fee and its recorded settlement.</p>
        </div>
        {record.registrationCharge ? (
          <ChargeRecord charge={record.registrationCharge} />
        ) : (
          <EmptyRecord>Your registration-fee record is being prepared.</EmptyRecord>
        )}
      </section>

      <section className={styles.recordSection} aria-labelledby="monthly-fees-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>Training charges</p>
            <h2 id="monthly-fees-title">Monthly fees</h2>
          </div>
          <p>Each charge keeps its own amount, due date and fee reference.</p>
        </div>
        {monthlyGroups.length ? (
          <div className={styles.yearLedger}>
            {monthlyGroups.map((group) => (
              <section className={styles.yearGroup} aria-labelledby={`fee-year-${group.year}`} key={group.year}>
                <div className={styles.yearHeading}>
                  <h3 id={`fee-year-${group.year}`}>{group.year}</h3>
                  <span>{group.charges.length} {group.charges.length === 1 ? "charge" : "charges"}</span>
                </div>
                <div className={styles.chargeList}>
                  {group.charges.map((charge) => (
                    <ChargeRecord charge={charge} headingLevel={4} key={charge.id} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EmptyRecord>Your monthly fee record is being prepared.</EmptyRecord>
        )}
      </section>

      <section className={styles.recordSection} aria-labelledby="payment-history-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>Recorded receipts</p>
            <h2 id="payment-history-title">Payment history</h2>
          </div>
          <p>Receipts show how each payment was applied to your academy fees.</p>
        </div>
        {receiptHistory.length ? (
          <ol className={styles.receiptList}>
            {receiptHistory.map((receipt, receiptIndex) => {
              const receiptDomId = `fee-receipt-${receiptIndex + 1}`

              return (
                <li key={receipt.id}>
                  <article
                    className={styles.receiptEntry}
                    aria-labelledby={receiptDomId}
                  >
                  <span className={styles.paymentIcon} aria-hidden="true"><WalletCards /></span>
                  <div className={styles.paymentDescription}>
                    <strong id={receiptDomId}>
                      {formatFinanceAmount(receipt.amountPaise)}
                    </strong>
                    <span>{paymentMethodLabel(receipt.method)} · Receipt {receipt.receiptReference}</span>
                    {receipt.externalReference ? (
                      <small>Payment reference {receipt.externalReference}</small>
                    ) : null}
                  </div>
                  <div className={styles.paymentDate}>
                    <time dateTime={receipt.receivedOn}>{formatFinanceDate(receipt.receivedOn)}</time>
                    <span>{receipt.lifecycle === "reversed" ? "Receipt reversed" : "Receipt recorded"}</span>
                  </div>

                  <div className={styles.allocationBreakdown}>
                    <p id={`${receiptDomId}-allocations`}>Applied to</p>
                    <ul aria-labelledby={`${receiptDomId}-allocations`}>
                      {receipt.allocations.map((allocation) => (
                        <li key={allocation.id}>
                          <span>
                            <strong>{allocation.description}</strong>
                            <small>Fee reference {allocation.feeReference}</small>
                          </span>
                          <strong>{formatFinanceAmount(allocation.amountPaise)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {receipt.refunds.length ? (
                    <div className={styles.refundBreakdown}>
                      <p id={`${receiptDomId}-refunds`}>Refunds</p>
                      <ul aria-labelledby={`${receiptDomId}-refunds`}>
                        {[...receipt.refunds]
                          .sort((first, second) => (
                            second.refundedOn.localeCompare(first.refundedOn)
                              || second.id.localeCompare(first.id)
                          ))
                          .map((refund) => (
                            <li key={refund.id}>
                              <span>
                                <strong>Refund {refund.refundReference}</strong>
                                <small>
                                  <time dateTime={refund.refundedOn}>
                                    {formatFinanceDate(refund.refundedOn)}
                                  </time>
                                  {" · "}
                                  {refund.lifecycle === "reversed" ? "Refund reversed" : "Refund recorded"}
                                </small>
                              </span>
                              <strong>{formatFinanceAmount(refund.amountPaise)}</strong>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                  </article>
                </li>
              )
            })}
          </ol>
        ) : (
          <EmptyRecord>No receipts have been recorded yet.</EmptyRecord>
        )}

        {concessionHistory.length ? (
          <div className={styles.concessionHistory}>
            <div className={styles.historySubheading}>
              <h3>Fee concessions</h3>
              <span>{concessionHistory.length}</span>
            </div>
            <ol className={styles.concessionList}>
              {concessionHistory.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.label}</strong>
                    <small>Fee reference {entry.feeReference}</small>
                  </div>
                  <div>
                    <strong>{formatFinanceAmount(entry.amountPaise)}</strong>
                    <small>
                      <time dateTime={entry.appliedOn}>{formatFinanceDate(entry.appliedOn)}</time>
                      {entry.lifecycle === "reversed" ? " · Reversed" : " · Applied"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    </>
  )
}
