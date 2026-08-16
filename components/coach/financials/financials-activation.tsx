"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { FormEvent } from "react"

import { activateFinanceAction } from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"

import { resultFeedback, useIdempotencyKey } from "./financials-client-utils"
import styles from "./financials.module.css"

export function FinancialsActivation({ initialPeriod }: { initialPeriod: string }) {
  const router = useRouter()
  const [trackingMonth, setTrackingMonth] = useState(initialPeriod)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Financial tracking could not be activated",
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.activationHeader}>
        <span className="eyebrow">Academy operations</span>
        <h1>Financials</h1>
        <p>Begin with one clear starting point for every player fee record.</p>
      </header>

      <section className={styles.activationPanel} aria-labelledby="finance-activation-title">
        <div>
          <span>One-time academy setup</span>
          <h2 id="finance-activation-title">Start financial tracking</h2>
          <p>
            Choose the first month SMBA will track in the portal. Existing players can then be
            reconciled individually without inventing historical payments.
          </p>
        </div>

        <form autoComplete="off" onSubmit={(event) => void activate(event)}>
          <label className={styles.field}>
            <span>Tracking starts</span>
            <input
              name="trackingMonth"
              type="month"
              value={trackingMonth}
              disabled={pending}
              onChange={(event) => { setTrackingMonth(event.target.value); requestKey.reset() }}
            />
          </label>

          <label className={styles.activationConfirmation}>
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

          <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
          <button className={styles.primaryButton} type="submit" disabled={!confirmed || pending}>
            {pending ? "Starting…" : "Start financial tracking"}
          </button>
        </form>
      </section>
    </div>
  )
}
