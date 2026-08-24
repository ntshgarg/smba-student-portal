"use client"

import { ArrowUpRight, Check } from "lucide-react"
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
import styles from "./financials.module.css"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

export function PrepareFees({
  compact = false,
  period,
  preparation,
}: {
  compact?: boolean
  period: string
  preparation: MonthlyPreparationPreview
}) {
  const router = useRouter()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const requestKey = useIdempotencyKey()

  async function prepare() {
    if (pending || preparation.ready === 0) return
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
        fallbackMessage: "Monthly fees could not be issued",
        retained: "No fees have been issued",
        subject: "The monthly fee issue",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={`${styles.preparation} ${compact ? styles.compactPreparation : ""}`} aria-labelledby="financial-preparation-title">
      <div className={styles.preparationHeading}>
        <div>
          <span>Monthly fee issue</span>
          <h2 id="financial-preparation-title">Issue {periodLabel(period)} fees</h2>
        </div>
        {!reviewOpen ? (
          <button
            type="button"
            disabled={preparation.ready === 0}
            onClick={() => setReviewOpen(true)}
          >
            {preparation.ready > 0
              ? "Review fee issue"
              : preparation.alreadyPrepared > 0
                ? "Fees issued"
                : "No fees to issue"}
            {preparation.ready > 0 ? <ArrowUpRight aria-hidden="true" /> : <Check aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      <dl className={styles.preparationCounts}>
        <div><dt>Ready to issue</dt><dd>{preparation.ready}</dd></div>
        <div><dt>Already issued</dt><dd>{preparation.alreadyPrepared}</dd></div>
      </dl>

      {reviewOpen ? (
        <div className={styles.preparationReview}>
          <div>
            <strong>{preparation.ready} {preparation.ready === 1 ? "player is" : "players are"} ready</strong>
            <p>Only missing monthly charges will be issued. Running this again will not duplicate them.</p>
          </div>
          <div>
            <button className={styles.quietButton} type="button" disabled={pending} onClick={() => { requestKey.reset(); setReviewOpen(false) }}>
              Cancel
            </button>
            <button className={styles.primaryButton} type="button" disabled={pending} onClick={() => void prepare()}>
              {pending
                ? "Issuing…"
                : `Issue ${preparation.ready} ${preparation.ready === 1 ? "fee" : "fees"}${feedback?.offerRetry ? " again" : ""}`}
            </button>
          </div>
        </div>
      ) : null}

      <InlineNotice className={styles.notice} message={feedback?.message} reserveSpace={!compact} tone={feedback?.tone} />
    </section>
  )
}
