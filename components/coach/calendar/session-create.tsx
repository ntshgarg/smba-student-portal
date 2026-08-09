"use client"

import { ArrowLeft, ArrowUpRight, CalendarDays } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { useCoachPortal } from "@/components/coach/coach-portal-provider"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { formatSessionLabel } from "@/lib/format"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

const programmes: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult"]
const weekdays = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
]

type SeriesForm = {
  programme: TrainingProgramme
  batch: TrainingBatch
  venue: string
  startsOn: string
  endsOn: string
  selectedDays: Record<number, boolean>
  startTime: string
  durationMinutes: string
}

type SeriesFeedback = ActionFeedback & {
  field?: string
}

function defaultSelectedDays(batch: TrainingBatch) {
  return Object.fromEntries(weekdays.map((day) => [day.value, batch === "Weekday"
    ? day.value >= 1 && day.value <= 5
    : day.value === 0 || day.value === 6]))
}

function newSeriesForm(
  today: string,
  programme: TrainingProgramme = "Beginner",
  batch: TrainingBatch = "Weekday",
): SeriesForm {
  return {
    programme,
    batch,
    venue: "SMBA Court",
    startsOn: today,
    endsOn: "",
    selectedDays: defaultSelectedDays(batch),
    startTime: "06:00",
    durationMinutes: "60",
  }
}

