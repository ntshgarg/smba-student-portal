"use client"

import { CircleAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import { replaceFeeAgreementAction } from "@/app/coach/financials/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatInr, getAcademyDateKey, parseRupeesToPaise } from "@/lib/format"

import {
  resultFeedback,
  useIdempotencyKey,
} from "../financials-client-utils"
import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"
import type { SaveFeedback } from "./save-feedback"

export function FeePlanEditor({ ledger }: { ledger: PlayerFinancialLedgerView }) {
  const router = useRouter()
  const agreement = ledger.feePlan
  const defaults = ledger.enrollmentDefaults
  const [amount, setAmount] = useState(agreement ? String(agreement.agreedMonthlyFeePaise / 100) : "")
  const [effectiveMonth, setEffectiveMonth] = useState(getAcademyDateKey().slice(0, 7))
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
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
    const agreedMonthlyFeePaise = parseRupeesToPaise(amount)
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
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The fee plan could not be updated",
        retained: "Your fee and effective month are still on screen",
        subject: "The fee plan change",
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

  // No agreement means onboarding has not issued one yet; `player-ledger.tsx`
  // renders the setup panel in that branch, so returning null here is delegation.
  if (!agreement) return null

  /*
   * A classification that no longer forms a valid Level/Batch/Plan combination --
   * a player recorded as Advanced on the weekend before that pairing was retired,
   * say. Saying so beats the blank space this used to render.
   */
  if (!defaults) {
    return (
      <section className={styles.setupState}>
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>This player&rsquo;s training classification needs review</strong>
          <p>Their Level, Batch and Academy Plan no longer form a combination the academy offers.</p>
          <Link href={`/coach/members?player=${ledger.playerId}`}>Open the Member Directory</Link>
        </div>
      </section>
    )
  }

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
          {/*
            * Shown in both states on purpose. Without it, a level that has no
            * standard fee is indistinguishable from one somebody forgot to price,
            * and the coach is typing the number that settles it.
            */}
          <div>
            <dt>Standard fee</dt>
            <dd>{defaults.suggestedMonthlyFeePaise === null
              ? "None — agreed per player"
              : formatInr(defaults.suggestedMonthlyFeePaise)}</dd>
          </div>
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
              {pending ? "Updating…" : feedback?.offerRetry ? "Update fee plan again" : "Update fee plan"}
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}
