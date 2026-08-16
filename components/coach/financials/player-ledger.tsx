"use client"

import { CircleAlert, Download } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import {
  applyConcessionAction,
  applyChargeAdjustmentAction,
  createConcessionAction,
  endFeeAgreementAction,
  previewRefundAllocationsAction,
  recordRefundAction,
  reconcileRegistrationFeeAction,
  replaceFeeAgreementAction,
  reverseChargeAdjustmentAction,
  reverseConcessionAction,
  reverseConcessionApplicationAction,
  reversePaymentAction,
  reverseRefundAction,
  type FinanceActionResult,
  voidChargeAction,
} from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { formatAcademyDate, getAcademyDateKey } from "@/lib/format"
import type {
  CoachConcessionApplicationView,
  CoachConcessionView,
  CoachReceiptView,
  CoachRefundView,
  ConcessionMode,
  ConcessionValueKind,
  PaymentMethod,
  RefundAllocationPreviewItem,
} from "@/lib/finance/types"

import {
  createAllocationDraft,
  parsePercentageToBasisPoints,
  parseRupeesToPaise,
  validateAllocationDraft,
} from "./allocation-draft"
import {
  formatDueDate,
  formatInr,
  paymentMethodLabel,
  paymentMethods,
  periodLabel,
  resultFeedback,
  rupeesToPaise,
  statusLabels,
  useIdempotencyKey,
} from "./financials-client-utils"
import styles from "./financials.module.css"
import type { FinancialChargeView, PlayerFinancialLedgerView } from "./types"

function RefundForm({ receipt }: { receipt: CoachReceiptView }) {
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()

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
      setFeedback({
        message: error instanceof Error ? error.message : "The refund could not be reviewed",
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
      setFeedback({
        message: error instanceof Error ? error.message : "The refund could not be recorded",
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
              {pending === "preview" ? "Reviewing…" : "Review refund"}
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
                      name={`refundAllocation.${allocation.paymentAllocationId}`}
                      inputMode="decimal"
                      aria-label={`Refund allocated from ${allocation.description}`}
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
                message={feedback?.message ?? (allocationValidation && !allocationValidation.ok ? allocationValidation.message : undefined)}
                tone={feedback?.tone ?? (allocationValidation && !allocationValidation.ok ? "error" : undefined)}
              />
              <button className={styles.correctionButton} type="submit" disabled={Boolean(pending) || !allocationValidation?.ok}>
                {pending === "record" ? "Recording…" : "Record refund"}
              </button>
            </div>
          </div>
        )}
      </form>
    </details>
  )
}

function RefundReversal({ refund }: { refund: CoachRefundView }) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      setFeedback({ message: error instanceof Error ? error.message : "The refund could not be reversed", tone: "error" })
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
        {pending ? "Reversing…" : "Reverse refund"}
      </button>
    </details>
  )
}

