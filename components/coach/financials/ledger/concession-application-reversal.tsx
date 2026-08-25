"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { reverseConcessionApplicationAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { CoachConcessionApplicationView } from "@/lib/finance/types"

import { resultFeedback, useIdempotencyKey } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { SaveFeedback } from "./save-feedback"

export function ConcessionApplicationReversal({
  application,
}: {
  application: CoachConcessionApplicationView
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const requestKey = useIdempotencyKey()

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished concession reversal. Leave without saving?",
    scope: `financial-concession-application-reversal-${application.applicationId}`,
  })

  if (!application.canReverse) return null

  async function reverse() {
    if (!reason.trim()) {
      setFeedback({ message: "Add a reason for reversing this concession", tone: "error" })
      reasonRef.current?.focus()
      return
    }
    if (!window.confirm(`Reverse the concession applied to ${application.feeReference}?`)) return
    setPending(true)
    try {
      const result = await reverseConcessionApplicationAction({
        applicationId: application.applicationId,
        mutationId: requestKey.current(),
        reason: reason.trim(),
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
        fallbackMessage: "The concession application could not be reversed",
        retained: "Your reason is still on screen",
        subject: "The concession reversal",
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
    <details className={styles.concessionReversal}>
      <summary>Reverse application</summary>
      <label className={styles.field}>
        <span>Reason</span>
        <textarea name="reason" ref={reasonRef} rows={2} value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); setDirty(true); setFeedback(null); requestKey.reset() }} />
      </label>
      <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
      <button className={styles.correctionButton} type="button" disabled={pending} onClick={() => void reverse()}>
        {pending ? "Reversing…" : feedback?.offerRetry ? "Reverse application again" : "Reverse application"}
      </button>
    </details>
  )
}
