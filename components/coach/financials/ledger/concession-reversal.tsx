"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { reverseConcessionAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { CoachConcessionView } from "@/lib/finance/types"

import { resultFeedback, useIdempotencyKey } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { SaveFeedback } from "./save-feedback"

export function ConcessionReversal({ concession }: { concession: CoachConcessionView }) {
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
    scope: `financial-concession-reversal-${concession.id}`,
  })

  if (!concession.canReverse) return null

  async function reverse() {
    if (!reason.trim()) {
      setFeedback({ message: "Add a reason for ending this concession", tone: "error" })
      reasonRef.current?.focus()
      return
    }
    if (!window.confirm("End this concession? Existing applications will remain in the ledger.")) return
    setPending(true)
    try {
      const result = await reverseConcessionAction({
        concessionId: concession.id,
        expectedConcessionRevision: concession.recordRevision,
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
        fallbackMessage: "The concession could not be ended",
        retained: "Your reason is still on screen",
        subject: "The concession ending",
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
      <summary>End concession</summary>
      <p>Stops future use. Concessions already applied remain in the ledger.</p>
      <label className={styles.field}>
        <span>Reason</span>
        <textarea name="reason" ref={reasonRef} rows={2} value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); setDirty(true); setFeedback(null); requestKey.reset() }} />
      </label>
      <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
      <button className={styles.correctionButton} type="button" disabled={pending} onClick={() => void reverse()}>
        {pending ? "Ending…" : feedback?.offerRetry ? "End concession again" : "End concession"}
      </button>
    </details>
  )
}
