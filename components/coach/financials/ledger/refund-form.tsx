"use client"

import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { useRouter } from "next/navigation"

import {
  previewRefundAllocationsAction,
  recordRefundAction,
} from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatInr, getAcademyDateKey } from "@/lib/format"
import type {
  CoachReceiptView,
  PaymentMethod,
  RefundAllocationPreviewItem,
} from "@/lib/finance/types"

import {
  createAllocationDraft,
  parseRupeesToPaise,
  validateAllocationDraft,
} from "../allocation-draft"
import {
  formatDueDate,
  paymentMethods,
  resultFeedback,
  useIdempotencyKey,
} from "../financials-client-utils"
import styles from "../financials.module.css"
import type { SaveFeedback } from "./save-feedback"

export function RefundForm({ receipt }: { receipt: CoachReceiptView }) {
  const router = useRouter()
  const [amount, setAmount] = useState("")
  const [withdrawalEffectiveOn, setWithdrawalEffectiveOn] = useState(getAcademyDateKey())
  const [refundedOn, setRefundedOn] = useState(getAcademyDateKey())
  const [method, setMethod] = useState<PaymentMethod>(receipt.method)
  const [externalReference, setExternalReference] = useState("")
  const [internalNote, setInternalNote] = useState("")
  const [allocationValues, setAllocationValues] = useState<Record<string, string>>({})
  const [reviewedAllocations, setReviewedAllocations] = useState<RefundAllocationPreviewItem[]>([])
  const [reviewedAmountPaise, setReviewedAmountPaise] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<"preview" | "record" | null>(null)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()
  const allocationFeedbackId = `refund-allocation-feedback-${receipt.id}`

  const allocationValidation = reviewedAmountPaise === null
    ? null
    : validateAllocationDraft({
        expectedTotalPaise: reviewedAmountPaise,
        limits: reviewedAllocations.map((allocation) => ({
          id: allocation.paymentAllocationId,
          availablePaise: allocation.refundablePaise,
        })),
        values: allocationValues,
      })
  const invalidAllocationId = allocationValidation && !allocationValidation.ok
    ? allocationValidation.fieldId
    : undefined

  useUnsavedWorkGuard({
    isDirty: dirty && pending === null,
    message: "You have an unfinished refund. Leave without saving?",
    scope: `financial-refund-${receipt.id}`,
  })

  function resetMutation() {
    requestKey.reset()
    setFeedback(null)
    setDirty(true)
  }

  function editAmount(next: string) {
    setAmount(next)
    setReviewedAmountPaise(null)
    setReviewedAllocations([])
    setAllocationValues({})
    resetMutation()
  }

  async function review() {
    if (pending) return
    const amountPaise = parseRupeesToPaise(amount)
    if (amountPaise === null) {
      setFeedback({ message: "Enter a valid refund amount", tone: "error" })
      amountRef.current?.focus()
      return
    }
    setPending("preview")
    try {
      const result = await previewRefundAllocationsAction({
        amountPaise,
        expectedPaymentRevision: receipt.recordRevision,
        paymentId: receipt.id,
        withdrawalEffectiveOn,
      })
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        if (result.field === "amountPaise") amountRef.current?.focus()
        return
      }
      const suggested = new Map(result.data.allocations.map((allocation) => [
        allocation.paymentAllocationId,
        allocation.amountPaise,
      ]))
      setReviewedAllocations(result.data.allocations)
      setAllocationValues(createAllocationDraft(result.data.allocations.map((allocation) => ({
        id: allocation.paymentAllocationId,
        amountPaise: suggested.get(allocation.paymentAllocationId) ?? 0,
      }))))
      setReviewedAmountPaise(result.data.amountPaise)
      setFeedback(null)
      setDirty(true)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The refund could not be reviewed",
        retained: "Your refund details are still on screen",
        subject: "The refund review",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || reviewedAmountPaise === null || !allocationValidation?.ok) return
    if (!window.confirm(
      `Record a ${formatInr(reviewedAmountPaise)} refund for ${receipt.receiptReference} and end the fee plan on ${formatDueDate(withdrawalEffectiveOn)}?`,
    )) return

    const reviewedAllocation = reviewedAllocations[0]
    if (!reviewedAllocation) return
    setPending("record")
    try {
      const result = await recordRefundAction({
        allocations: allocationValidation.allocations.map((allocation) => ({
          amountPaise: allocation.amountPaise,
          paymentAllocationId: allocation.id,
        })),
        amountPaise: reviewedAmountPaise,
        expectedAgreementRevision: reviewedAllocation.expectedAgreementRevision,
        expectedChargeRevision: reviewedAllocation.expectedChargeRevision,
        expectedPaymentRevision: receipt.recordRevision,
        externalReference: externalReference.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
        method,
        mutationId: requestKey.current(),
        paymentId: receipt.id,
        refundedOn,
        withdrawalEffectiveOn,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        setAmount("")
        setExternalReference("")
        setInternalNote("")
        setAllocationValues({})
        setReviewedAllocations([])
        setReviewedAmountPaise(null)
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The refund could not be recorded",
        retained: "Your refund details are still on screen",
        subject: "The refund",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <details className={styles.refundForm}>
      <summary>Record mid-term withdrawal refund</summary>
      <form autoComplete="off" onSubmit={(event) => void submit(event)}>
        <p className={styles.concessionHelp}>
          Use this only when a fully paid member leaves mid-month. The unused-training
          credit and offline refund are recorded together, so no new balance is created.
        </p>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Refund amount</span>
            <div className={styles.moneyInput}>
              <span aria-hidden="true">₹</span>
              <input
                ref={amountRef}
                name="refundAmount"
                inputMode="decimal"
                value={amount}
                disabled={Boolean(pending)}
                onChange={(event) => editAmount(event.target.value)}
              />
            </div>
            <small>Enter the coach-approved amount for the unused training period.</small>
          </label>
          <label className={styles.field}>
            <span>Member withdrew on</span>
            <input
              name="withdrawalEffectiveOn"
              type="date"
              min={receipt.receivedOn}
              max={getAcademyDateKey()}
              value={withdrawalEffectiveOn}
              disabled={Boolean(pending)}
              onChange={(event) => {
                setWithdrawalEffectiveOn(event.target.value)
                setReviewedAmountPaise(null)
                setReviewedAllocations([])
                setAllocationValues({})
                resetMutation()
              }}
            />
          </label>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Refunded on</span>
            <input
              name="refundedOn"
              type="date"
              min={withdrawalEffectiveOn || receipt.receivedOn}
              max={getAcademyDateKey()}
              value={refundedOn}
              disabled={Boolean(pending)}
              onChange={(event) => { setRefundedOn(event.target.value); resetMutation() }}
            />
          </label>
          <label className={styles.field}>
            <span>Refund method</span>
            <select name="refundMethod" value={method} disabled={Boolean(pending)} onChange={(event) => { setMethod(event.target.value as PaymentMethod); resetMutation() }}>
              {paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span>Reference <em>Optional</em></span>
          <input name="externalReference" value={externalReference} disabled={Boolean(pending)} onChange={(event) => { setExternalReference(event.target.value); resetMutation() }} />
        </label>

        <label className={styles.field}>
          <span>Internal note <em>Optional</em></span>
          <textarea name="internalNote" rows={2} value={internalNote} disabled={Boolean(pending)} onChange={(event) => { setInternalNote(event.target.value); resetMutation() }} />
        </label>

        {reviewedAmountPaise === null ? (
          <div className={styles.paymentFooter}>
            <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
            <button className={styles.quietButton} type="button" disabled={Boolean(pending)} onClick={() => void review()}>
              {pending === "preview"
                ? "Reviewing…"
                : feedback?.offerRetry ? "Review refund again" : "Review refund"}
            </button>
          </div>
        ) : (
          <div className={styles.allocationReview}>
            <div className={styles.allocationHeading}>
              <div><span>Refund allocation</span><strong>{formatInr(reviewedAmountPaise)} returned from these fees</strong></div>
              <button type="button" disabled={Boolean(pending)} onClick={() => editAmount(amount)}>Recalculate</button>
            </div>
            <div className={styles.allocationRows}>
              {reviewedAllocations.map((allocation) => (
                <label key={allocation.paymentAllocationId} className={styles.allocationRow}>
                  <span>
                    <strong>{allocation.description}</strong>
                    <small>{allocation.feeReference} · Refundable {formatInr(allocation.refundablePaise)}</small>
                  </span>
                  <span className={styles.allocationInput}>
                    <span aria-hidden="true">₹</span>
                    <input
                      id={`refund-allocation-${allocation.paymentAllocationId}`}
                      name={`refundAllocation.${allocation.paymentAllocationId}`}
                      inputMode="decimal"
                      aria-label={`Refund allocated from ${allocation.description}`}
                      aria-invalid={invalidAllocationId === allocation.paymentAllocationId || undefined}
                      aria-describedby={invalidAllocationId === allocation.paymentAllocationId
                        ? allocationFeedbackId
                        : undefined}
                      value={allocationValues[allocation.paymentAllocationId] ?? "0"}
                      disabled={Boolean(pending)}
                      onChange={(event) => {
                        setAllocationValues((current) => ({ ...current, [allocation.paymentAllocationId]: event.target.value }))
                        resetMutation()
                      }}
                    />
                  </span>
                </label>
              ))}
            </div>
            <div className={styles.paymentFooter}>
              <InlineNotice
                className={styles.notice}
                id={allocationFeedbackId}
                message={feedback?.message ?? (allocationValidation && !allocationValidation.ok ? allocationValidation.message : undefined)}
                tone={feedback?.tone ?? (allocationValidation && !allocationValidation.ok ? "error" : undefined)}
              />
              <button className={styles.correctionButton} type="submit" disabled={Boolean(pending) || !allocationValidation?.ok}>
                {pending === "record"
                  ? "Recording…"
                  : feedback?.offerRetry ? "Record refund again" : "Record refund"}
              </button>
            </div>
          </div>
        )}
      </form>
    </details>
  )
}
