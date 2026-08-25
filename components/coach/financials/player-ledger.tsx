"use client"

import { formatAcademyDate, formatInr } from "@/lib/format"

import {
  formatDueDate,
  paymentMethodLabel,
  statusLabels,
} from "./financials-client-utils"
import styles from "./financials.module.css"
import { ConcessionManagement } from "./ledger/concession-management"
import { CorrectionsPanel } from "./ledger/corrections-panel"
import { FeePlanEditor } from "./ledger/fee-plan-editor"
import { FeePlanEnder } from "./ledger/fee-plan-ender"
import { OnboardingFinanceSetup } from "./ledger/onboarding-finance-setup"
import { ReceiptHistory } from "./ledger/receipt-history"
import type { PlayerFinancialLedgerView } from "./types"

export function PlayerLedger({
  focused = false,
  ledger,
  period,
  showReceiptDownloads = false,
}: {
  focused?: boolean
  ledger: PlayerFinancialLedgerView
  period: string
  showReceiptDownloads?: boolean
}) {
  return (
    <article className={`${styles.ledger} ${focused ? styles.focusedLedger : ""}`} aria-labelledby="selected-ledger-title">
      <header className={styles.ledgerHeader}>
        <div>
          <span>{ledger.academyId}{ledger.archived ? " · Archived" : ""}</span>
          <h2 id="selected-ledger-title">{ledger.fullName}</h2>
          <p>{ledger.feePlan?.label ?? "Player onboarding in progress"}</p>
        </div>
        <div className={styles.ledgerBalance}>
          <span>Outstanding</span>
          <strong>{formatInr(ledger.outstandingPaise)}</strong>
          <em className={styles[`status_${ledger.status}`]}>{statusLabels[ledger.status]}</em>
        </div>
      </header>

      {ledger.feePlan ? (
        <>
          <dl className={styles.feePlan}>
            <div><dt>Fee plan</dt><dd>{ledger.feePlan.label}</dd></div>
            <div><dt>Agreed monthly fee</dt><dd>{formatInr(ledger.feePlan.agreedMonthlyFeePaise)}</dd></div>
            <div><dt>Plan status</dt><dd>{ledger.feePlan.status}</dd></div>
          </dl>
          {ledger.archived ? null : (
            <>
              <FeePlanEditor ledger={ledger} />
              <FeePlanEnder ledger={ledger} period={period} />
            </>
          )}
        </>
      ) : ledger.archived ? null : <OnboardingFinanceSetup ledger={ledger} />}

      {(!ledger.archived && ledger.feePlan)
        || (ledger.archived && ledger.management.concessions.length > 0) ? (
        <ConcessionManagement ledger={ledger} period={period} />
      ) : null}

      <ReceiptHistory
        focused={focused}
        ledger={ledger}
        readOnly={ledger.archived}
        showDownloads={showReceiptDownloads}
      />

      <section className={styles.chargeSection} aria-labelledby="fee-ledger-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Player ledger</span>
            <h3 id="fee-ledger-title">Charges and payments</h3>
          </div>
          <p>{ledger.charges.length} {ledger.charges.length === 1 ? "charge" : "charges"}</p>
        </div>

        {ledger.charges.length ? (
          <div className={styles.chargeList}>
            {ledger.charges.map((charge, index) => (
              <article key={charge.id} className={styles.charge}>
                <div className={styles.chargeHeading}>
                  {focused ? <span className={styles.chargeFolio} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}
                  <div>
                    <span>{charge.type === "registration" ? "Registration" : "Monthly training"}</span>
                    <h4>{charge.description}</h4>
                    <small>{charge.feeReference}</small>
                  </div>
                  <em className={styles[`status_${charge.status}`]}>{statusLabels[charge.status]}</em>
                </div>

                <dl className={styles.chargeAmounts}>
                  <div><dt>Charged</dt><dd>{formatInr(charge.effectiveAmountPaise)}</dd></div>
                  <div><dt>Received</dt><dd>{formatInr(charge.receivedPaise)}</dd></div>
                  <div><dt>Remaining</dt><dd>{formatInr(charge.outstandingPaise)}</dd></div>
                  <div><dt>Due</dt><dd>{formatDueDate(charge.dueDate)}</dd></div>
                </dl>

                {charge.payments.length ? (
                  <details className={styles.paymentHistory}>
                    <summary>{charge.payments.length} {charge.payments.length === 1 ? "payment" : "payments"}</summary>
                    <ul>
                      {charge.payments.map((payment) => (
                        <li key={payment.id}>
                          <div>
                            <strong>{formatInr(payment.amountPaise)}</strong>
                            <span>{paymentMethodLabel(payment.method)}{payment.reversed ? " · Reversed" : ""}</span>
                          </div>
                          <div>
                            <time dateTime={payment.receivedOn}>{formatDueDate(payment.receivedOn)}</time>
                            {payment.reference ? <small>{payment.reference}</small> : null}
                            {payment.internalNote ? <small>{payment.internalNote}</small> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {charge.adjustments.length ? (
                  <details className={styles.paymentHistory}>
                    <summary>{charge.adjustments.length} {charge.adjustments.length === 1 ? "adjustment" : "adjustments"}</summary>
                    <ul>
                      {charge.adjustments.map((adjustment) => (
                        <li key={adjustment.id}>
                          <div>
                            <strong>{formatInr(adjustment.amountPaise)}</strong>
                            <span>{adjustment.kind.replaceAll("_", " ")}{adjustment.reversed ? " · Reversed" : ""}</span>
                          </div>
                          <div>
                            <time dateTime={adjustment.createdAt}>{formatAcademyDate(adjustment.createdAt, { day: "numeric", month: "short", year: "numeric" })}</time>
                            <small>{adjustment.reason}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyLedger}>No fee records have been issued for this player yet.</div>
        )}
      </section>

      {ledger.archived ? null : <CorrectionsPanel ledger={ledger} />}
    </article>
  )
}
