"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"

import {
  completeOnboardingFinanceAction,
  previewOnboardingFinanceAction,
} from "@/app/coach/financials/actions"
import { resetOnboardingSessionAssignmentAction } from "@/app/coach/onboarding/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  formatBillingPeriod,
  formatFinanceDate,
} from "@/components/financials/player-finance-presentation"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import { formatDateKey, formatInr, parseRupeesToPaise } from "@/lib/format"
import type { OnboardingFinancePreview } from "@/lib/finance/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

import styles from "../player-onboarding-register.module.css"
import type { SaveFeedback } from "./shared"

/**
 * Reset and the fee submit share one notice, so the retry prompt names which of
 * the two the coach should repeat.
 */
type FeePlanStepFeedback = SaveFeedback & {
  field?: "confirmation" | "monthlyFee"
  retryAction?: "reset" | "submit"
}

export function FeePlanStep({
  financeActive,
  item,
  onSuccess,
  referenceDate,
}: {
  financeActive: boolean
  item: PlayerOnboardingCase
  onSuccess: (input: { message: string; remove: boolean }) => void
  referenceDate: string
}) {
  const [monthlyFee, setMonthlyFee] = useState("")
  const [preview, setPreview] = useState<OnboardingFinancePreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [feedback, setFeedback] = useState<FeePlanStepFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const monthlyFeeRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const feedbackId = `onboarding-${item.id}-fee-feedback`
  const monthlyFeeInvalid = feedback?.tone === "error" && feedback.field === "monthlyFee"
  const confirmationInvalid = feedback?.tone === "error" && feedback.field === "confirmation"
  const isDirty = monthlyFee !== "" || preview !== null || confirmed
  const guard = useUnsavedWorkGuard({
    isDirty,
    scope: `onboarding-fee-plan-${item.id}`,
  })

  async function resetAssignment() {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    let result: Awaited<ReturnType<typeof resetOnboardingSessionAssignmentAction>>
    try {
      result = await resetOnboardingSessionAssignmentAction(item.id)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The session assignment could not be reset",
        retained: "Nothing has changed on this player",
        subject: "The session assignment reset",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "reset",
        tone: "error",
      })
      return
    } finally {
      setBusy(false)
    }
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    setPreview(null)
    setConfirmed(false)
    guard.navigateAfterCommit(() => onSuccess({
      message: `${item.fullName}’s unfinished assignment was reset. Confirm the assessment again.`,
      remove: false,
    }))
  }

  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined

  if (!financeActive) {
    return (
      <div className={styles.recoveryPanel}>
        <strong>Activate Financials before recording this Fee Plan.</strong>
        <p>The player will remain here; no onboarding information will be lost.</p>
        <Link
          className={styles.primaryButton}
          href={`/coach/financials?period=${referenceDate.slice(0, 7)}&player=${encodeURIComponent(item.id)}`}
        >
          Set up Financials <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    )
  }

  if (item.feePlanRecorded) {
    return (
      <div className={styles.recoveryPanel}>
        <strong>An existing Fee Plan needs review.</strong>
        <p>Open the player’s finance record to resolve its dates or training classification safely.</p>
        <Link
          className={styles.primaryButton}
          href={`/coach/financials/players/${encodeURIComponent(item.id)}?mode=monthly`}
        >
          Review Fee Plan <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    )
  }

  if (item.trainingStartOn && item.trainingStartOn > referenceDate) {
    return (
      <div className={styles.recoveryPanel}>
        <strong>Fee completion opens on {formatDateKey(item.trainingStartOn)}.</strong>
        <p>The future training date is saved. Assessment and session setup can be prepared now, but fees and the permanent date lock wait until training begins.</p>
        <p>Resetting the session assignment reopens the assessment, which is the only step where the training start date can be changed.</p>
        <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
        <button type="button" disabled={busy} onClick={() => void resetAssignment()}>
          {busy
            ? "Resetting…"
            : retryAction === "reset" ? "Reset session assignment again" : "Reset session assignment"}
        </button>
      </div>
    )
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !item.level || !item.batch || !item.academyPlan) return
    /*
     * Parsed here rather than by `type="number" min step`, which refused the
     * same amounts but refused them in Chrome's voice — a native bubble reading
     * "The two nearest valid values are 3500 and 3501" — because native
     * constraint validation blocks submit before this handler runs, so the
     * message below was unreachable. It also made the `3,500` placeholder a
     * lie: a `number` input will not accept the separator it was showing.
     */
    const agreedMonthlyFeePaise = parseRupeesToPaise(monthlyFee)
    if (agreedMonthlyFeePaise === null) {
      setFeedback({
        field: "monthlyFee",
        message: "Enter the agreed monthly fee, like 3,500.",
        tone: "error",
      })
      monthlyFeeRef.current?.focus()
      return
    }
    const terms = {
      playerId: item.id,
      academyPlan: item.academyPlan,
      level: item.level,
      batch: item.batch,
      agreedMonthlyFeePaise,
      monthlyDueDay: 5,
    }
    if (!preview) {
      setBusy(true)
      setFeedback(null)
      let previewResult: Awaited<ReturnType<typeof previewOnboardingFinanceAction>>
      try {
        previewResult = await previewOnboardingFinanceAction(terms)
      } catch (error) {
        const failure = describeSaveFailure({
          error,
          fallbackMessage: "The Fee Plan could not be saved",
          retained: "The agreed monthly fee is still on screen",
          subject: "The fee timeline",
        })
        setFeedback({
          message: failure.message,
          offerRetry: failure.offerRetry,
          retryAction: "submit",
          tone: "error",
        })
        return
      } finally {
        setBusy(false)
      }
      if (!previewResult.ok) {
        setFeedback({ message: previewResult.message, tone: "error" })
        return
      }
      setPreview(previewResult.data)
      setConfirmed(false)
      setFeedback({
        message: previewResult.data.blockers.length
          ? "Review the blockers below before completing onboarding."
          : "Fee timeline ready. Confirm the permanent training start date to complete onboarding.",
        tone: previewResult.data.blockers.length ? "error" : "success",
      })
      return
    }
    if (preview.blockers.length) {
      setFeedback({ message: "Resolve every blocker, then generate a fresh fee timeline.", tone: "error" })
      return
    }
    if (!confirmed) {
      setFeedback({
        field: "confirmation",
        message: "Confirm the permanent training start date before completing onboarding.",
        tone: "error",
      })
      confirmationRef.current?.focus()
      return
    }
    setBusy(true)
    setFeedback(null)
    let result: Awaited<ReturnType<typeof completeOnboardingFinanceAction>>
    try {
      result = await completeOnboardingFinanceAction({
        ...terms,
        previewFingerprint: preview.fingerprint,
      })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The Fee Plan could not be saved",
        retained: "The fee timeline is still on screen",
        subject: "The Fee Plan",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "submit",
        tone: "error",
      })
      return
    } finally {
      setBusy(false)
    }
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        setPreview(null)
        setConfirmed(false)
      }
      setFeedback({
        message: result.code === "CONFLICT"
          ? `${result.message} Generate a fresh fee timeline.`
          : result.message,
        tone: "error",
      })
      return
    }
    guard.navigateAfterCommit(() => onSuccess({
      message: `${item.fullName} is fully onboarded. ${result.message}.`,
      remove: true,
    }))
  }

  return (
    <form className={styles.feePlanForm} autoComplete="off" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <dl className={styles.trainingFacts}>
        <div><dt>Level</dt><dd>{item.level}</dd></div>
        <div><dt>Batch</dt><dd>{item.batch}</dd></div>
        <div><dt>Training plan</dt><dd>{academyPlanLabel(item.academyPlan)}</dd></div>
      </dl>
      <div className={styles.feeFields}>
        <label>
          <span>Agreed monthly fee</span>
          <span className={styles.moneyInput}><b>₹</b><input
            ref={monthlyFeeRef}
            name="monthlyFee"
            inputMode="decimal"
            value={monthlyFee}
            placeholder="3,500"
            aria-invalid={monthlyFeeInvalid || undefined}
            aria-describedby={monthlyFeeInvalid ? feedbackId : undefined}
            onChange={(event) => {
              setMonthlyFee(event.target.value)
              setPreview(null)
              setConfirmed(false)
              setFeedback(null)
            }}
          /></span>
        </label>
        <div className={styles.derivedFeeMonth}>
          <span>Fee timeline</span>
          <strong>{preview ? formatBillingPeriod(preview.feePlanStartOn.slice(0, 7)) : "Derived from training"}</strong>
          <small>The server uses the confirmed start date and session assignment.</small>
        </div>
      </div>
      <p className={styles.feeNote}>
        Review first. Completing onboarding issues the registration fee and every applicable monthly fee. The joining month is prorated by eligible scheduled sessions and rounded once to the nearest ₹50.
      </p>
      {preview ? (
        <section className={styles.feePreview} aria-labelledby={`onboarding-${item.id}-fee-preview-title`}>
          <header>
            <div>
              <span>Derived fee timeline</span>
              <h4 id={`onboarding-${item.id}-fee-preview-title`}>
                {formatBillingPeriod(preview.feePlanStartOn.slice(0, 7))} onward
              </h4>
            </div>
            <div>
              <span>Issued now</span>
              <strong>{formatInr(preview.totalIssuedPaise)}</strong>
            </div>
          </header>
          <div className={styles.previewLines}>
            {preview.lines.map((line, index) => (
              <article key={`${line.kind}:${line.period ?? "registration"}:${index}`}>
                <div>
                  <span>{line.period ? formatBillingPeriod(line.period) : "Registration"}</span>
                  <strong>{line.description}</strong>
                </div>
                <div>
                  <span>{line.kind === "before_tracking" ? "Record only" : line.dueDate ? `Due ${formatFinanceDate(line.dueDate)}` : "No charge due"}</span>
                  <strong>{line.amountPaise === null ? "Before tracking" : formatInr(line.amountPaise)}</strong>
                  {line.numerator !== null && line.denominator !== null ? (
                    <small>{line.numerator} of {line.denominator} eligible sessions</small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {preview.warnings.length ? (
            <div className={styles.previewWarnings}>
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}
          {preview.blockers.length ? (
            <div className={styles.previewBlockers} role="alert">
              <strong>Resolve before completion</strong>
              <ul>{preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          ) : (
            <label className={styles.finalConfirmation}>
              <input
                ref={confirmationRef}
                type="checkbox"
                name="confirmTrainingStart"
                value="confirmed"
                required
                checked={confirmed}
                aria-invalid={confirmationInvalid || undefined}
                aria-describedby={confirmationInvalid ? feedbackId : undefined}
                onChange={(event) => {
                  setConfirmed(event.target.checked)
                  setFeedback(null)
                }}
              />
              <span>
                <strong>Training start date: {formatDateKey(preview.trainingStartOn)}</strong>
                I confirm this is the start of the player’s current continuous training period. It cannot be changed after onboarding is completed.
              </span>
            </label>
          )}
        </section>
      ) : null}
      <InlineNotice id={feedbackId} message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <p className={styles.feeNote}>
        Changing the training start date means resetting the session assignment. That reopens
        the assessment, which is the only step where the date can be edited — the register
        shows one step per player, so there is no other way back to it. Resetting stops being
        possible once academy records exist against the assignment.
      </p>
      <div className={styles.formActions}>
        <button type="button" disabled={busy} onClick={() => void resetAssignment()}>
          {retryAction === "reset" ? "Reset session assignment again" : "Reset session assignment"}
        </button>
        <button className={styles.primaryButton} type="submit" disabled={busy}>
          {busy
            ? preview ? "Completing…" : "Building timeline…"
            : retryAction === "submit"
              ? preview ? "Complete onboarding again" : "Review fee timeline again"
              : !preview
                ? "Review fee timeline"
                : preview.blockers.length
                  ? "Resolve blockers"
                  : "Complete onboarding & issue fees"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
