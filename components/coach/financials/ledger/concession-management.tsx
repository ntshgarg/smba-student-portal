"use client"

import { formatInr, getAcademyMonthKey } from "@/lib/format"
import type { CoachConcessionView } from "@/lib/finance/types"

import { formatDueDate, periodLabel } from "../financials-client-utils"
import styles from "../fees.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import { ConcessionApplicationReversal } from "./concession-application-reversal"

const concessionPercentFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 })

function concessionValueLabel(concession: CoachConcessionView) {
  if (concession.valueKind === "fixed") return formatInr(concession.value)
  return `${concessionPercentFormat.format(concession.value / 100)}%`
}

export function ConcessionManagement({
  ledger,
  period,
}: {
  ledger: PlayerFinancialLedgerView
  period: string
}) {
  const concessions = ledger.management.concessions
  const thisMonth = getAcademyMonthKey()
  // A recurring concession whose last month has passed reads as ended, as in Members.
  const running = (concession: CoachConcessionView) => concession.lifecycle === "active"
    && !(concession.endsPeriod && concession.endsPeriod < thisMonth)
  // A new concession starts next month, so it is not yet in force.
  const statusLabel = (concession: CoachConcessionView) => !running(concession)
    ? "Ended"
    : concession.startsPeriod && concession.startsPeriod > thisMonth
      ? `Starts ${periodLabel(concession.startsPeriod)}`
      : "Active"

  return (
    <>
      <p className={styles.note}>
        {ledger.archived
          ? "Concessions previously recorded for this player."
          : "Concessions are given and stopped from the player’s record in Members. To undo one on a single fee, use Reverse application below."}
      </p>

      {concessions.length ? (
        <div className={styles.cards}>
          {concessions.map((concession) => (
            <article key={concession.id} className={styles.card}>
              <div className={`${styles.cardHead} ${styles.concessionHead}`}>
                <span className={styles.cardTitle}>
                  <b>{concessionValueLabel(concession)} · {concession.mode === "one_off" ? "One-off" : "Recurring monthly"}</b>
                  <small>
                    {concession.reason}
                    {concession.mode === "recurring"
                      ? ` · ${periodLabel(concession.startsPeriod ?? period)}${concession.endsPeriod ? ` – ${periodLabel(concession.endsPeriod)}` : " onward"}`
                      : ""}
                  </small>
                </span>
                <span className={styles.pill} data-tone={running(concession) ? "green" : undefined}>
                  {statusLabel(concession)}
                </span>
              </div>

              {concession.applications.length ? (
                <div className={styles.cardBody}>
                  <ul className={styles.entries} aria-label="Applied fees">
                    {concession.applications.map((application) => (
                      <li key={application.applicationId}>
                        <span>
                          <b>{application.feeReference}</b> · {formatDueDate(application.appliedOn)} · {application.lifecycle === "reversed" ? "Reversed" : "Applied"}
                        </span>
                        <b>{formatInr(application.amountPaise)}</b>
                        {ledger.archived ? null : (
                          <ConcessionApplicationReversal application={application} />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : <p className={styles.note}>No concessions have been created for this player.</p>}
    </>
  )
}
