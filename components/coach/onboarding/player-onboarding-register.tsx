"use client"

import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  approveRegistrationAction,
  rejectRegistrationAction,
} from "@/app/coach/actions"
import {
  completeOnboardingFinanceAction,
  previewOnboardingFinanceAction,
} from "@/app/coach/financials/actions"
import {
  assignOnboardingSessionAction,
  resetOnboardingSessionAssignmentAction,
  saveOnboardingAssessmentAction,
} from "@/app/coach/onboarding/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  formatBillingPeriod,
  formatFinanceAmount,
  formatFinanceDate,
} from "@/components/financials/player-finance-presentation"
import type {
  PlayerOnboardingCase,
  PlayerOnboardingStage,
  PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
import { formatDateKey, formatSessionTimeRange } from "@/lib/format"
import type { OnboardingFinancePreview } from "@/lib/finance/types"
import type {
  TrainingBatch,
  TrainingProgramme,
  TrainingSessionSeries,
} from "@/lib/sessions/types"
import {
  academyPlanAssignmentLimit,
  academyPlanLabel,
  academyPlanRequiredWeekdayCount,
  academyPlansFor,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

import styles from "./player-onboarding-register.module.css"

const STAGES: Array<{
  key: PlayerOnboardingStage
  label: string
  summaryKey: "newRequests" | "assessment" | "session" | "feePlan"
}> = [
  { key: "request", label: "New requests", summaryKey: "newRequests" },
  { key: "assessment", label: "Assessment", summaryKey: "assessment" },
  { key: "session", label: "Session", summaryKey: "session" },
  { key: "feePlan", label: "Fee Plan", summaryKey: "feePlan" },
]

const LEVELS: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult"]
const BATCHES: TrainingBatch[] = ["Weekday", "Weekend"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function folio(index: number) {
  return String(index + 1).padStart(2, "0")
}

function shortDate(value: string) {
  return formatDateKey(value.slice(0, 10), {
    day: "numeric",
    month: "short",
    weekday: undefined,
    year: undefined,
  })
}

function onboardingHref(
  pathname: string,
  searchParams: URLSearchParams,
  playerId: string | null,
) {
  const next = new URLSearchParams(searchParams.toString())
  if (playerId) next.set("player", playerId)
  else next.delete("player")
  const query = next.toString()
  return `${pathname}${query ? `?${query}` : ""}`
}

function stageLabel(stage: PlayerOnboardingStage) {
  return STAGES.find((item) => item.key === stage)?.label ?? stage
}

function rowMeta(item: PlayerOnboardingCase) {
  if (item.stage === "request" && item.requestedAt) {
    return `Requested ${shortDate(item.requestedAt)}`
  }
  return [
    item.academyId,
    item.trainingStartOn ? `Training from ${shortDate(item.trainingStartOn)}` : null,
  ].filter(Boolean).join(" · ")
}

const timelineDateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
})

function timelineDate(value: string | null | undefined, fallback = "Pending") {
  if (!value) return fallback
  return timelineDateFormat.format(new Date(value))
}

function OnboardingTimeline({ item }: { item: PlayerOnboardingCase }) {
  return (
    <dl className={styles.dateTimeline} aria-label="Onboarding dates">
      <div><dt>Requested</dt><dd>{timelineDate(item.requestedAt)}</dd></div>
      <div><dt>Approved</dt><dd>{timelineDate(item.approvedAt)}</dd></div>
      <div><dt>Training start</dt><dd>{item.trainingStartOn ? formatDateKey(item.trainingStartOn) : "Pending"}</dd></div>
      <div><dt>Activated</dt><dd>{timelineDate(item.activatedAt)}</dd></div>
      <div><dt>Completed</dt><dd>{timelineDate(item.onboardingCompletedAt)}</dd></div>
    </dl>
  )
}

function nextAction(item: PlayerOnboardingCase) {
  switch (item.stage) {
    case "request":
      return ["Review registration", "Approve or reject the request"]
    case "assessment":
      return ["Set level, batch and plan", "Record the court assessment"]
    case "session":
      return ["Assign matching session", item.feePlanRecorded
        ? "Fee Plan is already recorded"
        : "Choose the recurring court time"]
    case "feePlan":
      return [item.feePlanRecorded ? "Review existing Fee Plan" : "Confirm monthly fee", item.feePlanRecorded
        ? "Resolve the existing finance record"
        : "Complete player onboarding"]
  }
}

function editorCopy(item: PlayerOnboardingCase) {
  const firstName = item.fullName.split(/\s+/u)[0]
  switch (item.stage) {
    case "request":
      if (item.requestedRole === "coach") {
        return {
          title: `Review ${firstName}’s staff request`,
          body: "Approve the junior coach to create their Academy ID and activate staff access.",
        }
      }
      return {
        title: `Review ${firstName}’s request`,
        body: "Approve the player to create their Academy ID and begin assessment.",
      }
    case "assessment":
      return {
        title: `Complete ${firstName}’s assessment`,
        body: "Confirm the court assessment before assigning a recurring session.",
      }
    case "session":
      return {
        title: `Assign ${firstName}’s court time`,
        body: "Choose a matching recurring schedule and the player’s attendance days.",
      }
    case "feePlan":
      return {
        title: `Confirm ${firstName}’s Fee Plan`,
        body: "Record the agreed monthly training fee to complete onboarding.",
      }
  }
}

function firstDayForSeries(item: PlayerOnboardingCase, series: TrainingSessionSeries) {
  return [item.trainingStartOn ?? "", series.startsOn].reduce((latest, value) => (
    value > latest ? value : latest
  ))
}

function suggestedEffectiveDate(
  item: PlayerOnboardingCase,
  series: TrainingSessionSeries,
) {
  return firstDayForSeries(item, series)
}

function seriesWeekdays(series: TrainingSessionSeries) {
  return [...new Set(series.slots.map((slot) => slot.weekday))].sort((a, b) => a - b)
}

function eligibleSeries(
  item: PlayerOnboardingCase,
  sessionSeries: TrainingSessionSeries[],
  referenceDate: string,
) {
  if (!item.level || !item.batch || !item.academyPlan) return []
  const requiredDays = academyPlanRequiredWeekdayCount(item.academyPlan)
  return sessionSeries.filter((series) => {
    const offeredDays = seriesWeekdays(series)
    return series.status === "active"
      && series.programme === item.level
      && series.batch === item.batch
      && (!series.endsOn || series.endsOn >= referenceDate)
      && offeredDays.length > 0
      && (requiredDays === null || offeredDays.length >= requiredDays)
  })
}

function StepRail({ current }: { current: PlayerOnboardingStage }) {
  const currentIndex = STAGES.findIndex((stage) => stage.key === current)

  return (
    <ol className={styles.stepRail} aria-label="Academy onboarding progress">
      {STAGES.map((stage, index) => {
        const complete = index < currentIndex
        return (
          <li
            className={complete ? styles.completeStep : index === currentIndex ? styles.currentStep : ""}
            key={stage.key}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            <span>{complete ? <Check aria-hidden="true" /> : folio(index)}</span>
            <strong>{stage.label}</strong>
          </li>
        )
      })}
    </ol>
  )
}

function RequestStep({
  item,
  onSuccess,
}: {
  item: PlayerOnboardingCase
  onSuccess: (input: {
    message: string
    remove?: boolean
  }) => void
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)

  async function approve() {
    if (busy) return
    setBusy("approve")
    setFeedback(null)
    let result: Awaited<ReturnType<typeof approveRegistrationAction>>
    try {
      result = await approveRegistrationAction(item.id, item.requestedRole)
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Approval could not be saved",
        tone: "error",
      })
      return
    } finally {
      setBusy(null)
    }
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    onSuccess({
      message: item.requestedRole === "coach"
        ? `${result.data.fullName} approved as ${result.data.academyId}. They can activate their staff account in the registration browser.`
        : `${result.data.fullName} approved as ${result.data.academyId}. Continue with the court assessment.`,
      remove: item.requestedRole === "coach",
    })
  }

  async function reject() {
    if (busy || !window.confirm(`Reject ${item.fullName}’s registration request?`)) return
    setBusy("reject")
    setFeedback(null)
    let result: Awaited<ReturnType<typeof rejectRegistrationAction>>
    try {
      result = await rejectRegistrationAction(item.id)
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The rejection could not be saved",
        tone: "error",
      })
      return
    } finally {
      setBusy(null)
    }
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    onSuccess({ message: `${item.fullName}’s request was rejected.`, remove: true })
  }

  return (
    <div className={styles.requestStep} aria-busy={Boolean(busy)}>
      <dl className={styles.requestFacts}>
        <div><dt>{item.requestedRole === "coach" ? "Junior coach" : "Player"}</dt><dd>{item.fullName}</dd></div>
        <div><dt>Request type</dt><dd>{item.requestedRole === "coach" ? "Coaching staff" : "Academy membership"}</dd></div>
        <div><dt>Received</dt><dd>{item.requestedAt ? shortDate(item.requestedAt) : "Recently"}</dd></div>
      </dl>
      <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <button type="button" disabled={Boolean(busy)} onClick={() => void reject()}>
          <X aria-hidden="true" /> {busy === "reject" ? "Rejecting…" : "Reject request"}
        </button>
        <button className={styles.primaryButton} type="button" disabled={Boolean(busy)} onClick={() => void approve()}>
          {busy === "approve" ? "Approving…" : item.requestedRole === "coach" ? "Approve staff access" : "Approve & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function AssessmentStep({
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [busy, setBusy] = useState(false)
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

  function updateLevel(value: TrainingProgramme | "") {
    setLevel(value)
    const nextPlans = value && batch ? academyPlansFor(value, batch) : []
    if (!trainingPlan || !nextPlans.includes(trainingPlan)) setTrainingPlan("")
    setErrors((current) => ({ ...current, level: undefined, academyPlan: undefined }))
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
      setFeedback({
        message: error instanceof Error ? error.message : "The assessment could not be saved",
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
            {BATCHES.map((option) => <option key={option}>{option}</option>)}
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
        <button className={styles.primaryButton} type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save assessment & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

type SessionStepFeedback = ActionFeedback & {
  field?: "weekdays"
}

function SessionStep({
  item,
  onSuccess,
  referenceDate,
  sessionSeries,
}: {
  item: PlayerOnboardingCase
  onSuccess: (input: { message: string }) => void
  referenceDate: string
  sessionSeries: TrainingSessionSeries[]
}) {
  const options = useMemo(
    () => eligibleSeries(item, sessionSeries, referenceDate),
    [item, referenceDate, sessionSeries],
  )
  const firstSeries = options[0] ?? null
  const initialLimit = item.academyPlan ? academyPlanAssignmentLimit(item.academyPlan) : 0
  const [seriesId, setSeriesId] = useState(firstSeries?.id ?? "")
  const [weekdays, setWeekdays] = useState<number[]>(
    firstSeries ? seriesWeekdays(firstSeries).slice(0, initialLimit) : [],
  )
  const [effectiveFrom, setEffectiveFrom] = useState(
    firstSeries ? suggestedEffectiveDate(item, firstSeries) : referenceDate,
  )
  const [feedback, setFeedback] = useState<SessionStepFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const weekdaysRef = useRef<HTMLFieldSetElement>(null)
  const feedbackId = `onboarding-${item.id}-session-feedback`
  const weekdaysInvalid = feedback?.tone === "error" && feedback.field === "weekdays"
  const selectedSeries = options.find((series) => series.id === seriesId) ?? null
  const initialSeriesId = firstSeries?.id ?? ""
  const initialWeekdays = firstSeries ? seriesWeekdays(firstSeries).slice(0, initialLimit) : []
  const initialEffectiveFrom = firstSeries
    ? suggestedEffectiveDate(item, firstSeries)
    : referenceDate
  const isDirty = seriesId !== initialSeriesId
    || weekdays.join(",") !== initialWeekdays.join(",")
    || effectiveFrom !== initialEffectiveFrom
  const guard = useUnsavedWorkGuard({
    isDirty,
    scope: `onboarding-session-${item.id}`,
  })

  function chooseSeries(nextSeries: TrainingSessionSeries) {
    const limit = item.academyPlan ? academyPlanAssignmentLimit(item.academyPlan) : 0
    setSeriesId(nextSeries.id)
    setWeekdays(seriesWeekdays(nextSeries).slice(0, limit))
    setEffectiveFrom(suggestedEffectiveDate(item, nextSeries))
    setFeedback(null)
  }

  function toggleWeekday(weekday: number) {
    if (!item.academyPlan) return
    const limit = academyPlanAssignmentLimit(item.academyPlan)
    setWeekdays((current) => current.includes(weekday)
      ? current.filter((item) => item !== weekday)
      : current.length < limit ? [...current, weekday].sort((a, b) => a - b) : current)
    setFeedback(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !selectedSeries || !item.academyPlan) return
    const required = academyPlanRequiredWeekdayCount(item.academyPlan)
    if ((required !== null && weekdays.length !== required) || !weekdays.length) {
      setFeedback({
        field: "weekdays",
        message: required === null
          ? "Choose at least one attendance day."
          : `Choose exactly ${required} attendance days for this Training plan.`,
        tone: "error",
      })
      weekdaysRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus()
      return
    }
    setBusy(true)
    setFeedback(null)
    let result: Awaited<ReturnType<typeof assignOnboardingSessionAction>>
    try {
      result = await assignOnboardingSessionAction({
        effectiveFrom,
        playerId: item.id,
        seriesId: selectedSeries.id,
        weekdays,
      })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The session could not be assigned",
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
    guard.navigateAfterCommit(() => onSuccess({
      message: item.feePlanRecorded
        ? `${item.fullName}’s session is assigned. Their existing Fee Plan was retained.`
        : `${item.fullName}’s session is assigned. Confirm the Fee Plan next.`,
    }))
  }

  if (!options.length) {
    const createHref = `/coach/schedules/new?programme=${encodeURIComponent(item.level ?? "")}&batch=${encodeURIComponent(item.batch ?? "")}&player=${encodeURIComponent(item.id)}&from=assignment`
    return (
      <div className={styles.recoveryPanel}>
        <strong>No assignable schedule matches this Training plan.</strong>
        <p>Create a recurring schedule with enough attendance days, then return to this player.</p>
        <Link className={styles.primaryButton} href={createHref}>Create matching schedule <ArrowRight aria-hidden="true" /></Link>
      </div>
    )
  }

  const offeredWeekdays = selectedSeries ? seriesWeekdays(selectedSeries) : []
  const requiredDays = item.academyPlan ? academyPlanRequiredWeekdayCount(item.academyPlan) : null

  return (
    <form className={styles.sessionForm} autoComplete="off" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <fieldset className={styles.seriesChoices}>
        <legend>Matching recurring session</legend>
        {options.map((series) => {
          const firstSlot = [...series.slots].sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
          return (
            <label key={series.id} className={series.id === seriesId ? styles.selectedChoice : ""}>
              <input
                type="radio"
                name={`series-${item.id}`}
                value={series.id}
                checked={series.id === seriesId}
                onChange={() => chooseSeries(series)}
              />
              <span>
                <strong>{series.title}</strong>
                <small>{series.venue} · {firstSlot
                  ? formatSessionTimeRange({ startTime: firstSlot.startTime, durationMinutes: firstSlot.durationMinutes })
                  : "Recurring time"}</small>
              </span>
              <em>{seriesWeekdays(series).map((day) => WEEKDAYS[day]).join(" · ")}</em>
            </label>
          )
        })}
      </fieldset>

      <div className={styles.sessionDetails}>
        <fieldset
          ref={weekdaysRef}
          aria-invalid={weekdaysInvalid || undefined}
          aria-describedby={weekdaysInvalid ? feedbackId : undefined}
        >
          <legend>Attendance days {requiredDays !== null ? `· choose ${requiredDays}` : "· up to 2"}</legend>
          <div className={styles.weekdayChoices}>
            {offeredWeekdays.map((weekday) => (
              <label key={weekday} className={weekdays.includes(weekday) ? styles.selectedDay : ""}>
                <input
                  name="weekdays"
                  type="checkbox"
                  value={weekday}
                  checked={weekdays.includes(weekday)}
                  onChange={() => toggleWeekday(weekday)}
                />
                <span>{WEEKDAYS[weekday]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <span>Effective from</span>
          <input
            name="effectiveFrom"
            type="date"
            min={selectedSeries ? firstDayForSeries(item, selectedSeries) : item.trainingStartOn ?? undefined}
            max={selectedSeries?.endsOn ?? undefined}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </label>
      </div>
      <InlineNotice id={feedbackId} message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      {effectiveFrom < referenceDate ? (
        <p className={styles.backdateNote}>
          This start date also makes earlier scheduled sessions eligible for attendance.
        </p>
      ) : null}
      <div className={styles.formActions}>
        <Link href="/coach/schedules">Review schedules</Link>
        <button className={styles.primaryButton} type="submit" disabled={busy}>
          {busy ? "Assigning…" : "Assign session & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

type FeePlanStepFeedback = ActionFeedback & {
  field?: "confirmation" | "monthlyFee"
}

function FeePlanStep({
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
      setFeedback({
        message: error instanceof Error ? error.message : "The session assignment could not be reset",
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
        <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
        <button type="button" disabled={busy} onClick={() => void resetAssignment()}>
          {busy ? "Resetting…" : "Reset session assignment"}
        </button>
      </div>
    )
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !item.level || !item.batch || !item.academyPlan) return
    const rupees = Number(monthlyFee)
    if (!Number.isFinite(rupees) || rupees <= 0 || !Number.isInteger(rupees)) {
      setFeedback({
        field: "monthlyFee",
        message: "Enter the agreed monthly fee in whole rupees.",
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
      agreedMonthlyFeePaise: rupees * 100,
      monthlyDueDay: 5,
    }
    if (!preview) {
      setBusy(true)
      setFeedback(null)
      let previewResult: Awaited<ReturnType<typeof previewOnboardingFinanceAction>>
      try {
        previewResult = await previewOnboardingFinanceAction(terms)
      } catch (error) {
        setFeedback({
          message: error instanceof Error ? error.message : "The Fee Plan could not be saved",
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
      setFeedback({
        message: error instanceof Error ? error.message : "The Fee Plan could not be saved",
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
            inputMode="numeric"
            min="1"
            step="1"
            type="number"
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
              <strong>{formatFinanceAmount(preview.totalIssuedPaise)}</strong>
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
                  <strong>{line.amountPaise === null ? "Before tracking" : formatFinanceAmount(line.amountPaise)}</strong>
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
      <div className={styles.formActions}>
        <button type="button" disabled={busy} onClick={() => void resetAssignment()}>
          Reset session assignment
        </button>
        <button className={styles.primaryButton} type="submit" disabled={busy}>
          {busy
            ? preview ? "Completing…" : "Building timeline…"
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

function OnboardingEditor({
  financeActive,
  item,
  onSuccess,
  referenceDate,
  sessionSeries,
}: {
  financeActive: boolean
  item: PlayerOnboardingCase
  onSuccess: (input: {
    message: string
    remove?: boolean
  }) => void
  referenceDate: string
  sessionSeries: TrainingSessionSeries[]
}) {
  const copy = editorCopy(item)

  return (
    <div
      className={styles.editor}
      id={`onboarding-editor-${item.id}`}
      role="region"
      aria-labelledby={`onboarding-editor-title-${item.id}`}
    >
      <StepRail current={item.stage} />
      <div className={styles.editorWork}>
        <div className={styles.editorHeading}>
          <span>Next action</span>
          <h3 id={`onboarding-editor-title-${item.id}`} tabIndex={-1}>{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <OnboardingTimeline item={item} />
        {item.stage === "request" ? <RequestStep item={item} onSuccess={onSuccess} /> : null}
        {item.stage === "assessment" ? <AssessmentStep item={item} onSuccess={onSuccess} /> : null}
        {item.stage === "session" ? (
          <SessionStep
            item={item}
            onSuccess={onSuccess}
            referenceDate={referenceDate}
            sessionSeries={sessionSeries}
          />
        ) : null}
        {item.stage === "feePlan" ? (
          <FeePlanStep
            financeActive={financeActive}
            item={item}
            onSuccess={onSuccess}
            referenceDate={referenceDate}
          />
        ) : null}
      </div>
    </div>
  )
}

export function PlayerOnboardingRegister({
  financeActive,
  referenceDate,
  sessionSeries,
  workspace,
}: {
  financeActive: boolean
  referenceDate: string
  sessionSeries: TrainingSessionSeries[]
  workspace: PlayerOnboardingWorkspace
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("player")
  const selectedItem = workspace.cases.find((item) => item.id === selectedId) ?? null
  const [notice, setNotice] = useState<ActionFeedback | null>(null)
  const registerTitleRef = useRef<HTMLHeadingElement>(null)
  const previousSelectionRef = useRef<string | null>(null)

  useEffect(() => {
    if (selectedId && !selectedItem) {
      const firstCase = workspace.cases[0]
      router.replace(
        onboardingHref(pathname, new URLSearchParams(searchParams.toString()), firstCase?.id ?? null),
        { scroll: false },
      )
      return
    }
    if (!selectedItem) return
    const focusChanged = previousSelectionRef.current !== `${selectedItem.id}:${selectedItem.stage}`
    previousSelectionRef.current = `${selectedItem.id}:${selectedItem.stage}`
    if (!focusChanged) return
    window.requestAnimationFrame(() => {
      document.getElementById(`onboarding-editor-title-${selectedItem.id}`)?.focus({
        preventScroll: true,
      })
    })
  }, [pathname, router, searchParams, selectedId, selectedItem, workspace.cases])

  function handleSuccess(input: {
    message: string
    remove?: boolean
  }) {
    setNotice({ message: input.message, tone: "success" })
    if (input.remove && selectedItem) {
      const currentIndex = workspace.cases.findIndex((item) => item.id === selectedItem.id)
      const nextItem = workspace.cases[currentIndex + 1] ?? workspace.cases[currentIndex - 1] ?? null
      router.replace(
        onboardingHref(pathname, new URLSearchParams(searchParams.toString()), nextItem?.id ?? null),
        { scroll: false },
      )
    }
    router.refresh()
  }

  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.pageHeader}>
        <div>
          <span className="eyebrow">Academy onboarding</span>
          <h1>Academy intake register.</h1>
        </div>
        <p>One ordered queue. Approve staff access or complete the next required player step.</p>
      </header>

      <InlineNotice
        className={styles.workspaceNotice}
        message={notice?.message}
        tone={notice?.tone}
        reserveSpace={false}
      />

      <section className={styles.stageSummary} aria-label="Onboarding stage totals">
        {STAGES.map((stage) => {
          const count = workspace.summary[stage.summaryKey]
          return (
            <div
              className={selectedItem?.stage === stage.key ? styles.activeStage : ""}
              key={stage.key}
            >
              <strong aria-hidden="true">{String(count).padStart(2, "0")}</strong>
              <span className="sr-only">{count}</span>
              <p>{stage.label}</p>
            </div>
          )
        })}
      </section>

      <section className={styles.register} aria-labelledby="onboarding-register-title">
        <div className={styles.registerHeading}>
          <h2 ref={registerTitleRef} id="onboarding-register-title" tabIndex={-1}>People needing action</h2>
          <p><strong>{workspace.summary.total}</strong> in progress · Ordered by next step</p>
        </div>

        {workspace.cases.length ? (
          <ol className={styles.rows}>
            {workspace.cases.map((item, index) => {
              const expanded = selectedItem?.id === item.id
              const action = nextAction(item)
              const href = onboardingHref(
                pathname,
                new URLSearchParams(searchParams.toString()),
                expanded ? null : item.id,
              )
              return (
                <li className={expanded ? styles.expandedRow : ""} key={item.id}>
                  <div className={styles.row}>
                    <span className={styles.folio}>{folio(index)}</span>
                    <div className={styles.identity}>
                      <strong>{item.fullName}</strong>
                      <small>{rowMeta(item)}</small>
                    </div>
                    <span className={styles.stageStamp}>{stageLabel(item.stage)}</span>
                    <div className={styles.nextAction}>
                      <strong>{action[0]}</strong>
                      <small>{action[1]}</small>
                    </div>
                    <Link
                      className={styles.openButton}
                      href={href}
                      scroll={false}
                      aria-expanded={expanded}
                      aria-controls={expanded ? `onboarding-editor-${item.id}` : undefined}
                    >
                      {expanded ? "Close" : index === 0 ? "Open" : "Continue"}
                      {expanded ? <X aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                    </Link>
                  </div>
                  {expanded ? (
                    <OnboardingEditor
                      key={`${item.id}:${item.stage}:${item.recordRevision ?? "request"}`}
                      financeActive={financeActive}
                      item={item}
                      onSuccess={handleSuccess}
                      referenceDate={referenceDate}
                      sessionSeries={sessionSeries}
                    />
                  ) : null}
                </li>
              )
            })}
          </ol>
        ) : (
          <div className={styles.emptyState}>
            <Check aria-hidden="true" />
            <h3>Academy onboarding is complete.</h3>
            <p>New staff or player requests and incomplete player setup steps will appear here.</p>
            <Link href="/coach/members">Open Member Directory</Link>
          </div>
        )}
      </section>
    </div>
  )
}
