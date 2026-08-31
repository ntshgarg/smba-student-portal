"use client"

import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CalendarOff,
  ChevronDown,
  Clock3,
  MapPin,
  RefreshCw,
  Users,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Fragment, useEffect, useRef, useState } from "react"

import { HolidayComposer } from "@/components/coach/calendar/holiday-composer"
import {
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { AcademyHolidayRecord } from "@/lib/sessions/holiday-types"
import {
  assignmentCoversOccurrence,
  calendarWindowForMonth,
  enumerateDateKeys,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import { isValidDateKey } from "@/lib/attendance/domain"
import {
  academyTimeInputValue,
  formatAcademyTime,
  formatDateKey,
  formatSessionLabel,
} from "@/lib/format"
import type { TrainingSessionOccurrence, TrainingSessionSeries } from "@/lib/sessions/types"

const weekdays = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
]

function occurrenceLabel(
  series: TrainingSessionSeries,
  occurrence: TrainingSessionOccurrence,
) {
  return formatSessionLabel({
    programme: series.programme,
    batch: series.batch,
    startTime: academyTimeInputValue(occurrence.startsAt),
    durationMinutes: occurrence.durationMinutes,
  })
}

function dateQuery(searchParams: URLSearchParams, dateKey: string) {
  const next = new URLSearchParams(searchParams.toString())
  next.set("date", dateKey)
  return next.toString()
}

function dayOccurrenceSummary(scheduledCount: number, cancelledCount: number) {
  if (!cancelledCount) {
    return `${scheduledCount} ${scheduledCount === 1 ? "session" : "sessions"}`
  }
  if (!scheduledCount) return `${cancelledCount} cancelled`
  return `${scheduledCount} scheduled · ${cancelledCount} cancelled`
}

type ReplacementDraft = {
  dateKey: string
  startTime: string
  durationMinutes: string
  venue: string
}

/**
 * Cancel and replace share one notice, so `retryAction` names which of the two
 * controls should offer the retry.
 */
type CalendarFeedback = ActionFeedback & {
  field?: string
  occurrenceId: string
  offerRetry?: boolean
  retryAction?: CalendarPendingAction["type"]
}
type CalendarPendingAction = {
  occurrenceId: string
  type: "cancel" | "replace"
}

function replacementDraftFor(occurrence: TrainingSessionOccurrence): ReplacementDraft {
  return {
    dateKey: occurrence.occurrenceDate,
    startTime: academyTimeInputValue(occurrence.startsAt),
    durationMinutes: String(occurrence.durationMinutes),
    venue: occurrence.venue,
  }
}

export function SessionCalendar({
  referenceDate,
  referenceInstant: initialReferenceInstant,
  selectedDate,
}: {
  referenceDate: string
  referenceInstant: number
  selectedDate: string
}) {
  const { players } = useMemberPortal()
  const {
    academyHolidays,
    cancelSessionOccurrence,
    replaceSessionOccurrence,
    retractAcademyHoliday,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useSessionPortal()
  const [referenceInstant, setReferenceInstant] = useState(initialReferenceInstant)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = referenceDate
  const selectedMonth = selectedDate.slice(0, 7)
  const monthWindow = calendarWindowForMonth(selectedMonth)
  const monthOccurrences = sessionOccurrences.filter((occurrence) => (
    occurrence.occurrenceDate >= monthWindow.from && occurrence.occurrenceDate <= monthWindow.to
  ))
  const dayOccurrences = sessionOccurrences
    .filter((occurrence) => occurrence.occurrenceDate === selectedDate)
    .sort((first, second) => first.startsAt.localeCompare(second.startsAt) || first.id.localeCompare(second.id))
  const scheduledDayCount = dayOccurrences.filter((occurrence) => occurrence.status === "scheduled").length
  const cancelledDayCount = dayOccurrences.length - scheduledDayCount
  const seriesById = new Map(sessionSeries.map((series) => [series.id, series]))
  const holidayByDate = new Map(academyHolidays.map((holiday) => [holiday.dateKey, holiday]))
  const selectedHoliday = holidayByDate.get(selectedDate) ?? null

  const [holidayComposerOpen, setHolidayComposerOpen] = useState(false)
  const [retractingHoliday, setRetractingHoliday] = useState(false)
  const [holidayFeedback, setHolidayFeedback] = useState<ActionFeedback | null>(null)
  const [mobileView, setMobileView] = useState<"month" | "day">("day")
  const [expandedOccurrenceId, setExpandedOccurrenceId] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<ReplacementDraft>({
    dateKey: selectedDate,
    startTime: "06:00",
    durationMinutes: "60",
    venue: "",
  })
  const [replacementBaseline, setReplacementBaseline] = useState<ReplacementDraft>(replacement)
  const [pendingSessionAction, setPendingSessionAction] = useState<CalendarPendingAction | null>(null)
  const [feedback, setFeedback] = useState<CalendarFeedback | null>(null)
  const shouldFocusDay = useRef(false)
  const dayHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldFocusMonth = useRef(false)
  const monthHeadingRef = useRef<HTMLHeadingElement>(null)
  const replacementGuard = useUnsavedWorkGuard({
    isDirty: Boolean(expandedOccurrenceId)
      && JSON.stringify(replacement) !== JSON.stringify(replacementBaseline),
    message: "Discard the unsaved replacement details?",
    scope: "coach-calendar-replacement",
  })

  // Advanced from the instant the server rendered with, by however much real
  // time has passed, rather than reset to the device's own clock. The register
  // has to notice a session starting while the coach is looking at it, so the
  // 30s tick stays; what changes is whose "now" it counts from.
  //
  // Courtside that removes a dependency on the phone being set correctly:
  // `occurrenceIsUpcoming` decides whether this occurrence offers "Open
  // attendance" or the cancel and replace controls, and a handset running minutes fast used to be able to
  // swap one set for the other on its own.
  //
  // It also keeps the audited DOM still. `academyNow()` can pin the server's
  // clock for the accessibility gate (`lib/clock.ts`); a tick that jumped to the
  // browser's wall clock would un-pin this subtree 30s after load, by the nine
  // days the pin currently holds back today -- and by one more day for every day
  // that passes.
  useEffect(() => {
    const mountedAt = Date.now()
    const timer = window.setInterval(
      () => setReferenceInstant(initialReferenceInstant + (Date.now() - mountedAt)),
      30_000,
    )
    return () => window.clearInterval(timer)
  }, [initialReferenceInstant])

  useEffect(() => {
    if (!shouldFocusDay.current) return
    shouldFocusDay.current = false
    dayHeadingRef.current?.focus({ preventScroll: true })
  }, [selectedDate])

  /*
   * The reverse of the effect above, which was missing.
   *
   * At or below 760px the two panes are exclusive -- `.coach-calendar-workspace`
   * carries `is-month`/`is-day` and app/portal.css hides the other one outright.
   * So "Back to month" hides the pane the pressed button lives in, and the HTML
   * focus-fixup rule then moves focus to `<body>` on the next style update. The
   * next Tab restarts at the top of the document, past the skip link; a screen
   * reader hears nothing at all, because the view changed and no live region
   * says so.
   *
   * Gated on the ref, not on `mobileView` alone, so only a deliberate press
   * moves focus. The same layout is what a desktop coach at 400% zoom gets,
   * which is the other way this is reached.
   */
  useEffect(() => {
    if (mobileView !== "month" || !shouldFocusMonth.current) return
    shouldFocusMonth.current = false
    monthHeadingRef.current?.focus({ preventScroll: true })
  }, [mobileView])

  function occurrenceRoster(occurrence: TrainingSessionOccurrence) {
    return players.filter((player) => (
      playerWasEnrolledForOccurrence(player.member.trainingStartOn, occurrence)
      && sessionAssignments.some((assignment) => (
        assignment.playerId === player.member.id
        && assignmentCoversOccurrence(assignment, occurrence)
      ))
    ))
  }

  function selectDate(dateKey: string, openDay: boolean) {
    if (!isValidDateKey(dateKey)) return
    if (dateKey === selectedDate) {
      if (openDay) setMobileView("day")
      return
    }
    if (!replacementGuard.confirmDiscard(
      "Leave this day and discard the unsaved replacement details?",
    )) return
    setFeedback(null)
    setExpandedOccurrenceId(null)
    if (openDay) {
      setMobileView("day")
      shouldFocusDay.current = true
    }
    router.push(`${pathname}?${dateQuery(new URLSearchParams(searchParams.toString()), dateKey)}`, { scroll: false })
  }

  function openOccurrence(occurrence: TrainingSessionOccurrence) {
    if (pendingSessionAction !== null) return
    if (!replacementGuard.confirmDiscard()) return
    const nextReplacement = replacementDraftFor(occurrence)
    setExpandedOccurrenceId((current) => current === occurrence.id ? null : occurrence.id)
    setReplacement(nextReplacement)
    setReplacementBaseline(nextReplacement)
    setFeedback(null)
  }

  return (
    <div className="coach-calendar page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Training operations">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
        <Link href="/coach/schedules">Schedules &amp; rosters <ArrowUpRight aria-hidden="true" /></Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Training operations</span>
          <h1>Session Calendar</h1>
        </div>
        <button type="button" onClick={() => setHolidayComposerOpen(true)}>
          <CalendarOff aria-hidden="true" /> Mark holiday
        </button>
      </header>

      {holidayComposerOpen ? (
        <HolidayComposer
          onClose={() => setHolidayComposerOpen(false)}
          selectedDate={selectedDate}
          today={today}
        />
      ) : null}

      <section className={`coach-calendar-workspace is-${mobileView}`} aria-label="Session calendar workspace">
        <div className="coach-calendar-month-pane">
          <div className="coach-calendar-controls">
            <label>
              <span className="sr-only">Choose calendar month</span>
              <input
                name="calendarMonth"
                type="month"
                value={selectedMonth}
                onChange={(event) => {
                  const nextMonth = event.target.value
                  const nextDate = nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`
                  selectDate(nextDate, false)
                }}
              />
            </label>
            <button type="button" onClick={() => selectDate(today, true)}>Today</button>
          </div>

          <div className="coach-calendar-title-row">
            <div>
              <span>Month view</span>
              <h2 ref={monthHeadingRef} tabIndex={-1}>{formatDateKey(monthWindow.from, {
                month: "long",
                year: "numeric",
                weekday: undefined,
                day: undefined,
              })}</h2>
            </div>
            <strong>{monthOccurrences.filter((occurrence) => occurrence.status === "scheduled").length} sessions</strong>
          </div>

          <MonthGrid
            holidayByDate={holidayByDate}
            month={selectedMonth}
            occurrences={monthOccurrences}
            selectedDate={selectedDate}
            today={today}
            onSelect={(dateKey) => selectDate(dateKey, true)}
          />
        </div>

        <section className="coach-day-view" aria-labelledby="coach-day-view-title">
          <button
            className="coach-day-view-back"
            type="button"
            onClick={() => {
              shouldFocusMonth.current = true
              setMobileView("month")
            }}
          >
            <ArrowLeft aria-hidden="true" /> Back to month
          </button>
          <div className="coach-day-view-heading">
            <div>
              <span>Day view</span>
              <h2 id="coach-day-view-title" ref={dayHeadingRef} tabIndex={-1}>
                {formatDateKey(selectedDate, { year: "numeric" })}
              </h2>
            </div>
            <strong>{dayOccurrenceSummary(scheduledDayCount, cancelledDayCount)}</strong>
          </div>

          {selectedHoliday ? (
            <div className="coach-day-holiday">
              <div>
                <span>Academy closed</span>
                <strong>{selectedHoliday.label}</strong>
              </div>
              {/*
                * Removing a holiday puts back only the sessions that holiday
                * cancelled, so a session called off separately beforehand stays
                * off. The server refuses outright if something has since been
                * scheduled onto the freed date.
                */}
              <button
                type="button"
                disabled={retractingHoliday}
                onClick={() => {
                  if (retractingHoliday) return
                  const confirmed = window.confirm(
                    `Remove the ${selectedHoliday.label} holiday on ${formatDateKey(selectedDate)}? The sessions it cancelled will be restored.`,
                  )
                  if (!confirmed) return
                  setRetractingHoliday(true)
                  setHolidayFeedback(null)
                  void retractAcademyHoliday(selectedDate)
                    .then((result) => {
                      if (!result.ok) {
                        setHolidayFeedback({ message: result.message, tone: "error" })
                      }
                    })
                    .catch((error: unknown) => {
                      const failure = describeSaveFailure({
                        error,
                        fallbackMessage: "The holiday could not be removed",
                        retained: "The holiday is unchanged",
                        subject: "Removing the holiday",
                      })
                      setHolidayFeedback({ message: failure.message, tone: "error" })
                    })
                    .finally(() => setRetractingHoliday(false))
                }}
              >
                {retractingHoliday ? "Removing…" : "Remove holiday"}
              </button>
            </div>
          ) : null}

          <InlineNotice
            message={holidayFeedback?.message}
            tone={holidayFeedback?.tone}
            reserveSpace={false}
          />

          {!dayOccurrences.length ? (
            <div className="coach-calendar-empty coach-day-view-empty">
              <CalendarDays aria-hidden="true" />
              <h3>No sessions today.</h3>
              <p>This day is clear. Create a schedule to configure the academy’s recurring training rhythm.</p>
              <Link href="/coach/schedules/new">Create schedule</Link>
            </div>
          ) : (
            <div className="coach-day-session-list">
              {dayOccurrences.map((occurrence) => {
                const series = seriesById.get(occurrence.seriesId)
                if (!series) return null
                const roster = occurrenceRoster(occurrence)
                const isExpanded = expandedOccurrenceId === occurrence.id
                const fullSessionLabel = occurrenceLabel(series, occurrence)
                const playerCountLabel = `${roster.length} ${roster.length === 1 ? "player" : "players"}`
                return (
                  <Fragment key={occurrence.id}>
                    <article className={[
                      "coach-day-session",
                      occurrence.status === "cancelled" ? "is-cancelled" : "",
                      isExpanded ? "is-expanded" : "",
                    ].filter(Boolean).join(" ")}>
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${fullSessionLabel}. ${occurrence.status === "cancelled" ? "Cancelled. " : ""}${playerCountLabel}.`}
                        onClick={() => openOccurrence(occurrence)}
                      >
                        <time dateTime={occurrence.startsAt}>{formatAcademyTime(occurrence.startsAt)}</time>
                        <span>
                          {occurrence.status === "cancelled" ? <small className="coach-day-session-status">Cancelled</small> : null}
                          <strong>{series.programme} · {series.batch}</strong>
                          <small><Users aria-hidden="true" /> {playerCountLabel}</small>
                        </span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </article>
                    {isExpanded ? (
                      <OccurrenceDetails
                        occurrence={occurrence}
                        series={series}
                        roster={roster}
                        today={today}
                        feedback={feedback?.occurrenceId === occurrence.id ? feedback : null}
                        pendingAction={pendingSessionAction?.occurrenceId === occurrence.id
                          ? pendingSessionAction.type
                          : null}
                        referenceInstant={referenceInstant}
                        replacement={replacement}
                        setReplacement={setReplacement}
                        onCancel={async () => {
                          if (pendingSessionAction !== null) return
                          const hasReplacementDraft = JSON.stringify(replacement) !== JSON.stringify(replacementBaseline)
                          const confirmed = window.confirm(
                            `Cancel ${occurrenceLabel(series, occurrence)} on ${formatDateKey(occurrence.occurrenceDate)}? The session will remain in history${hasReplacementDraft ? ", and the unsaved replacement details will be discarded" : ""}.`,
                          )
                          if (!confirmed) return
                          setPendingSessionAction({ occurrenceId: occurrence.id, type: "cancel" })
                          setFeedback(null)
                          try {
                            const result = await cancelSessionOccurrence(occurrence.id)
                            if (!result.ok) {
                              setFeedback({
                                field: result.field,
                                message: result.message,
                                occurrenceId: occurrence.id,
                                tone: "error",
                              })
                              return
                            }
                            const originalReplacement = replacementDraftFor(occurrence)
                            setReplacement(originalReplacement)
                            setReplacementBaseline(originalReplacement)
                            setFeedback({ message: "Session cancelled", occurrenceId: occurrence.id, tone: "success" })
                          } catch (error) {
                            const failure = describeSaveFailure({
                              error,
                              fallbackMessage: "Session could not be cancelled",
                              retained: "The session is still scheduled",
                              subject: "The cancellation",
                            })
                            setFeedback({
                              message: failure.message,
                              occurrenceId: occurrence.id,
                              offerRetry: failure.offerRetry,
                              retryAction: "cancel",
                              tone: "error",
                            })
                          } finally {
                            setPendingSessionAction(null)
                          }
                        }}
                        onReplace={async () => {
                          if (pendingSessionAction !== null) return
                          const replacementDateLabel = isValidDateKey(replacement.dateKey)
                            ? formatDateKey(replacement.dateKey)
                            : "the selected date"
                          const confirmed = window.confirm(
                            `Replace ${occurrenceLabel(series, occurrence)} on ${formatDateKey(occurrence.occurrenceDate)} with ${replacementDateLabel} at ${replacement.startTime || "the selected time"}? The original session will be cancelled and kept in history.`,
                          )
                          if (!confirmed) return

                          setPendingSessionAction({ occurrenceId: occurrence.id, type: "replace" })
                          setFeedback(null)
                          try {
                            const result = await replaceSessionOccurrence({
                              occurrenceId: occurrence.id,
                              dateKey: replacement.dateKey,
                              startTime: replacement.startTime,
                              durationMinutes: Number(replacement.durationMinutes),
                              venue: replacement.venue,
                            })
                            if (!result.ok) {
                              setFeedback({
                                field: result.field,
                                message: result.message,
                                occurrenceId: occurrence.id,
                                tone: "error",
                              })
                              return
                            }
                            setReplacementBaseline(replacement)
                            setFeedback({ message: "Replacement session created", occurrenceId: occurrence.id, tone: "success" })
                          } catch (error) {
                            const failure = describeSaveFailure({
                              error,
                              fallbackMessage: "Session could not be replaced",
                              retained: "Your replacement details are still on screen",
                              subject: "The replacement session",
                            })
                            setFeedback({
                              message: failure.message,
                              occurrenceId: occurrence.id,
                              offerRetry: failure.offerRetry,
                              retryAction: "replace",
                              tone: "error",
                            })
                          } finally {
                            setPendingSessionAction(null)
                          }
                        }}
                      />
                    ) : null}
                  </Fragment>
                )
              })}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function OccurrenceDetails({
  feedback,
  occurrence,
  onCancel,
  onReplace,
  pendingAction,
  referenceInstant,
  replacement,
  roster,
  series,
  setReplacement,
  today,
}: {
  feedback: CalendarFeedback | null
  occurrence: TrainingSessionOccurrence
  onCancel: () => void
  onReplace: () => void
  pendingAction: "cancel" | "replace" | null
  referenceInstant: number
  replacement: { dateKey: string; startTime: string; durationMinutes: string; venue: string }
  roster: ReturnType<typeof useMemberPortal>["players"]
  series: TrainingSessionSeries
  setReplacement: React.Dispatch<React.SetStateAction<typeof replacement>>
  today: string
}) {
  const isFuture = occurrenceIsUpcoming(occurrence, referenceInstant)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const timeInputRef = useRef<HTMLInputElement>(null)
  const durationInputRef = useRef<HTMLInputElement>(null)
  const venueInputRef = useRef<HTMLInputElement>(null)
  const feedbackId = `occurrence-feedback-${occurrence.id}`
  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined

  useEffect(() => {
    if (feedback?.tone !== "error") return
    if (feedback.field === "dateKey") dateInputRef.current?.focus()
    if (feedback.field === "startTime") timeInputRef.current?.focus()
    if (feedback.field === "durationMinutes") durationInputRef.current?.focus()
    if (feedback.field === "venue") venueInputRef.current?.focus()
  }, [feedback])

  return (
    <div className="coach-occurrence-detail">
      <div className="coach-occurrence-context">
        <span><Clock3 aria-hidden="true" /> {formatAcademyTime(occurrence.startsAt)} · {occurrence.durationMinutes} minutes</span>
        <span><MapPin aria-hidden="true" /> {occurrence.venue}</span>
      </div>
      <div className="coach-occurrence-roster">
        <div><span>Session roster</span><strong>{roster.length} {roster.length === 1 ? "player" : "players"}</strong></div>
        {roster.length ? (
          <ul className="coach-occurrence-roster-list">
            {roster.map((player) => (
              <li key={player.member.id}>
                <span aria-hidden="true">{player.member.initials}</span>
                <strong>{player.member.fullName}</strong>
              </li>
            ))}
          </ul>
        ) : <p>No players were assigned to this occurrence.</p>}
      </div>
      <InlineNotice
        className="coach-calendar-inline-notice"
        id={feedbackId}
        message={feedback?.message}
        tone={feedback?.tone}
      />
      {!isFuture && occurrence.status === "scheduled" ? (
        <Link
          className="coach-open-attendance"
          href={`/coach/attendance/players/record?date=${encodeURIComponent(occurrence.occurrenceDate)}&occurrence=${encodeURIComponent(occurrence.id)}&from=calendar`}
        >
          Open attendance <ArrowUpRight aria-hidden="true" />
        </Link>
      ) : null}
      {!isFuture || occurrence.status === "cancelled" ? null : (
        <div className="coach-occurrence-actions">
          <button type="button" disabled={pendingAction !== null} onClick={onCancel}>
            <X aria-hidden="true" /> {pendingAction === "cancel"
              ? "Cancelling…"
              : retryAction === "cancel" ? "Cancel session again" : "Cancel session"}
          </button>
          <details>
            <summary
              aria-disabled={pendingAction !== null}
              onClick={(event) => {
                if (pendingAction !== null) event.preventDefault()
              }}
            ><RefreshCw aria-hidden="true" /> Replace session</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                onReplace()
              }}
            >
              <label><span>Date</span><input ref={dateInputRef} name="replacementDate" type="date" disabled={pendingAction !== null} min={today} value={replacement.dateKey} aria-invalid={feedback?.field === "dateKey" || undefined} aria-describedby={feedback?.field === "dateKey" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, dateKey: event.target.value })} /></label>
              <label><span>Time</span><input ref={timeInputRef} name="replacementStartTime" type="time" disabled={pendingAction !== null} value={replacement.startTime} aria-invalid={feedback?.field === "startTime" || undefined} aria-describedby={feedback?.field === "startTime" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, startTime: event.target.value })} /></label>
              <label><span>Duration</span><input ref={durationInputRef} name="replacementDurationMinutes" type="number" disabled={pendingAction !== null} min={30} max={300} step={15} value={replacement.durationMinutes} aria-invalid={feedback?.field === "durationMinutes" || undefined} aria-describedby={feedback?.field === "durationMinutes" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, durationMinutes: event.target.value })} /></label>
              <label><span>Venue</span><input ref={venueInputRef} name="replacementVenue" required maxLength={120} disabled={pendingAction !== null} value={replacement.venue} aria-invalid={feedback?.field === "venue" || undefined} aria-describedby={feedback?.field === "venue" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, venue: event.target.value })} /></label>
              <button type="submit" disabled={pendingAction !== null}>
                {pendingAction === "replace"
                  ? "Creating…"
                  : retryAction === "replace" ? "Create replacement again" : "Create replacement"}
              </button>
            </form>
          </details>
        </div>
      )}
      <span className="sr-only">{occurrenceLabel(series, occurrence)}</span>
    </div>
  )
}

