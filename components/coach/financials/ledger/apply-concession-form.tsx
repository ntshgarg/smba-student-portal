"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { FormEvent } from "react"

import { applyConcessionAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatInr } from "@/lib/format"
import type { CoachConcessionView } from "@/lib/finance/types"

import { resultFeedback, useIdempotencyKey } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { FinancialChargeView } from "../types"
import type { SaveFeedback } from "./save-feedback"

export function ApplyConcessionForm({
  charges,
  concession,
}: {
  charges: FinancialChargeView[]
  concession: CoachConcessionView
}) {
  const router = useRouter()
  const appliedChargeIds = new Set(concession.applications
    .filter((application) => application.lifecycle === "applied")
    .map((application) => application.chargeId))
  const eligibleCharges = charges.filter((charge) => {
    if (charge.status === "void" || charge.outstandingPaise <= 0) return false
    if (concession.mode === "one_off") return !concession.applications.length
    if (charge.type !== "monthly_training" || !charge.billingPeriod || !concession.startsPeriod) {
      return false
    }
    return charge.billingPeriod >= concession.startsPeriod
      && (concession.endsPeriod === null || charge.billingPeriod <= concession.endsPeriod)
      && !appliedChargeIds.has(charge.id)
  })
  const [chargeId, setChargeId] = useState(eligibleCharges[0]?.id ?? "")
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const requestKey = useIdempotencyKey()

  if (concession.lifecycle !== "active"
    || (concession.mode === "one_off" && concession.applications.length)) return null

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const charge = eligibleCharges.find((item) => item.id === chargeId)
    if (!charge || pending) return
    if (!window.confirm(`Apply this concession to ${charge.feeReference}?`)) return
    setPending(true)
    try {
      const result = await applyConcessionAction({
        chargeId: charge.id,
        concessionId: concession.id,
        expectedChargeRevision: charge.revision,
        expectedConcessionRevision: concession.recordRevision,
        mutationId: requestKey.current(),
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The concession could not be applied",
        retained: "The selected fee is still on screen",
        subject: "The concession application",
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

  if (!eligibleCharges.length) {
    return concession.mode === "recurring"
      ? <p className={styles.concessionHelp}>Future eligible monthly fees will receive this concession when they are issued.</p>
      : <p className={styles.concessionHelp}>There is no outstanding fee available for this concession.</p>
  }

  return (
    <form autoComplete="off" className={styles.concessionApply} onSubmit={(event) => void apply(event)}>
      <label className={styles.field}>
        <span>{concession.mode === "recurring" ? "Apply to existing fee" : "Apply to fee"}</span>
        <select name="chargeId" value={chargeId} disabled={pending} onChange={(event) => { setChargeId(event.target.value); setFeedback(null); requestKey.reset() }}>
          {eligibleCharges.map((charge) => (
            <option key={charge.id} value={charge.id}>
              {charge.description} · {charge.feeReference} · {formatInr(charge.outstandingPaise)} remaining
            </option>
          ))}
        </select>
      </label>
      <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
      <button className={styles.quietButton} type="submit" disabled={pending}>
        {pending ? "Applying…" : feedback?.offerRetry ? "Apply concession again" : "Apply concession"}
      </button>
    </form>
  )
}
