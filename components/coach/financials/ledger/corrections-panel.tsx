"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import {
  applyChargeAdjustmentAction,
  reverseChargeAdjustmentAction,
  reversePaymentAction,
  type FinanceActionResult,
  voidChargeAction,
} from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatInr } from "@/lib/format"

import {
  formatDueDate,
  resultFeedback,
  rupeesToPaise,
  useIdempotencyKey,
} from "../financials-client-utils"
import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import type { SaveFeedback } from "./save-feedback"

type CorrectionMode =
  | "reverse_payment"
  | "reverse_adjustment"
  | "manual_credit"
  | "manual_debit"
  | "void_charge"

type CorrectionFeedback = SaveFeedback & {
  field?: "amount" | "reason"
}

export function CorrectionsPanel({ ledger }: { ledger: PlayerFinancialLedgerView }) {
  const router = useRouter()
  const activeCharges = ledger.charges.filter((charge) => charge.status !== "void")
  const receipts = ledger.management.receipts.filter((receipt) => (
    receipt.lifecycle === "recorded"
    && !receipt.refunds.some((refund) => refund.lifecycle === "recorded")
  ))
  const adjustments = activeCharges.flatMap((charge) => charge.adjustments
    .filter((adjustment) => (
      adjustment.canReverse
      && !adjustment.reversed
      && adjustment.kind !== "concession_credit"
    ))
    .map((adjustment) => ({ adjustment, charge })))
  const voidableCharges = activeCharges.filter((charge) => charge.canVoid)
  const [mode, setMode] = useState<CorrectionMode>("manual_credit")
  const [chargeId, setChargeId] = useState(activeCharges[0]?.id ?? "")
  const [paymentId, setPaymentId] = useState(receipts[0]?.id ?? "")
  const [adjustmentId, setAdjustmentId] = useState(adjustments[0]?.adjustment.id ?? "")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<CorrectionFeedback | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()
  const feedbackId = `correction-feedback-${ledger.playerId}`
  const invalidField = feedback?.tone === "error" ? feedback.field : undefined

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished financial correction. Leave without saving?",
    scope: `financial-correction-${ledger.playerId}`,
  })

  function markDirty() {
    setDirty(true)
    setFeedback(null)
    requestKey.reset()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!reason.trim()) {
      setFeedback({ field: "reason", message: "Add a reason for this correction", tone: "error" })
      reasonRef.current?.focus()
      return
    }

    // The amount has to be checked before the confirmation, otherwise the coach
    // approves a correction and only then learns the amount was unusable.
    const isManualAdjustment = mode === "manual_credit" || mode === "manual_debit"
    const adjustmentAmountPaise = isManualAdjustment ? rupeesToPaise(amount) : 0
    if (adjustmentAmountPaise === null) {
      setFeedback({ field: "amount", message: "Enter a valid adjustment amount", tone: "error" })
      amountRef.current?.focus()
      return
    }

    const confirmed = window.confirm(
      mode === "reverse_payment"
        ? "Reverse this recorded payment? The original record will remain in the audit history."
        : mode === "reverse_adjustment"
          ? "Reverse this adjustment? The original record will remain in the audit history."
          : mode === "void_charge"
            ? "Void this charge? The original record will remain in the audit history."
            : "Apply this adjustment to the selected charge?",
    )
    if (!confirmed) return

    setPending(true)
    try {
      let result: FinanceActionResult
      if (mode === "reverse_payment") {
        result = await reversePaymentAction({
          idempotencyKey: requestKey.current(),
          paymentId,
          reason: reason.trim(),
        })
      } else if (mode === "reverse_adjustment") {
        result = await reverseChargeAdjustmentAction({
          adjustmentId,
          idempotencyKey: requestKey.current(),
          reason: reason.trim(),
        })
      } else if (mode === "void_charge") {
        const charge = voidableCharges.find((item) => item.id === chargeId)
        if (!charge) {
          setFeedback({ message: "This charge cannot be voided", tone: "error" })
          return
        }
        result = await voidChargeAction({
          chargeId,
          expectedChargeRevision: charge.revision,
          idempotencyKey: requestKey.current(),
          reason: reason.trim(),
        })
      } else {
        result = await applyChargeAdjustmentAction({
          amountPaise: adjustmentAmountPaise,
          chargeId,
          idempotencyKey: requestKey.current(),
          kind: mode as "manual_credit" | "manual_debit",
          reason: reason.trim(),
        })
      }

      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        setAmount("")
        setReason("")
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The correction could not be saved",
        retained: "Your correction details are still on screen",
        subject: "The correction",
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

  if (!activeCharges.length) return null

  return (
    <details className={styles.corrections}>
      <summary>Corrections</summary>
      <div className={styles.correctionsBody}>
        <p>Use corrections only when a recorded fee or payment needs to be reconciled. Nothing is deleted.</p>
        <form autoComplete="off" onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>
            <span>Correction</span>
            <select
              name="correctionType"
              value={mode}
              disabled={pending}
              onChange={(event) => {
                const nextMode = event.target.value as CorrectionMode
                setMode(nextMode)
                if (nextMode === "reverse_payment") setPaymentId(receipts[0]?.id ?? "")
                if (nextMode === "reverse_adjustment") setAdjustmentId(adjustments[0]?.adjustment.id ?? "")
                if (nextMode === "void_charge") setChargeId(voidableCharges[0]?.id ?? "")
                markDirty()
              }}
            >
              <option value="manual_credit">Apply credit</option>
              <option value="manual_debit">Apply additional charge</option>
              <option value="reverse_payment" disabled={!receipts.length}>Reverse payment</option>
              <option value="reverse_adjustment" disabled={!adjustments.length}>Reverse adjustment</option>
              <option value="void_charge" disabled={!voidableCharges.length}>Void charge</option>
            </select>
          </label>

          {mode === "reverse_payment" ? (
            <label className={styles.field}>
              <span>Recorded payment</span>
              <select name="paymentId" value={paymentId} disabled={pending} onChange={(event) => { setPaymentId(event.target.value); markDirty() }}>
                {receipts.map((receipt) => (
                  <option key={receipt.id} value={receipt.id}>
                    {formatInr(receipt.amountPaise)} · {receipt.receiptReference} · {formatDueDate(receipt.receivedOn)}
                  </option>
                ))}
              </select>
            </label>
          ) : mode === "reverse_adjustment" ? (
            <label className={styles.field}>
              <span>Recorded adjustment</span>
              <select name="adjustmentId" value={adjustmentId} disabled={pending} onChange={(event) => { setAdjustmentId(event.target.value); markDirty() }}>
                {adjustments.map(({ adjustment, charge }) => (
                  <option key={adjustment.id} value={adjustment.id}>
                    {adjustment.kind.replaceAll("_", " ")} · {formatInr(adjustment.amountPaise)} · {charge.feeReference}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={styles.field}>
              <span>Charge</span>
              <select name="chargeId" value={chargeId} disabled={pending} onChange={(event) => { setChargeId(event.target.value); markDirty() }}>
                {(mode === "void_charge" ? voidableCharges : activeCharges).map((charge) => (
                  <option key={charge.id} value={charge.id}>{charge.description} · {charge.feeReference}</option>
                ))}
              </select>
            </label>
          )}

          {mode === "manual_credit" || mode === "manual_debit" ? (
            <label className={styles.field}>
              <span>Amount</span>
              <div className={styles.moneyInput}>
                <span aria-hidden="true">₹</span>
                <input name="amount" ref={amountRef} inputMode="decimal" value={amount} disabled={pending} aria-invalid={invalidField === "amount" || undefined} aria-describedby={invalidField === "amount" ? feedbackId : undefined} onChange={(event) => { setAmount(event.target.value); markDirty() }} />
              </div>
            </label>
          ) : null}

          <label className={styles.field}>
            <span>Reason</span>
            <textarea name="reason" ref={reasonRef} rows={3} value={reason} disabled={pending} aria-invalid={invalidField === "reason" || undefined} aria-describedby={invalidField === "reason" ? feedbackId : undefined} onChange={(event) => { setReason(event.target.value); markDirty() }} />
          </label>

          <div className={styles.paymentFooter}>
            <InlineNotice className={styles.notice} id={feedbackId} message={feedback?.message} tone={feedback?.tone} />
            <button className={styles.correctionButton} type="submit" disabled={pending || (mode === "reverse_payment" && !paymentId) || (mode === "reverse_adjustment" && !adjustmentId) || (mode === "void_charge" && !chargeId)}>
              {pending ? "Saving…" : feedback?.offerRetry ? "Apply correction again" : "Apply correction"}
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}
