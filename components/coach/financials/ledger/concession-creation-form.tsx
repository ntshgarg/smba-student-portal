"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import { createConcessionAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { ConcessionMode, ConcessionValueKind } from "@/lib/finance/types"
import { parseRupeesToPaise } from "@/lib/format"

import {
  parsePercentageToBasisPoints,
} from "../allocation-draft"
import { resultFeedback, useIdempotencyKey } from "../financials-client-utils"
import styles from "../financials.module.css"
import type { SaveFeedback } from "./save-feedback"

export function ConcessionCreationForm({
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
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
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
          : "Enter a whole percentage from 1% to 100%",
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
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The concession could not be created",
        retained: "Your concession details are still on screen",
        subject: "The concession",
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
              inputMode={valueKind === "fixed" ? "decimal" : "numeric"}
              value={value}
              disabled={pending}
              placeholder={valueKind === "fixed" ? "500" : "10"}
              onChange={(event) => { setValue(event.target.value); markDirty() }}
            />
          </div>
          <small>
            {valueKind === "fixed"
              ? "The concession cannot exceed the remaining fee."
              : "A whole percentage of the original charge, capped by its remaining fee."}
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
            {pending ? "Creating…" : feedback?.offerRetry ? "Create concession again" : "Create concession"}
          </button>
        </div>
      </form>
    </details>
  )
}