function MonthGrid({
  holidayByDate,
  month,
  occurrences,
  onSelect,
  selectedDate,
  today,
}: {
  holidayByDate: Map<string, AcademyHolidayRecord>
  month: string
  occurrences: TrainingSessionOccurrence[]
  onSelect: (dateKey: string) => void
  selectedDate: string
  today: string
}) {
  const window = calendarWindowForMonth(month)
  const dates = enumerateDateKeys(window.from, window.to)
  const leading = (new Date(`${window.from}T00:00:00.000Z`).getUTCDay() + 6) % 7
  return (
    <div className="coach-month-grid">
      {weekdays.map((day) => <span key={day.value}>{day.short}</span>)}
      {Array.from({ length: leading }, (_, index) => <i key={`empty-${index}`} />)}
      {dates.map((dateKey) => {
        const count = occurrences.filter((occurrence) => occurrence.occurrenceDate === dateKey && occurrence.status === "scheduled").length
        const isSelected = dateKey === selectedDate
        const holiday = holidayByDate.get(dateKey)
        /*
         * Named in the accessible label rather than left to the tint. A closed
         * day has no scheduled sessions, so without this it announces "0
         * sessions" -- the same as a Sunday, which is the confusion the whole
         * feature exists to remove.
         */
        const label = holiday
          ? `${formatDateKey(dateKey)}, closed for ${holiday.label}`
          : `${formatDateKey(dateKey)}, ${count} ${count === 1 ? "session" : "sessions"}`
        return (
          <button
            key={dateKey}
            type="button"
            className={[
              count ? "has-sessions" : "",
              holiday ? "is-holiday" : "",
              isSelected ? "is-selected" : "",
            ].filter(Boolean).join(" ") || undefined}
            aria-current={dateKey === today ? "date" : undefined}
            aria-label={label}
            aria-pressed={isSelected}
            onClick={() => onSelect(dateKey)}
          >
            <strong>{Number(dateKey.slice(-2))}</strong>
            {holiday
              ? <small className="coach-month-holiday">Holiday</small>
              : count ? <small>{count} {count === 1 ? "session" : "sessions"}</small> : null}
          </button>
        )
      })}
    </div>
  )
}
