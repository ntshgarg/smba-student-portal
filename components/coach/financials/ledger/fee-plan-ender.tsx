"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import { endFeeAgreementAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"

import { resultFeedback, useIdempotencyKey } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import type { SaveFeedback } from "./save-feedback"

export function FeePlanEnder({
  ledger,
  period,
}: {
  ledger: PlayerFinancialLedgerView
  period: string
}) {
  const router = useRouter()
  const agreement = ledger.feePlan
  const [effectiveThroughPeriod, setEffectiveThroughPeriod] = useState(() => {
    const agreementStart = agreement?.effectiveFrom.slice(0, 7)
    return agreementStart && period < agreementStart ? agreementStart : period
  })
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const requestKey = useIdempotencyKey()

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished fee-plan ending. Leave without saving?",
    scope: `financial-plan-end-${ledger.playerId}`,
  })

  if (!agreement || agreement.status !== "active") return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agreement || pending) return
    if (!reason.trim()) {
      setFeedback({ message: "Add a reason for ending this fee plan", tone: "error" })
      reasonRef.current?.focus()
      return
    }
    setPending(true)
    try {
      const result = await endFeeAgreementAction({
        agreementId: agreement.id,
        effectiveThroughPeriod,
        expectedRevision: agreement.recordRevision,
        idempotencyKey: requestKey.current(),
        reason,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        router.refresh()
      } else if (result.field === "reason") {
        reasonRef.current?.focus()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The fee plan could not be ended",
        retained: "Your final month and reason are still on screen",
        subject: "The fee plan ending",
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

  function markDirty() {
    setDirty(true)
    setFeedback(null)
    requestKey.reset()
  }

  return (
    <details className={styles.planEditor}>
      <summary>End fee plan</summary>
      <div className={styles.planEditorBody}>
        <p>Future months will stop after the selected final month. Existing fee records remain unchanged.</p>
        <form autoComplete="off" onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>
            <span>Final fee month</span>
            <input
              name="effectiveThroughPeriod"
              type="month"
              min={agreement.effectiveFrom.slice(0, 7)}
              value={effectiveThroughPeriod}
              disabled={pending}
              onChange={(event) => {
                setEffectiveThroughPeriod(event.target.value)
                markDirty()
              }}
            />
          </label>
          <label className={styles.field}>
            <span>Reason</span>
            <textarea
              name="reason"
              ref={reasonRef}
              maxLength={500}
              rows={3}
              value={reason}
              disabled={pending}
              onChange={(event) => {
                setReason(event.target.value)
                markDirty()
              }}
            />
          </label>
          <div className={styles.paymentFooter}>
            <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
            <button className={styles.correctionButton} type="submit" disabled={pending}>
              {pending ? "Ending…" : feedback?.offerRetry ? "End fee plan again" : "End fee plan"}
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}
