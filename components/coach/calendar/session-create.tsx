"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import styles from "@/components/coach/sessions/sessions.module.css"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatSessionLabel } from "@/lib/format"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import { academyBatchesFor, academyPlanLabel } from "@/lib/training/academy-plans"

const programmes: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult", "Elite"]
const weekdays = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
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

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SeriesFeedback = ActionFeedback & {
  field?: string
  offerRetry?: boolean
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
  initialBatch,
  initialPlayerId = null,
  initialProgramme,
  today,
}: {
  initialBatch?: TrainingBatch
  initialPlayerId?: string | null
  initialProgramme?: TrainingProgramme
  /** The academy's date from the server, so a wrong phone clock cannot move the default start. */
  today: string
}) {
  const { players } = useMemberPortal()
  const { createSessionSeries } = useSessionPortal()
  const router = useRouter()
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
  // A guided create says who it is for in its own line at the top of the form.
  const [feedback, setFeedback] = useState<SeriesFeedback | null>(null)
  const [createdSeriesId, setCreatedSeriesId] = useState<string | null>(null)
  const [createdProgramme, setCreatedProgramme] = useState<TrainingProgramme | null>(null)
  const startTimeRef = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLSelectElement>(null)
  const venueRef = useRef<HTMLInputElement>(null)
  const startsOnRef = useRef<HTMLInputElement>(null)
  const endsOnRef = useRef<HTMLInputElement>(null)
  const weekdaysRef = useRef<HTMLFieldSetElement>(null)
  const feedbackId = "schedule-create-feedback"
  const { navigateAfterCommit } = useUnsavedWorkGuard({
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

      // A schedule created for a player in onboarding sends the coach back to
      // that player's Session step, which is now the only place a player is
      // added to a schedule.
      // Via navigateAfterCommit so the guard's history step-back cannot cancel the push.
      if (guidedPlayer) {
        const playerId = guidedPlayer.member.id
        navigateAfterCommit(() => {
          router.push(`/coach/onboarding?player=${encodeURIComponent(playerId)}`)
        })
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Your schedule details are still on screen",
        // Creating again after a save that landed only meets the clash refusal.
        unconfirmed: "Check the connection, then open Schedules to see whether the schedule was created",
        subject: "The schedule",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setIsCreating(false)
    }
  }

  const rosterHref = createdSeriesId && createdProgramme
    ? `/coach/schedules?programme=${encodeURIComponent(createdProgramme)}&series=${encodeURIComponent(createdSeriesId)}`
    : null

  function chooseProgramme(programme: TrainingProgramme) {
    const allowed = academyBatchesFor(programme)
    const batch = allowed.includes(seriesForm.batch) ? seriesForm.batch : allowed[0]
    setSeriesForm({
      ...seriesForm,
      batch,
      programme,
      selectedDays: batch === seriesForm.batch
        ? seriesForm.selectedDays
        : defaultSelectedDays(batch),
    })
  }

  return (
    <div className={`${styles.page} page-shell`}>
      <nav className={styles.back} aria-label="Schedule navigation">
        <Link href="/coach/schedules"><ArrowLeft aria-hidden="true" /> Back to Schedules</Link>
      </nav>
      <h1 className={styles.title}>New schedule</h1>

      <form className={styles.form} autoComplete="off" noValidate onSubmit={submitSeries}>
        {guidedPlayer ? (
          <p className={styles.guide}>
            For <strong>{guidedPlayer.member.fullName}</strong> ({startingProgramme} · {startingBatch} · {academyPlanLabel(guidedPlayer.training.academyPlan)}).
            You’ll go back to their onboarding to pick their days.
          </p>
        ) : null}
        <div className={styles.formTop}>
          <fieldset className={styles.chips} disabled={isCreating || Boolean(guidedProgramme)}>
            <legend>Level</legend>
            {programmes.map((programme) => (
              <label key={programme}>
                <input
                  name="programme"
                  type="radio"
                  value={programme}
                  checked={seriesForm.programme === programme}
                  onChange={() => chooseProgramme(programme)}
                />
                {programme}
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.batch} disabled={isCreating || Boolean(guidedBatch)}>
            <legend>Batch</legend>
            <div className={styles.switch}>
              {/* Advanced and Elite train weekdays only, so Weekend is not offered
                  for them -- validateSeriesInput refuses the pair regardless. */}
              {(["Weekday", "Weekend"] as TrainingBatch[]).map((batch) => (
                <label key={batch}>
                  <input
                    name="batch"
                    type="radio"
                    value={batch}
                    disabled={!academyBatchesFor(seriesForm.programme).includes(batch)}
                    checked={seriesForm.batch === batch}
                    onChange={() => setSeriesForm({ ...seriesForm, batch, selectedDays: defaultSelectedDays(batch) })}
                  />
                  {batch}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className={styles.five}>
          <label className={styles.field}>
            <span>Starts at</span>
            <input ref={startTimeRef} name="startTime" type="time" required disabled={isCreating} value={seriesForm.startTime} aria-invalid={feedback?.field === "startTime" || undefined} aria-describedby={feedback?.field === "startTime" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, startTime: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Length</span>
            <select ref={durationRef} name="durationMinutes" disabled={isCreating} value={seriesForm.durationMinutes} aria-invalid={feedback?.field === "durationMinutes" || undefined} aria-describedby={feedback?.field === "durationMinutes" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, durationMinutes: event.target.value })}>
              {[60, 90, 120, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Venue</span>
            <input ref={venueRef} name="venue" required disabled={isCreating} maxLength={120} value={seriesForm.venue} aria-invalid={feedback?.field === "venue" || undefined} aria-describedby={feedback?.field === "venue" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, venue: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>First day</span>
            <input ref={startsOnRef} name="startsOn" type="date" required disabled={isCreating} value={seriesForm.startsOn} aria-invalid={feedback?.field === "startsOn" || undefined} aria-describedby={feedback?.field === "startsOn" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, startsOn: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Last day</span>
            <input ref={endsOnRef} name="endsOn" type="date" required disabled={isCreating} min={seriesForm.startsOn} value={seriesForm.endsOn} aria-invalid={feedback?.field === "endsOn" || undefined} aria-describedby={feedback?.field === "endsOn" ? feedbackId : undefined} onChange={(event) => setSeriesForm({ ...seriesForm, endsOn: event.target.value })} />
          </label>
        </div>
        <fieldset ref={weekdaysRef} className={styles.days} aria-invalid={feedback?.field === "weekdays" || undefined} aria-describedby={feedback?.field === "weekdays" ? feedbackId : undefined}>
          <legend className={styles.daysLegend}>Days</legend>
          {weekdays.map((day) => {
            const isAllowed = seriesForm.batch === "Weekday"
              ? day.value >= 1 && day.value <= 5
              : day.value === 0 || day.value === 6
            return (
              <label key={day.value}>
                <input name="weekdays" value={day.value} type="checkbox" aria-label={day.label} disabled={!isAllowed || isCreating} checked={Boolean(seriesForm.selectedDays[day.value])} onChange={(event) => setSeriesForm({
                  ...seriesForm,
                  selectedDays: { ...seriesForm.selectedDays, [day.value]: event.target.checked },
                })} />
                <span aria-hidden="true">{day.short}</span>
              </label>
            )
          })}
        </fieldset>
        <InlineNotice
          action={feedback?.action}
          id={feedbackId}
          message={feedback?.message}
          tone={feedback?.tone}
          reserveSpace={false}
        />
        <div className={styles.formFoot}>
          <p className={styles.preview}>
            Will be called <strong>{formatSessionLabel({
              programme: seriesForm.programme,
              batch: seriesForm.batch,
              startTime: seriesForm.startTime,
              durationMinutes: Number(seriesForm.durationMinutes),
            })}</strong>
          </p>
          <div className={styles.actions}>
            {rosterHref ? (
              <Link className={styles.button} href={rosterHref}>View schedule</Link>
            ) : (
              <Link className={styles.button} href="/coach/schedules">Cancel</Link>
            )}
            <button className={styles.primary} type="submit" disabled={isCreating}>
              {isCreating
                ? "Creating…"
                : feedback?.offerRetry ? "Create schedule again" : "Create schedule"}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