export function SessionScheduleCreate({
  guidedFromEvaluation = false,
  initialBatch,
  initialPlayerId = null,
  initialProgramme,
}: {
  guidedFromEvaluation?: boolean
  initialBatch?: TrainingBatch
  initialPlayerId?: string | null
  initialProgramme?: TrainingProgramme
}) {
  const { createSessionSeries, players } = useCoachPortal()
  const router = useRouter()
  const today = getIndiaDateKey()
  const guidedPlayer = initialPlayerId
    ? players.find((player) => player.member.id === initialPlayerId) ?? null
    : null
  const guidedProgramme = guidedPlayer?.training.level !== "Assessment pending"
    ? guidedPlayer?.training.level as TrainingProgramme | undefined
    : undefined
  const guidedBatch = guidedPlayer?.training.batch !== "Assessment pending"
    ? guidedPlayer?.training.batch as TrainingBatch | undefined
    : undefined
  const startingProgramme = guidedProgramme ?? initialProgramme ?? "Beginner"
  const startingBatch = guidedBatch ?? initialBatch ?? "Weekday"
  const [seriesForm, setSeriesForm] = useState(() => (
    newSeriesForm(today, startingProgramme, startingBatch)
  ))
  const [seriesBaseline, setSeriesBaseline] = useState(() => (
    newSeriesForm(today, startingProgramme, startingBatch)
  ))
  const [isCreating, setIsCreating] = useState(false)
  const [feedback, setFeedback] = useState<SeriesFeedback | null>(guidedPlayer ? {
    message: `Create a matching ${startingProgramme} · ${startingBatch} schedule for ${guidedPlayer.member.fullName}`,
    tone: "info",
  } : null)
  const [createdSeriesId, setCreatedSeriesId] = useState<string | null>(null)
  const [createdProgramme, setCreatedProgramme] = useState<TrainingProgramme | null>(null)
  const startTimeRef = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLSelectElement>(null)
  const venueRef = useRef<HTMLInputElement>(null)
  const startsOnRef = useRef<HTMLInputElement>(null)
  const endsOnRef = useRef<HTMLInputElement>(null)
  const weekdaysRef = useRef<HTMLFieldSetElement>(null)
  const feedbackId = "schedule-create-feedback"
  useUnsavedWorkGuard({
    isDirty: JSON.stringify(seriesForm) !== JSON.stringify(seriesBaseline),
    message: "Leave without saving this recurring schedule?",
    scope: "coach-schedule-create",
  })

  useEffect(() => {
    if (feedback?.tone !== "error" || !feedback.field) return
    const fieldTargets: Partial<Record<string, HTMLElement | null>> = {
      durationMinutes: durationRef.current,
      endsOn: endsOnRef.current,
      startsOn: startsOnRef.current,
      startTime: startTimeRef.current,
      venue: venueRef.current,
      weekdays: weekdaysRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)"),
    }
    fieldTargets[feedback.field]?.focus()
  }, [feedback])

  async function submitSeries(event: React.FormEvent) {
    event.preventDefault()
    if (isCreating) return
    setIsCreating(true)
    setFeedback(null)
    setCreatedSeriesId(null)
    try {
      const result = await createSessionSeries({
        programme: seriesForm.programme,
        batch: seriesForm.batch,
        venue: seriesForm.venue,
        startsOn: seriesForm.startsOn,
        endsOn: seriesForm.endsOn,
        weekdays: weekdays
          .filter((day) => seriesForm.selectedDays[day.value])
          .map((day) => day.value),
        startTime: seriesForm.startTime,
        durationMinutes: Number(seriesForm.durationMinutes),
      })
      if (!result.ok) {
        setFeedback({ field: result.field, message: result.message, tone: "error" })
        return
      }
      const createdId = result.data.createdSeriesId
      const programme = seriesForm.programme
      const freshForm = newSeriesForm(today, programme, seriesForm.batch)
      setSeriesForm(freshForm)
      setSeriesBaseline(freshForm)
      setCreatedSeriesId(createdId)
      setCreatedProgramme(programme)
      setFeedback({ message: "Schedule created", tone: "success" })

      if (guidedPlayer) {
        const params = new URLSearchParams({
          programme,
          series: createdId,
          player: guidedPlayer.member.id,
          from: guidedFromEvaluation ? "evaluation" : "assignment",
        })
        router.push(`/coach/schedules?${params.toString()}`)
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The schedule could not be created",
        tone: "error",
      })
    } finally {
      setIsCreating(false)
    }
  }

  const rosterHref = createdSeriesId && createdProgramme
    ? `/coach/schedules?programme=${encodeURIComponent(createdProgramme)}&series=${encodeURIComponent(createdSeriesId)}`
    : null

  return (
    <div className="coach-calendar page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Schedule navigation">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
        <Link href="/coach/schedules">Schedules &amp; rosters <ArrowUpRight aria-hidden="true" /></Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Training configuration</span>
          <h1>Create schedule</h1>
        </div>
      </header>

      {guidedPlayer ? (
        <div className="coach-assignment-guidance">
          <span>{guidedFromEvaluation ? "Evaluation complete" : "Player assignment"}</span>
          <strong>Create a schedule for {guidedPlayer.member.fullName}</strong>
          <p>
            {startingProgramme} · {startingBatch} · {academyPlanLabel(guidedPlayer.training.academyPlan)}.
            After creation, the matching roster will open with this player ready to assign.
          </p>
        </div>
      ) : null}

      <form className="coach-series-form" onSubmit={submitSeries}>
        <div className="coach-series-form-heading">
          <span>Recurring schedule</span>
          <h2>Create the training rhythm.</h2>
        </div>
        <div className="coach-series-form-grid">
          <label>
            <span>Programme</span>
            <select disabled={isCreating || Boolean(guidedProgramme)} value={seriesForm.programme} onChange={(event) => setSeriesForm({ ...seriesForm, programme: event.target.value as TrainingProgramme })}>
              {programmes.map((programme) => <option key={programme}>{programme}</option>)}
            </select>
          </label>
          <label>
            <span>Batch</span>
            <select disabled={isCreating || Boolean(guidedBatch)} value={seriesForm.batch} onChange={(event) => {
              const batch = event.target.value as TrainingBatch
              setSeriesForm({ ...seriesForm, batch, selectedDays: defaultSelectedDays(batch) })
            }}>
              <option>Weekday</option>
              <option>Weekend</option>
            </select>
          </label>
          <label>
            <span>Start time</span>
            <input ref={startTimeRef} type="time" required disabled={isCreating} value={seriesForm.startTime} aria-invalid={feedback?.field === "startTime" || undefined} aria-describedby={feedback?.field === "startTime" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, startTime: event.target.value })} />
          </label>
          <label>
            <span>Duration</span>
            <select ref={durationRef} disabled={isCreating} value={seriesForm.durationMinutes} aria-invalid={feedback?.field === "durationMinutes" || undefined} aria-describedby={feedback?.field === "durationMinutes" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, durationMinutes: event.target.value })}>
              {[60, 90, 120, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
            </select>
          </label>
          <label className="is-wide">
            <span>Venue or court</span>
            <input ref={venueRef} required disabled={isCreating} maxLength={120} value={seriesForm.venue} aria-invalid={feedback?.field === "venue" || undefined} aria-describedby={feedback?.field === "venue" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, venue: event.target.value })} />
          </label>
          <label>
            <span>Starts</span>
            <input ref={startsOnRef} type="date" required disabled={isCreating} value={seriesForm.startsOn} aria-invalid={feedback?.field === "startsOn" || undefined} aria-describedby={feedback?.field === "startsOn" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, startsOn: event.target.value })} />
          </label>
          <label>
            <span>Ends</span>
            <input ref={endsOnRef} type="date" required disabled={isCreating} min={seriesForm.startsOn} value={seriesForm.endsOn} aria-invalid={feedback?.field === "endsOn" || undefined} aria-describedby={feedback?.field === "endsOn" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, endsOn: event.target.value })} />
          </label>
          <div className="coach-series-name-preview is-wide">
            <span>Session name</span>
            <strong>{formatSessionLabel({
              programme: seriesForm.programme,
              batch: seriesForm.batch,
              startTime: seriesForm.startTime,
              durationMinutes: Number(seriesForm.durationMinutes),
            })}</strong>
            <small>Generated automatically and shown consistently throughout the portal.</small>
          </div>
        </div>
        <fieldset ref={weekdaysRef} className="coach-weekly-slots" aria-invalid={feedback?.field === "weekdays" || undefined} aria-describedby={feedback?.field === "weekdays" ? feedbackId : undefined}>
          <legend>{seriesForm.batch} training days</legend>
          {weekdays.map((day) => {
            const isAllowed = seriesForm.batch === "Weekday"
              ? day.value >= 1 && day.value <= 5
              : day.value === 0 || day.value === 6
            const isSelected = Boolean(seriesForm.selectedDays[day.value])
            return (
              <div key={day.value} className={isSelected ? "is-selected" : undefined}>
                <label className="coach-slot-day">
                  <input type="checkbox" disabled={!isAllowed || isCreating} checked={isSelected} onChange={(event) => setSeriesForm({
                    ...seriesForm,
                    selectedDays: { ...seriesForm.selectedDays, [day.value]: event.target.checked },
                  })} />
                  <span>{day.label}</span>
                </label>
              </div>
            )
          })}
        </fieldset>
        <InlineNotice
          className="coach-series-form-notice"
          id={feedbackId}
          message={feedback?.message}
          tone={feedback?.tone}
        />
        <button className="coach-series-submit" type="submit" disabled={isCreating}>
          <CalendarDays aria-hidden="true" /> {isCreating ? "Creating…" : "Create schedule"}
        </button>
        {rosterHref ? (
          <Link className="coach-schedule-roster-link" href={rosterHref}>
            Manage roster <ArrowUpRight aria-hidden="true" />
          </Link>
        ) : null}
      </form>
    </div>
  )
}
