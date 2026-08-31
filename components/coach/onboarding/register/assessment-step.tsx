"use client"

import { ArrowRight } from "lucide-react"
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
  const [trainingStartOn, setTrainingStartOn] = useState(item.trainingStartOn ?? "")
  const [errors, setErrors] = useState<Partial<Record<"trainingStartOn" | "level" | "batch" | "academyPlan", string>>>({})
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  /*
   * Every field here is required by the server, and each is a date or a closed
   * list -- there is no malformed-input case worth explaining after the fact, so
   * the action is held back rather than offered and then refused. The submit
   * handler still validates: this is the affordance, not the check.
   */
  const classificationIncomplete = !trainingStartOn || !level || !batch || !trainingPlan
  const levelRef = useRef<HTMLSelectElement>(null)
  const trainingStartRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<HTMLSelectElement>(null)
  const planRef = useRef<HTMLSelectElement>(null)
  const isDirty = trainingStartOn !== (item.trainingStartOn ?? "")
    || level !== (item.level ?? "")
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const nextErrors: typeof errors = {}
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(trainingStartOn)) {
      nextErrors.trainingStartOn = "Choose the player’s training start date."
    }
    if (!level) nextErrors.level = "Choose the assessed training level."
    if (!batch) nextErrors.batch = "Choose the player’s batch."
    if (!trainingPlan) nextErrors.academyPlan = "Choose the days-per-week Training plan."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setFeedback({ message: "Review the highlighted assessment details.", tone: "error" })
      if (nextErrors.trainingStartOn) trainingStartRef.current?.focus()
      else if (nextErrors.level) levelRef.current?.focus()
      else if (nextErrors.batch) batchRef.current?.focus()
      else planRef.current?.focus()
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
        trainingStartOn,
        academyPlan: trainingPlan as AcademyPlan,
        batch: batch as TrainingBatch,
        level: level as TrainingProgramme,
      })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The assessment could not be saved",
        retained: "Your assessment details are still on screen",
        subject: "The assessment",
      })
      setFeedback({
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
        trainingStartOn: result.field === "trainingStartOn" ? result.message : undefined,
        level: result.field === "level" ? result.message : undefined,
        batch: result.field === "batch" ? result.message : undefined,
        academyPlan: result.field === "academyPlan" ? result.message : undefined,
      }
      setErrors(nextFieldErrors)
      setFeedback({ message: result.message, tone: "error" })
      if (nextFieldErrors.trainingStartOn) trainingStartRef.current?.focus()
      else if (nextFieldErrors.level) levelRef.current?.focus()
      else if (nextFieldErrors.batch) batchRef.current?.focus()
      else if (nextFieldErrors.academyPlan) planRef.current?.focus()
      return
    }
    guard.navigateAfterCommit(() => onSuccess({
      message: `${item.fullName}’s assessment is saved. Assign the matching session next.`,
    }))
  }

  return (
    <form className={styles.compactForm} autoComplete="off" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <div className={styles.assessmentDateField}>
        <label>
          <span>Training start date</span>
          <input
            ref={trainingStartRef}
            name="trainingStartOn"
            type="date"
            required
            value={trainingStartOn}
            aria-invalid={Boolean(errors.trainingStartOn)}
            aria-describedby={`onboarding-${item.id}-training-start-help${errors.trainingStartOn ? ` onboarding-${item.id}-training-start-error` : ""}`}
            onChange={(event) => {
              setTrainingStartOn(event.target.value)
              setErrors((current) => ({ ...current, trainingStartOn: undefined }))
            }}
          />
          <small id={`onboarding-${item.id}-training-start-help`}>
            Enter the start of the player’s current continuous training period. This becomes permanent when onboarding is completed.
          </small>
          {errors.trainingStartOn ? <small id={`onboarding-${item.id}-training-start-error`}>{errors.trainingStartOn}</small> : null}
        </label>
      </div>
      <div className={styles.threeFieldGrid}>
        <label>
          <span>Level</span>
          <select
            ref={levelRef}
            name="level"
            value={level}
            aria-invalid={Boolean(errors.level)}
            aria-describedby={errors.level ? `onboarding-${item.id}-level-error` : undefined}
            onChange={(event) => updateLevel(event.target.value as TrainingProgramme | "")}
          >
            <option value="">Choose level</option>
            {LEVELS.map((option) => <option key={option}>{option}</option>)}
          </select>
          {errors.level ? <small id={`onboarding-${item.id}-level-error`}>{errors.level}</small> : null}
        </label>
        <label>
          <span>Batch</span>
          <select
            ref={batchRef}
            name="batch"
            value={batch}
            aria-invalid={Boolean(errors.batch)}
            aria-describedby={errors.batch ? `onboarding-${item.id}-batch-error` : undefined}
            onChange={(event) => updateBatch(event.target.value as TrainingBatch | "")}
          >
            <option value="">Choose batch</option>
            {batches.map((option) => <option key={option}>{option}</option>)}
          </select>
          {errors.batch ? <small id={`onboarding-${item.id}-batch-error`}>{errors.batch}</small> : null}
        </label>
        <label>
          <span>Training plan</span>
          <select
            ref={planRef}
            name="academyPlan"
            value={trainingPlan}
            disabled={!level || !batch}
            aria-invalid={Boolean(errors.academyPlan)}
            aria-describedby={errors.academyPlan ? `onboarding-${item.id}-plan-error` : undefined}
            onChange={(event) => {
              setTrainingPlan(event.target.value as AcademyPlan | "")
              setErrors((current) => ({ ...current, academyPlan: undefined }))
            }}
          >
            <option value="">Choose plan</option>
            {plans.map((plan) => <option key={plan} value={plan}>{academyPlanLabel(plan)}</option>)}
          </select>
          {errors.academyPlan ? <small id={`onboarding-${item.id}-plan-error`}>{errors.academyPlan}</small> : null}
        </label>
      </div>
      <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <Link href={`/coach/members?player=${encodeURIComponent(item.id)}`}>View member record</Link>
        <button
          className={styles.primaryButton}
          type="submit"
          data-blocked={classificationIncomplete ? "true" : undefined}
          disabled={busy || classificationIncomplete}
        >
          {busy
            ? "Saving…"
            : feedback?.offerRetry
              ? "Save assessment again"
              : "Save assessment & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
