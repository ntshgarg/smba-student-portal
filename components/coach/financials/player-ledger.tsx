"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"

import { formatAcademyDate, formatDateKey, formatInr } from "@/lib/format"

import {
  formatDueDate,
  paymentMethodLabel,
  periodLabel,
  statusLabels,
} from "./financials-client-utils"
import styles from "./fees.module.css"
import { ConcessionManagement } from "./ledger/concession-management"
import { CorrectionsPanel } from "./ledger/corrections-panel"
import { OnboardingFinanceSetup } from "./ledger/onboarding-finance-setup"
import { ReceiptHistory } from "./ledger/receipt-history"
import type { PlayerFinancialLedgerView } from "./types"

type LedgerTab = "fees" | "receipts" | "concessions" | "corrections"

function planDate(dateKey: string | null) {
  return dateKey
    ? formatDateKey(dateKey, { day: "numeric", month: "short", weekday: undefined, year: "numeric" })
    : ""
}

function planStanding(plan: NonNullable<PlayerFinancialLedgerView["feePlan"]>) {
  if (plan.standing === "running") return "Active"
  if (plan.standing === "ending") return `Ends ${planDate(plan.effectiveTo)}`
  if (plan.standing === "starting") return `Starts ${planDate(plan.effectiveFrom)}`
  return `Ended ${planDate(plan.effectiveTo)}`
}

/**
 * A player's fee record: the navy band names the player and what they owe, and
 * the tabs below hold one part of the record at a time. Every tab's content
 * stays on the page (hidden), so a half-filled form keeps its draft while
 * another tab is open.
 */
