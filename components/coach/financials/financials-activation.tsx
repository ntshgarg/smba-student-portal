"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { FormEvent } from "react"

import { activateFinanceAction } from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"

import { resultFeedback, useIdempotencyKey } from "./financials-client-utils"
import styles from "./fees.module.css"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

export function FinancialsActivation({ initialPeriod }: { initialPeriod: string }) {
  const router = useRouter()
  const [trackingMonth, setTrackingMonth] = useState(initialPeriod)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const requestKey = useIdempotencyKey()

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmed || pending) return
    setPending(true)
    try {
      const result = await activateFinanceAction({
        idempotencyKey: requestKey.current(),
        trackingMonth,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        router.refresh()
      } else if (result.code === "ALREADY_ACTIVE") {
        // Started elsewhere with another month: load Financials as it now is.
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Your tracking month is still on screen",
        subject: "Financial tracking",
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

  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.back}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>
      <h1 className={styles.title}>Fees</h1>

      <section className={styles.start} aria-labelledby="finance-activation-title">
        <h2 id="finance-activation-title">Start tracking fees</h2>
        <p>
          One-time setup. Choose the first month the portal tracks; existing players can then be
          reconciled individually without inventing historical payments.
        </p>

        <form autoComplete="off" onSubmit={(event) => void activate(event)}>
          <label className={styles.q}>
            <span>First month</span>
            <input
              name="trackingMonth"
              type="month"
              value={trackingMonth}
              disabled={pending}
              onChange={(event) => { setTrackingMonth(event.target.value); requestKey.reset() }}
            />
          </label>

          <label className={styles.tick}>
            <input
              name="confirmPermanentLedger"
              type="checkbox"
              checked={confirmed}
              disabled={pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand this creates SMBA’s permanent financial ledger. It cannot be reset or
              switched off later; corrections remain auditable.
            </span>
          </label>

          <InlineNotice action={feedback?.action} message={feedback?.message} reserveSpace={false} tone={feedback?.tone} />
          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={!confirmed || pending}>
              {pending
                ? "Starting…"
                : feedback?.offerRetry ? "Start tracking fees again" : "Start tracking fees"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
