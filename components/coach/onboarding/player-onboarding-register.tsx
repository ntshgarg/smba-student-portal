"use client"

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
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
  saveMemberAction,
} from "@/app/coach/actions"
import { replaceFeeAgreementAction } from "@/app/coach/financials/actions"
import { assignOnboardingSessionAction } from "@/app/coach/onboarding/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { tryCopyText } from "@/lib/client/clipboard"
import type {
  PlayerOnboardingCase,
  PlayerOnboardingStage,
  PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
import { formatDateKey, formatSessionTimeRange } from "@/lib/format"
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

type ApprovalReceipt = {
  academyId: string
  fullName: string
}

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
    item.joinedAt ? `Joined ${shortDate(item.joinedAt)}` : null,
  ].filter(Boolean).join(" · ")
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
  return [item.joinedAt ?? "", series.startsOn].reduce((latest, value) => (
    value > latest ? value : latest
  ))
}

function suggestedEffectiveDate(
  item: PlayerOnboardingCase,
  series: TrainingSessionSeries,
  referenceDate: string,
) {
  return [firstDayForSeries(item, series), referenceDate].reduce((latest, value) => (
    value > latest ? value : latest
  ))
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
    <ol className={styles.stepRail} aria-label="Player onboarding progress">
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

function ApprovalReceiptBox({ receipt }: { receipt: ApprovalReceipt }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle")
  const inputRef = useRef<HTMLInputElement>(null)

  async function copyAcademyId() {
    const copied = await tryCopyText(receipt.academyId, navigator.clipboard)
    setCopyState(copied ? "copied" : "unavailable")
    if (!copied) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  return (
    <div className={styles.approvalReceipt}>
      <div>
        <Check aria-hidden="true" />
        <p>
          <strong>{receipt.fullName} approved</strong>
          <span>Share this Academy ID privately</span>
        </p>
      </div>
      <label>
        <span className="sr-only">Academy ID</span>
        <input
          ref={inputRef}
          readOnly
          value={receipt.academyId}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" onClick={() => void copyAcademyId()}>
          {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Select ID" : "Copy ID"}
        </button>
      </label>
    </div>
  )
}

function RequestStep({
  item,
  onSuccess,
}: {
  item: PlayerOnboardingCase
  onSuccess: (input: {
    message: string
    receipt?: ApprovalReceipt
    remove?: boolean
  }) => void
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)

  async function approve() {
    if (busy) return
    setBusy("approve")
    setFeedback(null)
    const result = await approveRegistrationAction(item.id)
    setBusy(null)
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    onSuccess({
      message: `${result.data.fullName} approved. Continue with the court assessment.`,
      receipt: {
        academyId: result.data.academyId,
        fullName: result.data.fullName,
      },
    })
  }

  async function reject() {
    if (busy || !window.confirm(`Reject ${item.fullName}’s registration request?`)) return
    setBusy("reject")
    setFeedback(null)
    const result = await rejectRegistrationAction(item.id)
    setBusy(null)
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    onSuccess({ message: `${item.fullName}’s request was rejected.`, remove: true })
  }

  return (
    <div className={styles.requestStep} aria-busy={Boolean(busy)}>
      <dl className={styles.requestFacts}>
        <div><dt>Player</dt><dd>{item.fullName}</dd></div>
        <div><dt>Request type</dt><dd>Academy membership</dd></div>
        <div><dt>Received</dt><dd>{item.requestedAt ? shortDate(item.requestedAt) : "Recently"}</dd></div>
      </dl>
      <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <button type="button" disabled={Boolean(busy)} onClick={() => void reject()}>
          <X aria-hidden="true" /> {busy === "reject" ? "Rejecting…" : "Reject request"}
        </button>
        <button className={styles.primaryButton} type="button" disabled={Boolean(busy)} onClick={() => void approve()}>
          {busy === "approve" ? "Approving…" : "Approve & continue"} <ArrowRight aria-hidden="true" />
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
  const [errors, setErrors] = useState<Partial<Record<"level" | "batch" | "academyPlan", string>>>({})
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const levelRef = useRef<HTMLSelectElement>(null)
  const batchRef = useRef<HTMLSelectElement>(null)
  const planRef = useRef<HTMLSelectElement>(null)
  const isDirty = level !== (item.level ?? "")
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
    if (!level) nextErrors.level = "Choose the assessed training level."
    if (!batch) nextErrors.batch = "Choose the player’s batch."
    if (!trainingPlan) nextErrors.academyPlan = "Choose the days-per-week Training plan."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setFeedback({ message: "Review the highlighted assessment details.", tone: "error" })
      if (nextErrors.level) levelRef.current?.focus()
      else if (nextErrors.batch) batchRef.current?.focus()
      else planRef.current?.focus()
      return
    }
    if (!item.primaryContact || !item.joinedAt || item.recordRevision === null) return

    setBusy(true)
    setFeedback(null)
    const result = await saveMemberAction({
      memberId: item.id,
      expectedRevision: item.recordRevision,
      profile: {
        fullName: item.fullName,
        joinedAt: item.joinedAt,
        primaryContact: item.primaryContact,
      },
      training: {
        academyPlan: trainingPlan as AcademyPlan,
        batch: batch as TrainingBatch,
        level: level as TrainingProgramme,
      },
    })
    setBusy(false)
    if (!result.ok) {
      const nextFieldErrors = {
        level: result.fieldErrors?.level,
        batch: result.fieldErrors?.batch,
        academyPlan: result.fieldErrors?.academyPlan,
      }
      setErrors(nextFieldErrors)
      setFeedback({ message: result.message, tone: "error" })
      if (nextFieldErrors.level) levelRef.current?.focus()
      else if (nextFieldErrors.batch) batchRef.current?.focus()
      else if (nextFieldErrors.academyPlan) planRef.current?.focus()
      return
    }
    guard.navigateAfterCommit(() => onSuccess({
      message: `${item.fullName}’s assessment is saved. Assign the matching session next.`,
    }))
  }

  return (
    <form className={styles.compactForm} onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <div className={styles.threeFieldGrid}>
        <label>
          <span>Level</span>
          <select
            ref={levelRef}
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
    firstSeries ? suggestedEffectiveDate(item, firstSeries, referenceDate) : referenceDate,
  )
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const selectedSeries = options.find((series) => series.id === seriesId) ?? null
  const initialSeriesId = firstSeries?.id ?? ""
  const initialWeekdays = firstSeries ? seriesWeekdays(firstSeries).slice(0, initialLimit) : []
  const initialEffectiveFrom = firstSeries
    ? suggestedEffectiveDate(item, firstSeries, referenceDate)
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
    setEffectiveFrom(suggestedEffectiveDate(item, nextSeries, referenceDate))
    setFeedback(null)
  }

  function toggleWeekday(weekday: number) {
    if (!item.academyPlan) return
    const limit = academyPlanAssignmentLimit(item.academyPlan)
    setWeekdays((current) => current.includes(weekday)
      ? current.filter((item) => item !== weekday)
      : current.length < limit ? [...current, weekday].sort((a, b) => a - b) : current)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !selectedSeries || !item.academyPlan) return
    const required = academyPlanRequiredWeekdayCount(item.academyPlan)
    if ((required !== null && weekdays.length !== required) || !weekdays.length) {
      setFeedback({
        message: required === null
          ? "Choose at least one attendance day."
          : `Choose exactly ${required} attendance days for this Training plan.`,
        tone: "error",
      })
      return
    }
    setBusy(true)
    setFeedback(null)
    const result = await assignOnboardingSessionAction({
      effectiveFrom,
      playerId: item.id,
      seriesId: selectedSeries.id,
      weekdays,
    })
    setBusy(false)
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
    <form className={styles.sessionForm} onSubmit={(event) => void submit(event)} aria-busy={busy}>
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
        <fieldset>
          <legend>Attendance days {requiredDays !== null ? `· choose ${requiredDays}` : "· up to 2"}</legend>
          <div className={styles.weekdayChoices}>
            {offeredWeekdays.map((weekday) => (
              <label key={weekday} className={weekdays.includes(weekday) ? styles.selectedDay : ""}>
                <input
                  type="checkbox"
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
            type="date"
            min={selectedSeries ? firstDayForSeries(item, selectedSeries) : item.joinedAt ?? undefined}
            max={selectedSeries?.endsOn ?? undefined}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </label>
      </div>
      <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
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
  const [effectiveMonth, setEffectiveMonth] = useState(referenceDate.slice(0, 7))
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const isDirty = monthlyFee !== "" || effectiveMonth !== referenceDate.slice(0, 7)
  const guard = useUnsavedWorkGuard({
    isDirty,
    scope: `onboarding-fee-plan-${item.id}`,
  })

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !item.level || !item.batch || !item.academyPlan) return
    const rupees = Number(monthlyFee)
    if (!Number.isFinite(rupees) || rupees <= 0 || !Number.isInteger(rupees)) {
      setFeedback({ message: "Enter the agreed monthly fee in whole rupees.", tone: "error" })
      return
    }
    setBusy(true)
    setFeedback(null)
    const result = await replaceFeeAgreementAction({
      playerId: item.id,
      academyPlan: item.academyPlan,
      level: item.level,
      batch: item.batch,
      agreedMonthlyFeePaise: rupees * 100,
      effectiveFrom: `${effectiveMonth}-01`,
      monthlyDueDay: 5,
      idempotencyKey: `onboarding-fee:${item.id}:${crypto.randomUUID()}`,
    })
    setBusy(false)
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    guard.navigateAfterCommit(() => onSuccess({
      message: `${item.fullName} is fully onboarded. Their Fee Plan is ready for monthly preparation.`,
      remove: true,
    }))
  }

  return (
    <form className={styles.feePlanForm} onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <dl className={styles.trainingFacts}>
        <div><dt>Level</dt><dd>{item.level}</dd></div>
        <div><dt>Batch</dt><dd>{item.batch}</dd></div>
        <div><dt>Training plan</dt><dd>{academyPlanLabel(item.academyPlan)}</dd></div>
      </dl>
      <div className={styles.feeFields}>
        <label>
          <span>Agreed monthly fee</span>
          <span className={styles.moneyInput}><b>₹</b><input
            inputMode="numeric"
            min="1"
            step="1"
            type="number"
            value={monthlyFee}
            placeholder="3,500"
            onChange={(event) => setMonthlyFee(event.target.value)}
          /></span>
        </label>
        <label>
          <span>Track from month</span>
          <input
            type="month"
            value={effectiveMonth}
            onChange={(event) => setEffectiveMonth(event.target.value)}
          />
        </label>
      </div>
      <p className={styles.feeNote}>Monthly charges are prepared separately after this Fee Plan is recorded.</p>
      <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <Link href={`/coach/financials/players/${encodeURIComponent(item.id)}?mode=monthly`}>Open finance record</Link>
        <button className={styles.primaryButton} type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create Fee Plan & complete"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

function OnboardingEditor({
  approvalReceipt,
  financeActive,
  item,
  onSuccess,
  referenceDate,
  sessionSeries,
}: {
  approvalReceipt?: ApprovalReceipt
  financeActive: boolean
  item: PlayerOnboardingCase
  onSuccess: (input: {
    message: string
    receipt?: ApprovalReceipt
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
        {approvalReceipt ? <ApprovalReceiptBox receipt={approvalReceipt} /> : null}
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
  const [approvalReceipts, setApprovalReceipts] = useState<Record<string, ApprovalReceipt>>({})
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
      document.getElementById(`onboarding-editor-title-${selectedItem.id}`)?.focus()
    })
  }, [pathname, router, searchParams, selectedId, selectedItem, workspace.cases])

  function handleSuccess(input: {
    message: string
    receipt?: ApprovalReceipt
    remove?: boolean
  }) {
    setNotice({ message: input.message, tone: "success" })
    if (input.receipt && selectedItem) {
      setApprovalReceipts((current) => ({ ...current, [selectedItem.id]: input.receipt! }))
    }
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
    <main className={`${styles.page} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.pageHeader}>
        <div>
          <span className="eyebrow">Player onboarding</span>
          <h1>Player intake register.</h1>
        </div>
        <p>One ordered queue. Open a player and complete only the next required step.</p>
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
          <h2 ref={registerTitleRef} id="onboarding-register-title" tabIndex={-1}>Players needing action</h2>
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
                      aria-controls={`onboarding-editor-${item.id}`}
                    >
                      {expanded ? "Close" : index === 0 ? "Open" : "Continue"}
                      {expanded ? <X aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                    </Link>
                  </div>
                  {expanded ? (
                    <OnboardingEditor
                      key={`${item.id}:${item.stage}:${item.recordRevision ?? "request"}`}
                      approvalReceipt={approvalReceipts[item.id]}
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
            <h3>Every player is fully onboarded.</h3>
            <p>New requests and incomplete setup steps will appear in this register.</p>
            <Link href="/coach/members">Open Member Directory</Link>
          </div>
        )}
      </section>
    </main>
  )
}