function ReceiptHistory({
  focused = false,
  ledger,
  readOnly = false,
  showDownloads = false,
}: {
  focused?: boolean
  ledger: PlayerFinancialLedgerView
  readOnly?: boolean
  showDownloads?: boolean
}) {
  const receipts = ledger.management.receipts
  const refunds = ledger.management.refunds

  return (
    <section className={styles.receiptSection} aria-labelledby="receipt-history-title">
      <div className={styles.sectionHeading}>
        <div><span>Collection history</span><h3 id="receipt-history-title">Receipts and refunds</h3></div>
        <p>{receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}</p>
      </div>

      {receipts.length ? (
        <div className={styles.receiptList}>
          {receipts.map((receipt, index) => {
            const receiptRefunds = refunds.filter((refund) => refund.paymentId === receipt.id)
            return (
              <details key={receipt.id} className={styles.receipt}>
                <summary>
                  {focused ? <span className={styles.receiptFolio} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}
                  <span><strong>{receipt.receiptReference}</strong><small>{formatDueDate(receipt.receivedOn)} · {paymentMethodLabel(receipt.method)}</small></span>
                  <span><strong>{formatInr(receipt.amountPaise)}</strong><small>{receipt.lifecycle === "reversed" ? "Reversed" : receipt.refundablePaise > 0 ? `${formatInr(receipt.refundablePaise)} refundable` : "Settled"}</small></span>
                </summary>
                <div className={styles.receiptBody}>
                  {showDownloads ? (
                    <a
                      aria-label={`Download receipt ${receipt.receiptReference}`}
                      className={styles.receiptDownload}
                      href={`/coach/financials/receipts/${receipt.id}/download`}
                    >
                      Download receipt
                      <Download aria-hidden="true" />
                    </a>
                  ) : null}
                  {receipt.externalReference || receipt.internalNote ? (
                    <dl className={styles.receiptMeta}>
                      {receipt.externalReference ? <div><dt>Reference</dt><dd>{receipt.externalReference}</dd></div> : null}
                      {receipt.internalNote ? <div><dt>Internal note</dt><dd>{receipt.internalNote}</dd></div> : null}
                    </dl>
                  ) : null}

                  <div className={styles.receiptAllocations}>
                    <span>Allocated to</span>
                    <ul>
                      {receipt.allocations.map((allocation) => (
                        <li key={allocation.paymentAllocationId}>
                          <span><strong>{allocation.description}</strong><small>{allocation.feeReference}</small></span>
                          <strong>{formatInr(allocation.amountPaise)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {receiptRefunds.length ? (
                    <div className={styles.refundHistory}>
                      <span>Refunds</span>
                      {receiptRefunds.map((refund) => (
                        <article key={refund.id}>
                          <div>
                            <strong>
                              {refund.purpose === "mid_term_withdrawal"
                                ? "Mid-term withdrawal"
                                : "Legacy refund"}
                              {" · "}{refund.refundReference}
                            </strong>
                            <small>
                              {refund.withdrawalEffectiveOn
                                ? `Member withdrew ${formatDueDate(refund.withdrawalEffectiveOn)} · `
                                : ""}
                              Refunded {formatDueDate(refund.refundedOn)} · {paymentMethodLabel(refund.method)} · {refund.lifecycle === "reversed" ? "Reversed" : "Recorded"}
                            </small>
                          </div>
                          <strong>{formatInr(refund.amountPaise)}</strong>
                          {refund.externalReference ? <p>Reference · {refund.externalReference}</p> : null}
                          {refund.internalNote ? <p>{refund.internalNote}</p> : null}
                          <ul className={styles.refundAllocations} aria-label={`Fees covered by refund ${refund.refundReference}`}>
                            {refund.allocations.map((allocation) => (
                              <li key={allocation.paymentAllocationId}>
                                <span>{allocation.feeReference}</span>
                                <strong>{formatInr(allocation.amountPaise)}</strong>
                              </li>
                            ))}
                          </ul>
                          {readOnly ? null : <RefundReversal refund={refund} />}
                        </article>
                      ))}
                    </div>
                  ) : null}

                  {receipt.canRefund && !readOnly ? <RefundForm receipt={receipt} /> : null}
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className={styles.emptyLedger}>No receipts have been recorded for this player yet.</div>}
    </section>
  )
}

function FeeSetupForm({
  ledger,
  period,
}: {
  ledger: PlayerFinancialLedgerView
  period: string
}) {
  const router = useRouter()
  const defaults = ledger.setupDefaults
  const [amount, setAmount] = useState(defaults ? String(defaults.suggestedMonthlyFeePaise / 100) : "")
  const [trackingMonth, setTrackingMonth] = useState(period)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished fee setup. Leave without saving?",
    scope: `financial-setup-${ledger.playerId}`,
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!defaults || pending) return
    const agreedMonthlyFeePaise = rupeesToPaise(amount)
    if (agreedMonthlyFeePaise === null) {
      setFeedback({ message: "Enter a valid agreed monthly fee", tone: "error" })
      amountRef.current?.focus()
      return
    }

    setPending(true)
    try {
      const result = await replaceFeeAgreementAction({
        academyPlan: defaults.academyPlan,
        agreedMonthlyFeePaise,
        batch: defaults.batch,
        effectiveFrom: `${trackingMonth}-01`,
        idempotencyKey: requestKey.current(),
        level: defaults.level,
        playerId: ledger.playerId,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        router.refresh()
      } else if (result.field === "agreedMonthlyFeePaise") {
        amountRef.current?.focus()
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The fee plan could not be created",
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  if (!defaults) {
    return (
      <section className={styles.setupState}>
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Complete the player’s training details first</strong>
          <p>A valid Level, Batch and Training plan are required before financial tracking can begin.</p>
          <Link href={`/coach/onboarding?player=${ledger.playerId}`}>Open Player Onboarding</Link>
        </div>
      </section>
    )
  }

  if (!ledger.feePlanSetupReady) {
    return (
      <section className={styles.setupState}>
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Assign a matching session before creating the Fee Plan</strong>
          <p>The player needs a current or future session for their assessed Level and Batch.</p>
          <Link href={`/coach/onboarding?player=${ledger.playerId}`}>Continue Player Onboarding</Link>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.setupPanel} aria-labelledby="fee-setup-title">
      <div className={styles.setupHeading}>
        <span>One-time setup</span>
        <h3 id="fee-setup-title">Create fee plan</h3>
        <p>Confirm the player’s current programme and the monthly fee agreed with the coach.</p>
      </div>

      <dl className={styles.setupDefaults}>
        <div><dt>Level</dt><dd>{defaults.level}</dd></div>
        <div><dt>Batch</dt><dd>{defaults.batch}</dd></div>
        <div><dt>Academy Plan</dt><dd>{defaults.academyPlanLabel}</dd></div>
      </dl>

      <form autoComplete="off" onSubmit={(event) => void submit(event)}>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Agreed monthly fee</span>
            <div className={styles.moneyInput}>
              <span aria-hidden="true">₹</span>
              <input
                ref={amountRef}
                name="agreedMonthlyFee"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                disabled={pending}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setDirty(true)
                  setFeedback(null)
                  requestKey.reset()
                }}
              />
            </div>
          </label>
          <label className={styles.field}>
            <span>Track from</span>
            <input
              name="trackingMonth"
              type="month"
              max={getAcademyDateKey().slice(0, 7)}
              value={trackingMonth}
              disabled={pending}
              onChange={(event) => {
                setTrackingMonth(event.target.value)
                setDirty(true)
                requestKey.reset()
              }}
            />
          </label>
        </div>

        <div className={styles.paymentFooter}>
          <InlineNotice className={styles.notice} message={feedback?.message} reserveSpace={false} tone={feedback?.tone} />
          <button className={styles.primaryButton} type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create fee plan"}
          </button>
        </div>
      </form>
    </section>
  )
}

function FeePlanEditor({ ledger }: { ledger: PlayerFinancialLedgerView }) {
  const router = useRouter()
  const agreement = ledger.feePlan
  const defaults = ledger.enrollmentDefaults
  const [amount, setAmount] = useState(agreement ? String(agreement.agreedMonthlyFeePaise / 100) : "")
  const [effectiveMonth, setEffectiveMonth] = useState(getAcademyDateKey().slice(0, 7))
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished fee-plan change. Leave without saving?",
    scope: `financial-plan-${ledger.playerId}`,
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agreement || !defaults || pending) return
    const agreedMonthlyFeePaise = rupeesToPaise(amount)
    if (agreedMonthlyFeePaise === null) {
      setFeedback({ message: "Enter a valid agreed monthly fee", tone: "error" })
      amountRef.current?.focus()
      return
    }

    setPending(true)
    try {
      const result = await replaceFeeAgreementAction({
        academyPlan: defaults.academyPlan,
        agreedMonthlyFeePaise,
        batch: defaults.batch,
        effectiveFrom: `${effectiveMonth}-01`,
        expectedAgreementRevision: agreement.recordRevision,
        idempotencyKey: requestKey.current(),
        level: defaults.level,
        playerId: ledger.playerId,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        router.refresh()
      } else if (result.field === "agreedMonthlyFeePaise") {
        amountRef.current?.focus()
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The fee plan could not be updated",
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  if (!agreement || !defaults) return null

  if (!ledger.feePlanSetupReady) {
    return (
      <section className={styles.setupState}>
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Assign a matching session before changing the Fee Plan</strong>
          <p>The player needs a current or future session for their assessed Level and Batch.</p>
          <Link href={`/coach/onboarding?player=${ledger.playerId}`}>Continue Player Onboarding</Link>
        </div>
      </section>
    )
  }

  return (
    <details className={styles.planEditor}>
      <summary>Change fee plan</summary>
      <div className={styles.planEditorBody}>
        <p>A new effective-dated plan preserves every charge already issued.</p>
        <dl className={styles.setupDefaults}>
          <div><dt>Level</dt><dd>{defaults.level}</dd></div>
          <div><dt>Batch</dt><dd>{defaults.batch}</dd></div>
          <div><dt>Academy Plan</dt><dd>{defaults.academyPlanLabel}</dd></div>
        </dl>
        <form autoComplete="off" onSubmit={(event) => void submit(event)}>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Agreed monthly fee</span>
              <div className={styles.moneyInput}>
                <span aria-hidden="true">₹</span>
                <input name="agreedMonthlyFee" ref={amountRef} inputMode="decimal" value={amount} disabled={pending} onChange={(event) => { setAmount(event.target.value); setDirty(true); requestKey.reset() }} />
              </div>
            </label>
            <label className={styles.field}>
              <span>Effective month</span>
              <input
                name="effectiveMonth"
                type="month"
                value={effectiveMonth}
                disabled={pending}
                onChange={(event) => {
                  setEffectiveMonth(event.target.value)
                  setDirty(true)
                  requestKey.reset()
                }}
              />
            </label>
          </div>
          <div className={styles.paymentFooter}>
            <InlineNotice className={styles.notice} message={feedback?.message} reserveSpace={false} tone={feedback?.tone} />
            <button className={styles.primaryButton} type="submit" disabled={pending}>
              {pending ? "Updating…" : "Update fee plan"}
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}

function FeePlanEnder({
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      setFeedback({
        message: error instanceof Error ? error.message : "The fee plan could not be ended",
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
              {pending ? "Ending…" : "End fee plan"}
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}

function concessionValueLabel(concession: CoachConcessionView) {
  if (concession.valueKind === "fixed") return formatInr(concession.value)
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(concession.value / 100)}%`
}

function ConcessionCreationForm({
  period,
  playerId,
}: {
  period: string
  playerId: string
}) {
  const router = useRouter()
  const [mode, setMode] = useState<ConcessionMode>("one_off")
  const [valueKind, setValueKind] = useState<ConcessionValueKind>("fixed")
  const [value, setValue] = useState("")
  const [startsPeriod, setStartsPeriod] = useState(period)
  const [endsPeriod, setEndsPeriod] = useState("")
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const requestKey = useIdempotencyKey()

  useUnsavedWorkGuard({
    isDirty: dirty && !pending,
    message: "You have an unfinished concession. Leave without saving?",
    scope: `financial-concession-new-${playerId}`,
  })

  function markDirty() {
    setDirty(true)
    setFeedback(null)
    requestKey.reset()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const parsedValue = valueKind === "fixed"
      ? parseRupeesToPaise(value)
      : parsePercentageToBasisPoints(value)
    if (parsedValue === null) {
      setFeedback({
        message: valueKind === "fixed"
          ? "Enter a valid concession amount"
          : "Enter a percentage from 0.01% to 100%",
        tone: "error",
      })
      valueRef.current?.focus()
      return
    }
    if (!reason.trim()) {
      setFeedback({ message: "Add a reason for this concession", tone: "error" })
      reasonRef.current?.focus()
      return
    }
    if (mode === "recurring" && (!startsPeriod || (endsPeriod && endsPeriod < startsPeriod))) {
      setFeedback({ message: "Choose a valid recurring period", tone: "error" })
      return
    }

    setPending(true)
    try {
      const result = await createConcessionAction({
        endsPeriod: mode === "recurring" ? endsPeriod || undefined : undefined,
        mode,
        mutationId: requestKey.current(),
        playerId,
        reason: reason.trim(),
        startsPeriod: mode === "recurring" ? startsPeriod : undefined,
        value: parsedValue,
        valueKind,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setDirty(false)
        setValue("")
        setReason("")
        setEndsPeriod("")
        router.refresh()
      } else if (result.field === "amountPaise") {
        valueRef.current?.focus()
      } else if (result.field === "reason") {
        reasonRef.current?.focus()
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The concession could not be created",
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <details className={styles.concessionCreate}>
      <summary>Add concession</summary>
      <form autoComplete="off" onSubmit={(event) => void submit(event)}>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Concession type</span>
            <select name="concessionMode" value={mode} disabled={pending} onChange={(event) => { setMode(event.target.value as ConcessionMode); markDirty() }}>
              <option value="one_off">One-off</option>
              <option value="recurring">Recurring monthly</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Value type</span>
            <select name="concessionValueKind" value={valueKind} disabled={pending} onChange={(event) => { setValueKind(event.target.value as ConcessionValueKind); setValue(""); markDirty() }}>
              <option value="fixed">Fixed amount</option>
              <option value="percentage">Percentage</option>
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span>{valueKind === "fixed" ? "Amount" : "Percentage"}</span>
          <div className={valueKind === "fixed" ? styles.moneyInput : undefined}>
            {valueKind === "fixed" ? <span aria-hidden="true">₹</span> : null}
            <input
              ref={valueRef}
              name="concessionValue"
              inputMode="decimal"
              value={value}
              disabled={pending}
              placeholder={valueKind === "fixed" ? "500" : "10"}
              onChange={(event) => { setValue(event.target.value); markDirty() }}
            />
          </div>
          <small>
            {valueKind === "fixed"
              ? "The concession cannot exceed the remaining fee."
              : "The percentage is calculated from the original charge and capped by its remaining fee."}
          </small>
        </label>

        {mode === "recurring" ? (
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Starts</span>
              <input name="startsPeriod" type="month" value={startsPeriod} disabled={pending} onChange={(event) => { setStartsPeriod(event.target.value); markDirty() }} />
            </label>
            <label className={styles.field}>
              <span>Ends <em>Optional</em></span>
              <input name="endsPeriod" type="month" min={startsPeriod} value={endsPeriod} disabled={pending} onChange={(event) => { setEndsPeriod(event.target.value); markDirty() }} />
            </label>
          </div>
        ) : null}

        <label className={styles.field}>
          <span>Reason</span>
          <textarea name="reason" ref={reasonRef} rows={3} value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); markDirty() }} />
        </label>

        <p className={styles.concessionHelp}>
          {mode === "one_off"
            ? "Record a concession agreed offline, then choose the fee it should reduce."
            : "Record the offline agreement once; it will apply to eligible monthly fees."}
        </p>
        <div className={styles.paymentFooter}>
          <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
          <button className={styles.primaryButton} type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create concession"}
          </button>
        </div>
      </form>
    </details>
  )
}

function ApplyConcessionForm({
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      setFeedback({ message: error instanceof Error ? error.message : "The concession could not be applied", tone: "error" })
    } finally {
      setPending(false)
    }
  }

  if (!eligibleCharges.length) {
    return concession.mode === "recurring"
      ? <p className={styles.concessionHelp}>Future eligible monthly fees will receive this concession when they are prepared.</p>
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
        {pending ? "Applying…" : "Apply concession"}
      </button>
    </form>
  )
}

function ConcessionApplicationReversal({
  application,
}: {
  application: CoachConcessionApplicationView
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      setFeedback({ message: error instanceof Error ? error.message : "The concession application could not be reversed", tone: "error" })
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
        {pending ? "Reversing…" : "Reverse application"}
      </button>
    </details>
  )
}

function ConcessionReversal({ concession }: { concession: CoachConcessionView }) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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
      setFeedback({ message: error instanceof Error ? error.message : "The concession could not be ended", tone: "error" })
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
        {pending ? "Ending…" : "End concession"}
      </button>
    </details>
  )
}

function ConcessionManagement({
  ledger,
  period,
}: {
  ledger: PlayerFinancialLedgerView
  period: string
}) {
  const concessions = ledger.management.concessions

  return (
    <details className={styles.concessions}>
      <summary>
        <span>Concessions</span>
        <small>{concessions.length} {concessions.length === 1 ? "record" : "records"}</small>
      </summary>
      <div className={styles.concessionsBody}>
        <p>
          {ledger.archived
            ? "Concessions previously recorded for this player."
            : "Use a concession to reduce a fee without changing the player’s agreed plan."}
        </p>
        {ledger.archived ? null : (
          <ConcessionCreationForm
            key={`${ledger.playerId}-${period}`}
            period={period}
            playerId={ledger.playerId}
          />
        )}

        {concessions.length ? (
          <div className={styles.concessionList}>
            {concessions.map((concession) => (
              <article key={concession.id} className={styles.concession}>
                <header>
                  <div>
                    <span>{concession.mode === "one_off" ? "One-off" : "Recurring monthly"}</span>
                    <strong>{concessionValueLabel(concession)}</strong>
                  </div>
                  <em className={concession.lifecycle === "active" ? undefined : styles.concessionEnded}>
                    {concession.lifecycle === "active" ? "Active" : "Ended"}
                  </em>
                </header>
                <p>{concession.reason}</p>
                {concession.mode === "recurring" ? (
                  <small>
                    {periodLabel(concession.startsPeriod ?? period)}
                    {concession.endsPeriod ? ` – ${periodLabel(concession.endsPeriod)}` : " onward"}
                  </small>
                ) : null}

                {ledger.archived ? null : (
                  <ApplyConcessionForm
                    key={`${concession.id}-${concession.recordRevision}`}
                    charges={ledger.charges}
                    concession={concession}
                  />
                )}

                {concession.applications.length ? (
                  <div className={styles.concessionApplications}>
                    <span>Applied fees</span>
                    {concession.applications.map((application) => (
                      <div key={application.applicationId}>
                        <div>
                          <strong>{application.feeReference}</strong>
                          <small>{formatDueDate(application.appliedOn)} · {application.lifecycle === "reversed" ? "Reversed" : "Applied"}</small>
                        </div>
                        <strong>{formatInr(application.amountPaise)}</strong>
                        {ledger.archived ? null : (
                          <ConcessionApplicationReversal application={application} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {ledger.archived ? null : <ConcessionReversal concession={concession} />}
              </article>
            ))}
          </div>
        ) : <div className={styles.emptyLedger}>No concessions have been created for this player.</div>}
      </div>
    </details>
  )
}

function RegistrationReconciliation({ ledger }: { ledger: PlayerFinancialLedgerView }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const requestKey = useIdempotencyKey()

  async function reconcile() {
    if (pending) return
    setPending(true)
    try {
      const result = await reconcileRegistrationFeeAction({
        idempotencyKey: requestKey.current(),
        playerId: ledger.playerId,
        status: "pending",
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        router.refresh()
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The registration fee record could not be updated",
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.registrationResolution} aria-labelledby="registration-resolution-title">
      <div>
        <span>Registration fee</span>
        <h3 id="registration-resolution-title">Record unresolved</h3>
        <p>Issue the one-time academy fee so its offline payment can be recorded.</p>
      </div>
      <div className={styles.registrationResolutionAction}>
        <button className={styles.primaryButton} type="button" disabled={pending} onClick={() => void reconcile()}>
          {pending ? "Issuing…" : "Issue registration fee"}
        </button>
      </div>
      <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
    </section>
  )
}

type CorrectionMode =
  | "reverse_payment"
  | "reverse_adjustment"
  | "manual_credit"
  | "manual_debit"
  | "void_charge"

function CorrectionsPanel({ ledger }: { ledger: PlayerFinancialLedgerView }) {
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()

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
      setFeedback({ message: "Add a reason for this correction", tone: "error" })
      reasonRef.current?.focus()
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
        const amountPaise = rupeesToPaise(amount)
        if (amountPaise === null) {
          setFeedback({ message: "Enter a valid adjustment amount", tone: "error" })
          amountRef.current?.focus()
          return
        }
        result = await applyChargeAdjustmentAction({
          amountPaise,
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
      setFeedback({
        message: error instanceof Error ? error.message : "The correction could not be saved",
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
                <input name="amount" ref={amountRef} inputMode="decimal" value={amount} disabled={pending} onChange={(event) => { setAmount(event.target.value); markDirty() }} />
              </div>
            </label>
          ) : null}

          <label className={styles.field}>
            <span>Reason</span>
            <textarea name="reason" ref={reasonRef} rows={3} value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); markDirty() }} />
          </label>

          <div className={styles.paymentFooter}>
            <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
            <button className={styles.correctionButton} type="submit" disabled={pending || (mode === "reverse_payment" && !paymentId) || (mode === "reverse_adjustment" && !adjustmentId) || (mode === "void_charge" && !chargeId)}>
              {pending ? "Saving…" : "Apply correction"}
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}

export function PlayerLedger({
  focused = false,
  ledger,
  period,
  showReceiptDownloads = false,
}: {
  focused?: boolean
  ledger: PlayerFinancialLedgerView
  period: string
  showReceiptDownloads?: boolean
}) {
  return (
    <article className={`${styles.ledger} ${focused ? styles.focusedLedger : ""}`} aria-labelledby="selected-ledger-title">
      <header className={styles.ledgerHeader}>
        <div>
          <span>{ledger.academyId}{ledger.archived ? " · Archived" : ""}</span>
          <h2 id="selected-ledger-title">{ledger.fullName}</h2>
          <p>{ledger.feePlan?.label ?? "Fee plan setup required"}</p>
        </div>
        <div className={styles.ledgerBalance}>
          <span>Outstanding</span>
          <strong>{formatInr(ledger.outstandingPaise)}</strong>
          <em className={styles[`status_${ledger.status}`]}>{statusLabels[ledger.status]}</em>
        </div>
      </header>

      {ledger.feePlan ? (
        <>
          <dl className={styles.feePlan}>
            <div><dt>Fee plan</dt><dd>{ledger.feePlan.label}</dd></div>
            <div><dt>Agreed monthly fee</dt><dd>{formatInr(ledger.feePlan.agreedMonthlyFeePaise)}</dd></div>
            <div><dt>Plan status</dt><dd>{ledger.feePlan.status}</dd></div>
          </dl>
          {ledger.archived ? null : (
            <>
              <FeePlanEditor ledger={ledger} />
              <FeePlanEnder ledger={ledger} period={period} />
            </>
          )}
        </>
      ) : ledger.archived ? null : <FeeSetupForm ledger={ledger} period={period} />}

      {!ledger.archived && !ledger.charges.some((charge) => (
        charge.type === "registration" && charge.status !== "void"
      )) ? (
        <RegistrationReconciliation ledger={ledger} />
      ) : null}

      {(!ledger.archived && ledger.feePlan)
        || (ledger.archived && ledger.management.concessions.length > 0) ? (
        <ConcessionManagement ledger={ledger} period={period} />
      ) : null}

      <ReceiptHistory
        focused={focused}
        ledger={ledger}
        readOnly={ledger.archived}
        showDownloads={showReceiptDownloads}
      />

      <section className={styles.chargeSection} aria-labelledby="fee-ledger-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Player ledger</span>
            <h3 id="fee-ledger-title">Charges and payments</h3>
          </div>
          <p>{ledger.charges.length} {ledger.charges.length === 1 ? "charge" : "charges"}</p>
        </div>

        {ledger.charges.length ? (
          <div className={styles.chargeList}>
            {ledger.charges.map((charge, index) => (
              <article key={charge.id} className={styles.charge}>
                <div className={styles.chargeHeading}>
                  {focused ? <span className={styles.chargeFolio} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}
                  <div>
                    <span>{charge.type === "registration" ? "Registration" : "Monthly training"}</span>
                    <h4>{charge.description}</h4>
                    <small>{charge.feeReference}</small>
                  </div>
                  <em className={styles[`status_${charge.status}`]}>{statusLabels[charge.status]}</em>
                </div>

                <dl className={styles.chargeAmounts}>
                  <div><dt>Charged</dt><dd>{formatInr(charge.effectiveAmountPaise)}</dd></div>
                  <div><dt>Received</dt><dd>{formatInr(charge.receivedPaise)}</dd></div>
                  <div><dt>Remaining</dt><dd>{formatInr(charge.outstandingPaise)}</dd></div>
                  <div><dt>Due</dt><dd>{formatDueDate(charge.dueDate)}</dd></div>
                </dl>

                {charge.payments.length ? (
                  <details className={styles.paymentHistory}>
                    <summary>{charge.payments.length} {charge.payments.length === 1 ? "payment" : "payments"}</summary>
                    <ul>
                      {charge.payments.map((payment) => (
                        <li key={payment.id}>
                          <div>
                            <strong>{formatInr(payment.amountPaise)}</strong>
                            <span>{paymentMethodLabel(payment.method)}{payment.reversed ? " · Reversed" : ""}</span>
                          </div>
                          <div>
                            <time dateTime={payment.receivedOn}>{formatDueDate(payment.receivedOn)}</time>
                            {payment.reference ? <small>{payment.reference}</small> : null}
                            {payment.internalNote ? <small>{payment.internalNote}</small> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {charge.adjustments.length ? (
                  <details className={styles.paymentHistory}>
                    <summary>{charge.adjustments.length} {charge.adjustments.length === 1 ? "adjustment" : "adjustments"}</summary>
                    <ul>
                      {charge.adjustments.map((adjustment) => (
                        <li key={adjustment.id}>
                          <div>
                            <strong>{formatInr(adjustment.amountPaise)}</strong>
                            <span>{adjustment.kind.replaceAll("_", " ")}{adjustment.reversed ? " · Reversed" : ""}</span>
                          </div>
                          <div>
                            <time dateTime={adjustment.createdAt}>{formatAcademyDate(adjustment.createdAt, { day: "numeric", month: "short", year: "numeric" })}</time>
                            <small>{adjustment.reason}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyLedger}>No fee records have been issued for this player yet.</div>
        )}
      </section>

      {ledger.archived ? null : <CorrectionsPanel ledger={ledger} />}
    </article>
  )
}
