"use client"

import { ArrowRight, Lock } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"

import { saveOnboardingAssessmentAction } from "@/app/coach/onboarding/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyBatchesFor,
  academyPlanLabel,
  academyPlanRequiredWeekdayCount,
  academyPlansFor,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

import styles from "../player-onboarding-register.module.css"
import type { SaveFeedback } from "./shared"

const LEVELS: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult", "Elite"]
const BATCHES: TrainingBatch[] = ["Weekday", "Weekend"]

export function AssessmentStep({
  item,
  onSuccess,
}: {
  item: PlayerOnboardingCase
  onSuccess: (input: { message: string }) => void
}) {
  const [level, setLevel] = useState<TrainingProgramme | "">(item.level ?? "")
  const [batch, setBatch] = useState<TrainingBatch | "">(item.batch ?? "")
  const [trainingPlan, setTrainingPlan] = useState<AcademyPlan | "">(item.academyPlan ?? "")
  const [errors, setErrors] = useState<Partial<Record<"level" | "batch" | "academyPlan", string>>>({})
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  /*
   * Every field here is required by the server, and each is a date or a closed
   * list -- there is no malformed-input case worth explaining after the fact, so
   * the action is held back rather than offered and then refused. The submit
   * handler still validates: this is the affordance, not the check.
   */
  const classificationIncomplete = !level || !batch || !trainingPlan
  const levelRef = useRef<HTMLFieldSetElement>(null)
  const batchRef = useRef<HTMLFieldSetElement>(null)
  const planRef = useRef<HTMLFieldSetElement>(null)
  /*
   * Tracked the date and only the date before it moved, which meant a coach who
   * changed the level and navigated away lost it silently. With the date gone
   * the classification is all this step holds, so it is what the guard watches.
   */
  const isDirty = level !== (item.level ?? "")
    || batch !== (item.batch ?? "")
    || trainingPlan !== (item.academyPlan ?? "")
  const guard = useUnsavedWorkGuard({
    isDirty,
    scope: `onboarding-assessment-${item.id}`,
  })

  const plans = level && batch ? academyPlansFor(level, batch) : []
  /*
   * Advanced and Elite train five weekdays, so Weekend is not offered once one of
   * them is chosen. Narrowing here rather than rejecting on save means the coach
   * never composes a pair the server would refuse.
   */
  const batches = level ? academyBatchesFor(level) : BATCHES

  function updateLevel(value: TrainingProgramme | "") {
    setLevel(value)
    // A batch the new level cannot train in has to go with it, or an Elite player
    // keeps a stale Weekend selection that only fails on save.
    const nextBatches = value ? academyBatchesFor(value) : BATCHES
    const nextBatch = batch && nextBatches.includes(batch) ? batch : ""
    if (nextBatch !== batch) setBatch(nextBatch)
    const nextPlans = value && nextBatch ? academyPlansFor(value, nextBatch) : []
    if (!trainingPlan || !nextPlans.includes(trainingPlan)) setTrainingPlan("")
    setErrors((current) => ({
      ...current, academyPlan: undefined, batch: undefined, level: undefined,
    }))
  }

  function updateBatch(value: TrainingBatch | "") {
    setBatch(value)
    const nextPlans = level && value ? academyPlansFor(level, value) : []
    if (!trainingPlan || !nextPlans.includes(trainingPlan)) setTrainingPlan("")
    setErrors((current) => ({ ...current, batch: undefined, academyPlan: undefined }))
  }

  // The checked option, or the first one when nothing is chosen yet.
  function focusChoice(group: React.RefObject<HTMLFieldSetElement | null>) {
    const inputs = group.current?.querySelectorAll<HTMLInputElement>("input:not(:disabled)")
    if (!inputs?.length) return
    ;([...inputs].find((input) => input.checked) ?? inputs[0]).focus()
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const nextErrors: typeof errors = {}
    if (!level) nextErrors.level = "Choose the assessed training level."
    if (!batch) nextErrors.batch = "Choose the player’s batch."
    if (!trainingPlan) nextErrors.academyPlan = "Choose the days-per-week Training plan."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setFeedback({ message: "Review the highlighted assessment details.", tone: "error" })
      if (nextErrors.level) focusChoice(levelRef)
      else if (nextErrors.batch) focusChoice(batchRef)
      else focusChoice(planRef)
      return
    }
    if (item.recordRevision === null) return

    setBusy(true)
    setFeedback(null)
    let result: Awaited<ReturnType<typeof saveOnboardingAssessmentAction>>
    try {
      result = await saveOnboardingAssessmentAction({
        playerId: item.id,
        expectedRevision: item.recordRevision,
        academyPlan: trainingPlan as AcademyPlan,
        batch: batch as TrainingBatch,
        level: level as TrainingProgramme,
      })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Your assessment details are still on screen",
        subject: "The assessment",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
      return
    } finally {
      setBusy(false)
    }
    if (!result.ok) {
      const nextFieldErrors = {
        level: result.field === "level" ? result.message : undefined,
        batch: result.field === "batch" ? result.message : undefined,
        academyPlan: result.field === "academyPlan" ? result.message : undefined,
      }
      setErrors(nextFieldErrors)
      setFeedback({ message: result.message, tone: "error" })
      if (nextFieldErrors.level) focusChoice(levelRef)
      else if (nextFieldErrors.batch) focusChoice(batchRef)
      else if (nextFieldErrors.academyPlan) focusChoice(planRef)
      return
    }
    /*
     * Reachable from two places now. Told to "assign the matching session next"
     * on a case that already has one, a coach goes looking for work that is
     * done -- and the remount drops them on Fee plan, which says otherwise.
     */
    guard.navigateAfterCommit(() => onSuccess({
      message: item.assignedSession
        ? `${item.fullName}’s assessment is saved. Their session assignment is unchanged.`
        : `${item.fullName}’s assessment is saved. Assign the matching session next.`,
    }))
  }

  const locked = Boolean(item.assignedSession)
  const errorId = (field: string) => `onboarding-${item.id}-${field}-error`

  return (
    <form className={styles.stepBody} autoComplete="off" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      {/*
        * The server refuses a level, batch or plan change while an assignment is
        * open (lib/coach/onboarding-service.ts:127-137) and offers reset as the
        * remedy. Leaving the choices live meant the coach discovered that only
        * after submitting -- and `updateLevel` blanks batch and plan on the way,
        * so a refused attempt also emptied two fields they then had to redo.
        */}
      {item.assignedSession ? (
        <p className={styles.note} data-tone="lock" role="note">
          <Lock aria-hidden="true" />
          {item.hasRecords
            ? "Fixed: attendance or fees are already recorded. Finish onboarding on the Fee plan step, then change them in Members."
            : `Fixed while this player has a schedule. To change them, use ${item.assignedSession.standing === "running" ? "Clear this assignment" : "Start again"} on the Session step first.`}
        </p>
      ) : null}
      <fieldset
        className={styles.field}
        disabled={locked}
        ref={levelRef}
        aria-invalid={Boolean(errors.level) || undefined}
        aria-describedby={errors.level ? errorId("level") : undefined}
      >
        <legend>Level</legend>
        <div className={styles.chips}>
          {LEVELS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="level"
                value={option}
                checked={level === option}
                onChange={() => updateLevel(option)}
              />
              {option}
            </label>
          ))}
        </div>
        {errors.level ? <p className={styles.fieldError} id={errorId("level")}>{errors.level}</p> : null}
      </fieldset>
      <fieldset
        className={styles.field}
        disabled={locked}
        ref={batchRef}
        aria-invalid={Boolean(errors.batch) || undefined}
        aria-describedby={errors.batch ? errorId("batch") : undefined}
      >
        <legend>Batch</legend>
        <div className={styles.switch}>
          {batches.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="batch"
                value={option}
                checked={batch === option}
                onChange={() => updateBatch(option)}
              />
              {option}
            </label>
          ))}
        </div>
        {errors.batch ? <p className={styles.fieldError} id={errorId("batch")}>{errors.batch}</p> : null}
      </fieldset>
      <fieldset
        className={styles.field}
        disabled={locked}
        ref={planRef}
        aria-invalid={Boolean(errors.academyPlan) || undefined}
        aria-describedby={errors.academyPlan ? errorId("plan") : undefined}
      >
        <legend>Training plan</legend>
        {plans.length ? (
          <div className={styles.cards}>
            {plans.map((plan) => {
              const days = academyPlanRequiredWeekdayCount(plan)
              return (
                <label key={plan}>
                  <input
                    type="radio"
                    name="academyPlan"
                    value={plan}
                    checked={trainingPlan === plan}
                    onChange={() => {
                      setTrainingPlan(plan)
                      setErrors((current) => ({ ...current, academyPlan: undefined }))
                    }}
                  />
                  <strong>{academyPlanLabel(plan)}</strong>
                  <small>{days === null ? "Sat and Sun" : `${days} sessions a week`}</small>
                </label>
              )
            })}
          </div>
        ) : (
          <p className={styles.help}>Choose a level and batch first.</p>
        )}
        {errors.academyPlan ? <p className={styles.fieldError} id={errorId("plan")}>{errors.academyPlan}</p> : null}
      </fieldset>
      <InlineNotice action={feedback?.action} message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <Link href={`/coach/members?player=${encodeURIComponent(item.id)}`}>View member record</Link>
        {locked ? null : (
          <button
            className={styles.primaryButton}
            type="submit"
            aria-disabled={classificationIncomplete || undefined}
            disabled={busy}
          >
            {busy
              ? "Saving…"
              : feedback?.offerRetry
                ? "Save assessment again"
                : "Save assessment & continue"} <ArrowRight aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  )
}
