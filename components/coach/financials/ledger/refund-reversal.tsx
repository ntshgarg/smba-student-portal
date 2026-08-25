"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { reverseRefundAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { CoachRefundView } from "@/lib/finance/types"

import { resultFeedback, useIdempotencyKey } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { SaveFeedback } from "./save-feedback"

export function RefundReversal({ refund }: { refund: CoachRefundView }) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const requestKey = useIdempotencyKey()

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished refund reversal. Leave without saving?",
    scope: `financial-refund-reversal-${refund.id}`,
  })

  async function reverse() {
    if (!reason.trim()) {
      setFeedback({ message: "Add a reason for reversing this refund", tone: "error" })
      reasonRef.current?.focus()
      return
    }
    if (!window.confirm(
      `Reverse refund ${refund.refundReference}? The fee plan will remain ended until it is corrected or replaced.`,
    )) return
    setPending(true)
    try {
      const result = await reverseRefundAction({
        expectedRefundRevision: refund.recordRevision,
        mutationId: requestKey.current(),
        reason: reason.trim(),
        refundId: refund.id,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        setReason("")
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The refund could not be reversed",
        retained: "Your reason is still on screen",
        subject: "The refund reversal",
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

  if (!refund.canReverse) return null

  return (
    <details className={styles.refundReversal}>
      <summary>Reverse refund</summary>
      <label className={styles.field}>
        <span>Reason</span>
        <textarea name="reason" ref={reasonRef} rows={2} value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); setDirty(true); setFeedback(null); requestKey.reset() }} />
      </label>
      <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
      <button className={styles.correctionButton} type="button" disabled={pending} onClick={() => void reverse()}>
        {pending ? "Reversing…" : feedback?.offerRetry ? "Reverse refund again" : "Reverse refund"}
      </button>
    </details>
  )
}
