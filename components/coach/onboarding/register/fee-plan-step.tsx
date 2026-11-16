"use client"

import { ArrowRight, Lock } from "lucide-react"
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

import styles from "../player-onboarding-register.module.css"
import type { SaveFeedback } from "./shared"

/**
 * The two notices a fee preview can carry, split out so they can be rendered on
 * their own. Inside the step they are only reachable after a preview action
 * comes back, which no static render can drive -- so the block that decides
 * whether a coach may complete onboarding had no test of any kind.
 */
export function FeePreviewWarnings({ warnings }: { warnings: readonly string[] }) {
  if (!warnings.length) return null
  return (
    <div className={styles.previewWarnings}>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>
  )
}

export function FeePreviewBlockers({ blockers }: { blockers: readonly string[] }) {
  if (!blockers.length) return null
  return (
    <div className={styles.previewBlockers} role="alert">
      <strong>Fix before finishing</strong>
      <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
    </div>
  )
}

/** The confirm box's date, in the tense it is in: a start later than today has not happened yet. */
export function trainingStartLine(trainingStartOn: string, referenceDate: string) {
  return `${trainingStartOn > referenceDate ? "Training starts" : "Training started"} ${formatDateKey(trainingStartOn)}`
}

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
        retained: "Nothing has changed on this player",
        unconfirmed: "Check the connection, then reload the page to see whether the session assignment was reset",
        subject: "The session assignment reset",
      })
      setFeedback({
        action: failure.signIn,
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
      message: `${item.fullName}’s first schedule was cleared. Choose their first schedule and training day again on the Session step.`,
      remove: false,
    }))
  }

  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined
  /*
   * Nothing can be derived from an empty fee, so "Review fees" is held
   * back rather than offered and then refused. A malformed amount is NOT held
   * back -- `parseRupeesToPaise` rejecting "35oo" is worth saying out loud, and a
   * button that silently will not press says nothing.
   */
  const awaitingFee = !preview && monthlyFee.trim() === ""

  const firstName = item.fullName.split(/\s+/u)[0]

  if (!financeActive) {
    return (
      <div className={styles.stepBody}>
        <div className={styles.emptyBox}>
          <strong>Fees aren’t tracked yet</strong>
          <p>{firstName} stays here; no onboarding information is lost.</p>
        </div>
        <div className={styles.formActions}>
          <Link
            className={styles.primaryButton}
            href={`/coach/financials?period=${referenceDate.slice(0, 7)}&player=${encodeURIComponent(item.id)}`}
          >
            Start tracking fees <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    )
  }

  if (item.feePlanRecorded) {
    return (
      <div className={styles.stepBody}>
        <div className={styles.emptyBox}>
          <strong>This player already has a Fee Plan that needs a look</strong>
          <p>Check its dates or training type in their fee record.</p>
        </div>
        <div className={styles.formActions}>
          <Link
            className={styles.primaryButton}
            href={`/coach/financials/players/${encodeURIComponent(item.id)}?mode=monthly`}
          >
            Review Fee Plan <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    )
  }

  const termOver = item.assignedSession?.standing === "finished" || item.assignedSession?.standing === "ended"

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
          retained: "The agreed monthly fee is still on screen",
          subject: "Working out the fees",
        })
        setFeedback({
          action: failure.signIn,
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
          ? "Fix the blockers below before completing onboarding."
          : "Fees worked out. Confirm the training start date to complete onboarding.",
        tone: previewResult.data.blockers.length ? "error" : "success",
      })
      return
    }
    if (preview.blockers.length) {
      setFeedback({ message: "Fix every blocker, then review the fees again.", tone: "error" })
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
        retained: "The fees are still on screen",
        subject: "The Fee Plan",
      })
      setFeedback({
        action: failure.signIn,
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
          ? `${result.message} Review the fees again.`
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
    <form className={styles.stepBody} autoComplete="off" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      {termOver ? (
        <p className={styles.note} role="note">
          {item.assignedSession?.standing === "ended"
            ? `${firstName}’s first schedule has ended. The fees cover only the months ${firstName} trained.`
            : `${firstName}’s first term has finished. The fees cover only the months ${firstName} trained.`}
        </p>
      ) : null}
      {/* The help sits outside the label, so the field's name is only "Monthly fee". */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`onboarding-${item.id}-fee`}>Monthly fee</label>
        <span className={styles.entry}><b aria-hidden="true">₹</b><input
          ref={monthlyFeeRef}
          id={`onboarding-${item.id}-fee`}
          name="monthlyFee"
          inputMode="decimal"
          value={monthlyFee}
          placeholder="3,500"
          aria-invalid={monthlyFeeInvalid || undefined}
          aria-describedby={monthlyFeeInvalid ? feedbackId : `onboarding-${item.id}-fee-help`}
          onChange={(event) => {
            setMonthlyFee(event.target.value)
            setPreview(null)
            setConfirmed(false)
            setFeedback(null)
          }}
        /></span>
        <small className={styles.help} id={`onboarding-${item.id}-fee-help`}>
          The first month is charged for the sessions left in it, rounded to ₹50.
        </small>
      </div>
      {preview ? (
        <section className={styles.bill} aria-labelledby={`onboarding-${item.id}-fee-preview-title`}>
          <header>
            <h3 className={styles.label} id={`onboarding-${item.id}-fee-preview-title`}>Issued when you finish</h3>
            <strong>{formatInr(preview.totalIssuedPaise)}</strong>
          </header>
          <ul>
            {preview.lines.map((line, index) => (
              <li key={`${line.kind}:${line.period ?? "registration"}:${index}`}>
                <span>
                  <strong>{line.period ? formatBillingPeriod(line.period) : "Registration"}</strong>
                  <small>{line.description}</small>
                  {line.numerator !== null && line.denominator !== null ? (
                    <small>{line.numerator} of {line.denominator} eligible sessions</small>
                  ) : null}
                </span>
                <span className={styles.due}>
                  {line.kind === "before_tracking" ? "Record only" : line.dueDate ? `Due ${formatFinanceDate(line.dueDate)}` : "No charge due"}
                </span>
                <strong className={styles.amount}>{line.amountPaise === null ? "Before tracking" : formatInr(line.amountPaise)}</strong>
              </li>
            ))}
          </ul>
          <FeePreviewWarnings warnings={preview.warnings} />
          {preview.blockers.length ? (
            <FeePreviewBlockers blockers={preview.blockers} />
          ) : (
            <label className={styles.confirm}>
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
                <strong>{trainingStartLine(preview.trainingStartOn, referenceDate)}</strong>
                I confirm this date. It can’t be changed after onboarding.
              </span>
            </label>
          )}
        </section>
      ) : null}
      <InlineNotice action={feedback?.action} id={feedbackId} message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      {/*
        * Moving the training start earlier is the Session step's job, reached
        * from the tabs. Reset is the only route for the level, batch and
        * Training plan, and stops being possible once academy records exist.
        */}
      {item.hasRecords ? (
        <p className={styles.note} data-tone="lock">
          <Lock aria-hidden="true" />
          Schedule and start date are fixed: attendance or fees are already recorded. Complete onboarding, then make any change in Members.
        </p>
      ) : (
        <p className={styles.help}>
          Reset the session assignment to change the schedule, start date, level, batch or Training plan.
          Not possible once the player has attendance, fees or a payment on record.
        </p>
      )}
      <div className={styles.formActions}>
        {item.hasRecords ? null : (
          <button type="button" disabled={busy} onClick={() => void resetAssignment()}>
            {retryAction === "reset" ? "Reset session assignment again" : "Reset session assignment"}
          </button>
        )}
        <button
          className={styles.primaryButton}
          type="submit"
          aria-disabled={awaitingFee || undefined}
          disabled={busy}
        >
          {busy
            ? preview ? "Completing…" : "Working out fees…"
            : retryAction === "submit"
              ? preview ? "Complete onboarding again" : "Review fees again"
              : !preview
                ? "Review fees"
                : preview.blockers.length
                  ? "Resolve blockers"
                  : "Complete onboarding & issue fees"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
