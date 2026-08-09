"use client"

import { ArrowUpRight, Check } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { prepareMonthlyChargesAction } from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import type { MonthlyPreparationPreview } from "@/lib/finance/types"

import {
  periodLabel,
  resultFeedback,
  useIdempotencyKey,
} from "./financials-client-utils"
import styles from "./financials.module.css"

export function PrepareFees({
  period,
  preparation,
}: {
  period: string
  preparation: MonthlyPreparationPreview
}) {
  const router = useRouter()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      setFeedback({
        message: error instanceof Error ? error.message : "Monthly fees could not be prepared",
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.preparation} aria-labelledby="financial-preparation-title">
      <div className={styles.preparationHeading}>
        <div>
          <span>Monthly preparation</span>
          <h2 id="financial-preparation-title">Prepare {periodLabel(period)} fees</h2>
        </div>
        {!reviewOpen ? (
          <button
            type="button"
            disabled={preparation.ready === 0}
            onClick={() => setReviewOpen(true)}
          >
            {preparation.ready > 0 ? "Review preparation" : "Month prepared"}
            {preparation.ready > 0 ? <ArrowUpRight aria-hidden="true" /> : <Check aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      <dl className={styles.preparationCounts}>
        <div><dt>Ready</dt><dd>{preparation.ready}</dd></div>
        <div><dt>Already prepared</dt><dd>{preparation.alreadyPrepared}</dd></div>
        <div><dt>Awaiting assignment</dt><dd>{preparation.awaitingAssignment}</dd></div>
        <div><dt>Setup required</dt><dd>{preparation.setupRequired}</dd></div>
      </dl>

      {reviewOpen ? (
        <div className={styles.preparationReview}>
          <div>
            <strong>{preparation.ready} {preparation.ready === 1 ? "player is" : "players are"} ready</strong>
            <p>Only missing monthly charges will be created. Running this again will not duplicate them.</p>
          </div>
          <div>
            <button className={styles.quietButton} type="button" disabled={pending} onClick={() => { requestKey.reset(); setReviewOpen(false) }}>
              Cancel
            </button>
            <button className={styles.primaryButton} type="button" disabled={pending} onClick={() => void prepare()}>
              {pending ? "Preparing…" : `Prepare ${preparation.ready} ${preparation.ready === 1 ? "fee" : "fees"}`}
            </button>
          </div>
        </div>
      ) : null}

      <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
    </section>
  )
}