export function PlayerLedger({
  actions,
  ledger,
  period,
  showReceiptDownloads = false,
}: {
  /** The band's buttons: Record payment and the statement. */
  actions?: ReactNode
  ledger: PlayerFinancialLedgerView
  period: string
  showReceiptDownloads?: boolean
}) {
  const [pickedTab, setTab] = useState<LedgerTab>("fees")
  const [startCharge, setStartCharge] = useState<{ chargeId: string } | null>(null)
  // The corrections form needs a fee that is not void to act on.
  const canCorrect = !ledger.archived && ledger.charges.some((charge) => charge.status !== "void")
  const showConcessions = (!ledger.archived && Boolean(ledger.feePlan))
    || ledger.management.concessions.length > 0
  const tabs: Array<{ count?: number; label: string; value: LedgerTab }> = [
    { count: ledger.charges.length, label: "Fees", value: "fees" },
    { count: ledger.management.receipts.length, label: "Receipts", value: "receipts" },
    { count: ledger.management.concessions.length, label: "Concessions", value: "concessions" },
    ...canCorrect ? [{ label: "Corrections", value: "corrections" as const }] : [],
  ]
  // A tab can leave (voiding the last open fee removes Corrections); the record then shows Fees.
  const tab = tabs.some((item) => item.value === pickedTab) ? pickedTab : "fees"
  const meta = [
    ledger.academyId,
    ledger.archived ? "Archived" : null,
    ledger.feePlan
      ? `${ledger.feePlan.label} · ${formatInr(ledger.feePlan.agreedMonthlyFeePaise)} a month · ${planStanding(ledger.feePlan)}`
      : ledger.onboardingComplete ? "No fee plan" : "Player onboarding in progress",
  ].filter(Boolean).join(" · ")
  const owing = ledger.outstandingPaise > 0

  return (
    <article className={styles.band} aria-labelledby="selected-ledger-title">
      <div className={styles.bandTop}>
        <div className={styles.bandHead}>
          <div>
            <h2 id="selected-ledger-title">{ledger.fullName}</h2>
            <p>{meta}</p>
          </div>
          <div className={styles.owe}>
            <b>{formatInr(ledger.outstandingPaise)}</b>
            <span data-tone={ledger.status === "overdue" ? "red" : undefined}>
              {owing ? "owed" : "nothing owed"} · {statusLabels[ledger.status]}
            </span>
          </div>
        </div>
        <div className={styles.bandActions}>
          {actions}
          {ledger.feePlan && !ledger.archived && !ledger.feePlanMismatch ? (
            // Fee changes, concessions and ending training are made from the
            // player's record in Members (head coach, 5 Oct 2026), next to the
            // schedule they usually change with. This record is for money.
            <Link className={styles.bandLink} href={`/coach/members?player=${encodeURIComponent(ledger.playerId)}`}>
              Fee, concession or end training: player&apos;s record in Members
            </Link>
          ) : null}
        </div>
        <div className={styles.recordTabs} role="tablist" aria-label="Fee record">
          {tabs.map((item) => (
            <button
              key={item.value}
              id={`ledger-tab-${item.value}`}
              type="button"
              role="tab"
              aria-controls={`ledger-panel-${item.value}`}
              aria-selected={tab === item.value}
              tabIndex={tab === item.value ? 0 : -1}
              onClick={() => setTab(item.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
                const index = tabs.findIndex((entry) => entry.value === item.value)
                const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
                setTab(next.value)
                document.getElementById(`ledger-tab-${next.value}`)?.focus()
              }}
            >
              {item.label}{item.count === undefined ? null : <small>{item.count}</small>}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.bandBody}>
        <div className={styles.stack} id="ledger-panel-fees" role="tabpanel" aria-labelledby="ledger-tab-fees" hidden={tab !== "fees"}>
          {ledger.feePlan?.upcoming ? (
            <p className={styles.notice}>
              From {periodLabel(ledger.feePlan.upcoming.effectiveFrom.slice(0, 7))}: {ledger.feePlan.upcoming.label},{" "}
              {formatInr(ledger.feePlan.upcoming.agreedMonthlyFeePaise)} a month.
            </p>
          ) : null}
          {ledger.feePlan && !ledger.archived && ledger.feePlanMismatch ? (
            // Fee issuing passes over a plan that is not for the player's
            // training, so this is the only place it would otherwise go unseen.
            <p className={styles.notice} data-tone="amber" role="note">
              This fee plan is not for their current level, batch and plan, so no monthly fee is
              issued. Set it again with Change fee in the{" "}
              <Link href={`/coach/members?player=${encodeURIComponent(ledger.playerId)}`}>
                player&apos;s record in Members
              </Link>.
            </p>
          ) : null}
          {!ledger.feePlan && !ledger.archived ? <OnboardingFinanceSetup ledger={ledger} /> : null}

          {ledger.charges.length ? (
            <div className={styles.cards}>
              {ledger.charges.map((charge) => (
                <details key={charge.id} className={styles.card}>
                  <summary>
                    <span className={styles.cardTitle}>
                      <b>{charge.description}</b>
                      <small>
                        {charge.type === "registration" ? "Registration" : "Monthly training"} · {charge.feeReference} · due {formatDueDate(charge.dueDate)}
                      </small>
                    </span>
                    <span className={styles.pill} data-status={charge.status}>{statusLabels[charge.status]}</span>
                    <span className={styles.cardNum}><span>Charged</span>{formatInr(charge.effectiveAmountPaise)}</span>
                    <span className={styles.cardNum}><span>Received</span>{formatInr(charge.receivedPaise)}</span>
                    <span className={styles.cardNum} data-owed={charge.outstandingPaise > 0 ? "" : undefined}>
                      <span>Left</span>{formatInr(charge.outstandingPaise)}
                    </span>
                    <span className={styles.chev} aria-hidden="true" />
                  </summary>
                  <div className={styles.cardBody}>
                    {charge.payments.length || charge.adjustments.length ? (
                      <ul className={styles.entries}>
                        {charge.payments.map((payment) => (
                          <li key={payment.id}>
                            <span>
                              <b>{formatInr(payment.amountPaise)}</b> · {paymentMethodLabel(payment.method)}
                              {payment.reversed ? " · Reversed" : ""}
                              {payment.reference ? ` · ${payment.reference}` : ""}
                              {payment.internalNote ? ` · ${payment.internalNote}` : ""}
                            </span>
                            <time dateTime={payment.receivedOn}>{formatDueDate(payment.receivedOn)}</time>
                          </li>
                        ))}
                        {charge.adjustments.map((adjustment) => (
                          <li key={adjustment.id}>
                            <span>
                              <b>{formatInr(adjustment.amountPaise)}</b> · {adjustment.kind.replaceAll("_", " ")}
                              {adjustment.reversed ? " · Reversed" : ""} · {adjustment.reason}
                            </span>
                            <time dateTime={adjustment.createdAt}>
                              {formatAcademyDate(adjustment.createdAt, { day: "numeric", month: "short", year: "numeric" })}
                            </time>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.note}>No payments yet.</p>
                    )}
                    {canCorrect && charge.status !== "void" ? (
                      <div>
                        <button
                          className={styles.button}
                          type="button"
                          onClick={() => {
                            setTab("corrections")
                            setStartCharge({ chargeId: charge.id })
                          }}
                        >
                          Correct this fee
                        </button>
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className={styles.note}>No fee records have been issued for this player yet.</p>
          )}
        </div>

        <div className={styles.stack} id="ledger-panel-receipts" role="tabpanel" aria-labelledby="ledger-tab-receipts" hidden={tab !== "receipts"}>
          <ReceiptHistory
            ledger={ledger}
            readOnly={ledger.archived}
            showDownloads={showReceiptDownloads}
          />
        </div>

        <div className={styles.stack} id="ledger-panel-concessions" role="tabpanel" aria-labelledby="ledger-tab-concessions" hidden={tab !== "concessions"}>
          {showConcessions ? (
            <ConcessionManagement ledger={ledger} period={period} />
          ) : (
            <p className={styles.note}>No concessions. Concessions are given from the player&apos;s record in Members.</p>
          )}
        </div>

        {canCorrect ? (
          <div className={styles.stack} id="ledger-panel-corrections" role="tabpanel" aria-labelledby="ledger-tab-corrections" hidden={tab !== "corrections"}>
            <CorrectionsPanel ledger={ledger} startCharge={startCharge} />
          </div>
        ) : null}
      </div>
    </article>
  )
}
