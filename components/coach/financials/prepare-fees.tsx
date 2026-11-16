"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { prepareMonthlyChargesAction } from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { MonthlyPreparationPreview } from "@/lib/finance/types"

import {
  periodLabel,
  resultFeedback,
  useIdempotencyKey,
} from "./financials-client-utils"
import styles from "./fees.module.css"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

const monthOnlyFormat = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" })

function monthOnly(period: string) {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return monthOnlyFormat.format(new Date(Date.UTC(year, month - 1, 1)))
}

export function PrepareFees({
  currentPeriod,
  period,
  preparation,
}: {
  /** The academy's current month; a later month's fees are not issued yet. */
  currentPeriod: string
  period: string
  preparation: MonthlyPreparationPreview
}) {
  const router = useRouter()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const requestKey = useIdempotencyKey()
  // Issued fees never change, so issuing ahead of the month would freeze it
  // before this month's fee changes, concessions and endings could reach it.
  const notYet = period > currentPeriod
  const canIssue = preparation.ready > 0 && !notYet

  async function prepare() {
    if (pending || !canIssue) return
    setPending(true)
    try {
      const result = await prepareMonthlyChargesAction({
        idempotencyKey: requestKey.current(),
        period,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setReviewOpen(false)
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "No fees have been issued",
        unconfirmed: "Check the connection, then reload the page to see whether this month's fees were issued",
        subject: "The monthly fee issue",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  const month = monthOnly(period)
  const players = (count: number) => `${count} ${count === 1 ? "player" : "players"}`

  return (
    <section aria-label={`Issue ${periodLabel(period)} fees`}>
      {reviewOpen && canIssue ? (
        <div className={styles.confirm}>
          <h2>Issue {periodLabel(period)} fees</h2>
          <dl className={styles.confirmTiles}>
            <div><dt>Ready to issue</dt><dd>{preparation.ready}</dd></div>
            <div><dt>Already issued</dt><dd>{preparation.alreadyPrepared}</dd></div>
          </dl>
          <p>Only missing monthly charges will be issued. Running this again will not duplicate them.</p>
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={pending} onClick={() => { requestKey.reset(); setReviewOpen(false) }}>
              Cancel
            </button>
            <button className={`${styles.button} ${styles.light}`} type="button" disabled={pending} onClick={() => void prepare()}>
              {pending
                ? "Issuing…"
                : `Issue ${preparation.ready} ${preparation.ready === 1 ? "fee" : "fees"}${feedback?.offerRetry ? " again" : ""}`}
            </button>
          </div>
        </div>
      ) : notYet ? (
        <div className={styles.line}>
          <p>{periodLabel(period)} fees can be issued from 1 {month}, so every change made before then still reaches them.</p>
          <button className={styles.button} type="button" disabled>Opens 1 {month}</button>
        </div>
      ) : canIssue ? (
        <div className={styles.line} data-tone="amber">
          <p>
            {month} fees are ready for {players(preparation.ready)}.{" "}
            {preparation.alreadyPrepared > 0 ? `${players(preparation.alreadyPrepared)} already issued.` : "Nothing is issued yet."}
          </p>
          <button className={styles.primary} type="button" onClick={() => setReviewOpen(true)}>Review &amp; issue</button>
        </div>
      ) : preparation.alreadyPrepared > 0 ? (
        <p className={styles.line} data-tone="green">✓ {month} fees issued for {players(preparation.alreadyPrepared)}.</p>
      ) : (
        <p className={styles.line}>No monthly fees to issue for {month}.</p>
      )}

      {preparation.waitingForChange > 0 && !notYet ? (
        <p className={styles.note}>
          {preparation.waitingForChange} {preparation.waitingForChange === 1 ? "player’s fee waits" : "players’ fees wait"} for a training change booked in Members; it is issued once the change happens.
        </p>
      ) : null}

      <InlineNotice action={feedback?.action} message={feedback?.message} reserveSpace={false} tone={feedback?.tone} />
    </section>
  )
}
