"use client"

import { formatInr } from "@/lib/format"
import type { CoachConcessionView } from "@/lib/finance/types"

import { formatDueDate, periodLabel } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import { ApplyConcessionForm } from "./apply-concession-form"
import { ConcessionApplicationReversal } from "./concession-application-reversal"
import { ConcessionCreationForm } from "./concession-creation-form"
import { ConcessionReversal } from "./concession-reversal"

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

  return (
    <details className={styles.concessions}>
      <summary>
        <span>Concessions</span>
        <small>{concessions.length} {concessions.length === 1 ? "record" : "records"}</small>
      </summary>
      <div className={styles.concessionsBody}>
        <p>
          {ledger.archived
            ? "Concessions previously recorded for this player."
            : "Use a concession to reduce a fee without changing the player’s agreed plan."}
        </p>
        {ledger.archived ? null : (
          <ConcessionCreationForm
            key={`${ledger.playerId}-${period}`}
            period={period}
            playerId={ledger.playerId}
          />
        )}

        {concessions.length ? (
          <div className={styles.concessionList}>
            {concessions.map((concession) => (
              <article key={concession.id} className={styles.concession}>
                <header>
                  <div>
                    <span>{concession.mode === "one_off" ? "One-off" : "Recurring monthly"}</span>
                    <strong>{concessionValueLabel(concession)}</strong>
                  </div>
                  <em className={concession.lifecycle === "active" ? undefined : styles.concessionEnded}>
                    {concession.lifecycle === "active" ? "Active" : "Ended"}
                  </em>
                </header>
                <p>{concession.reason}</p>
                {concession.mode === "recurring" ? (
                  <small>
                    {periodLabel(concession.startsPeriod ?? period)}
                    {concession.endsPeriod ? ` – ${periodLabel(concession.endsPeriod)}` : " onward"}
                  </small>
                ) : null}

                {ledger.archived ? null : (
                  <ApplyConcessionForm
                    key={`${concession.id}-${concession.recordRevision}`}
                    charges={ledger.charges}
                    concession={concession}
                  />
                )}

                {concession.applications.length ? (
                  <div className={styles.concessionApplications}>
                    <span>Applied fees</span>
                    {concession.applications.map((application) => (
                      <div key={application.applicationId}>
                        <div>
                          <strong>{application.feeReference}</strong>
                          <small>{formatDueDate(application.appliedOn)} · {application.lifecycle === "reversed" ? "Reversed" : "Applied"}</small>
                        </div>
                        <strong>{formatInr(application.amountPaise)}</strong>
                        {ledger.archived ? null : (
                          <ConcessionApplicationReversal application={application} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {ledger.archived ? null : <ConcessionReversal concession={concession} />}
              </article>
            ))}
          </div>
        ) : <div className={styles.emptyLedger}>No concessions have been created for this player.</div>}
      </div>
    </details>
  )
}
