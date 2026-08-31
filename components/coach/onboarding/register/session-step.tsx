"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"

import { assignOnboardingSessionAction } from "@/app/coach/onboarding/actions"
import { InlineNotice } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import { formatDateKey, formatSessionTimeRange } from "@/lib/format"
import type { TrainingSessionSeries } from "@/lib/sessions/types"
import {
  academyPlanAssignmentLimit,
  academyPlanRequiredWeekdayCount,
} from "@/lib/training/academy-plans"

import styles from "../player-onboarding-register.module.css"
import type { SaveFeedback } from "./shared"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

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

/**
 * The assignment window is [max(training start, series start) .. series end], and the
 * server enforces it (lib/sessions/service.ts:328). The picker deliberately does NOT
 * carry min/max: clamping it left a coach unable to move the calendar with nothing on
 * screen saying why, and the browser's own "Value must be ... or later" fires only on
 * submit and never names where the bound comes from. Let any date be picked, then say
 * which bound it crosses and where that bound is changed.
 */
export function effectiveFromViolation(
  item: PlayerOnboardingCase,
  series: TrainingSessionSeries | null,
  effectiveFrom: string,
) {
  if (!series || !effectiveFrom) return null
  const earliest = firstDayForSeries(item, series)
  if (effectiveFrom < earliest) {
    return (item.trainingStartOn ?? "") > series.startsOn
      ? `${item.fullName} starts training on ${formatDateKey(earliest)}, so a session cannot begin before it.`
        + " Change the training start date in Assessment to start earlier."
      : `${series.title} runs from ${formatDateKey(earliest)}, so a session cannot begin before it.`
        + " Choose a schedule that starts earlier, or move this one's start date."
  }
  if (series.endsOn && effectiveFrom > series.endsOn) {
    return `${series.title} ends on ${formatDateKey(series.endsOn)}, so a session cannot begin after it.`
      + " Choose a schedule that runs later, or move this one's end date."
  }
  return null
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

type SessionStepFeedback = SaveFeedback & {
  field?: "weekdays" | "effectiveFrom"
}

export function SessionStep({
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
  const effectiveFromRef = useRef<HTMLInputElement>(null)
  const feedbackId = `onboarding-${item.id}-session-feedback`
  const rangeNoteId = `onboarding-${item.id}-effective-from-range`
  const weekdaysInvalid = feedback?.tone === "error" && feedback.field === "weekdays"
  const selectedSeries = options.find((series) => series.id === seriesId) ?? null
  const rangeViolation = effectiveFromViolation(item, selectedSeries, effectiveFrom)
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
    if (rangeViolation) {
      setFeedback({ field: "effectiveFrom", message: rangeViolation, tone: "error" })
      effectiveFromRef.current?.focus()
      return
    }
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
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The session could not be assigned",
        retained: "Your chosen session and days are still on screen",
        subject: "The session assignment",
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
      setFeedback({
        field: result.field === "effectiveFrom" || result.field === "weekdays"
          ? result.field
          : undefined,
        message: result.message,
        tone: "error",
      })
      if (result.field === "effectiveFrom") effectiveFromRef.current?.focus()
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
            ref={effectiveFromRef}
            name="effectiveFrom"
            type="date"
            value={effectiveFrom}
            aria-invalid={rangeViolation ? true : undefined}
            aria-describedby={rangeViolation ? rangeNoteId : undefined}
            onChange={(event) => {
              setEffectiveFrom(event.target.value)
              setFeedback(null)
            }}
          />
        </label>
      </div>
      <InlineNotice id={feedbackId} message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      {rangeViolation ? (
        <p className={styles.backdateNote} id={rangeNoteId} role="alert">
          {rangeViolation}
        </p>
      ) : effectiveFrom < referenceDate ? (
        <p className={styles.backdateNote}>
          This start date also makes earlier scheduled sessions eligible for attendance.
        </p>
      ) : null}
      <div className={styles.formActions}>
        <Link href="/coach/schedules">Review schedules</Link>
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={busy || Boolean(rangeViolation)}
        >
          {busy
            ? "Assigning…"
            : feedback?.offerRetry
              ? "Assign session again"
              : "Assign session & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
