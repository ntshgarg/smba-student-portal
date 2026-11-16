"use client"

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { WeekStrip } from "@/components/coach/attendance/week-strip"
import { HolidayComposer, pluralSessions } from "@/components/coach/calendar/holiday-composer"
import {
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { SessionsShell } from "@/components/coach/sessions/sessions-shell"
import styles from "@/components/coach/sessions/sessions.module.css"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { AcademyHolidayRecord } from "@/lib/sessions/holiday-types"
import {
  assignmentCoversOccurrence,
  calendarWindowForMonth,
  enumerateDateKeys,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { cancellationLabel } from "@/lib/sessions/cancellation"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import { isValidDateKey } from "@/lib/attendance/domain"
import {
  academyTimeInputValue,
  formatAcademyTime,
  formatDateKey,
  formatSessionLabel,
  getAcademyDateKey,
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

/** "2026-11" moved by whole months, for the month's ‹ › buttons. */
function shiftMonth(month: string, months: number) {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 7)
}

/**
 * The one tag a day's row carries. A cancelled session says why, as the Mark
 * tab does; a running one says only where it stands against the clock -- the
 * calendar reads no attendance, so it never claims a register is done.
 */
function occurrenceTag(
  occurrence: TrainingSessionOccurrence,
  cancelledLabel: string | null,
  today: string,
  referenceInstant: number,
) {
  if (cancelledLabel) {
    return { label: cancelledLabel, tone: cancelledLabel === "Moved" ? "moved" : "off" }
  }
  if (!occurrenceIsUpcoming(occurrence, referenceInstant)) return { label: "Done", tone: "done" }
  return { label: occurrence.occurrenceDate === today ? "Later today" : "Upcoming", tone: undefined }
}

function dayOccurrenceSummary(scheduledCount: number, cancelledCount: number) {
  if (!cancelledCount) {
    return `${scheduledCount} ${scheduledCount === 1 ? "session" : "sessions"}`
  }
  if (!scheduledCount) return `${cancelledCount} cancelled`
  return `${scheduledCount} scheduled · ${cancelledCount} cancelled`
}

/**
 * What removing a holiday actually did, in the coach's words. It names the day:
 * the notice sits above the calendar and the coach may be looking at another
 * day, or the month on a phone, by the time the answer comes back.
 */
export function holidayRemovedMessage(
  dateKey: string,
  {
    keptCancelledSessions,
    restoredSessions,
    reviewFlagsCleared,
  }: {
    keptCancelledSessions: number
    restoredSessions: number
    reviewFlagsCleared: number
  },
) {
  const day = formatDateKey(dateKey)
  const parts = [
    restoredSessions
      ? `Holiday on ${day} removed. ${pluralSessions(restoredSessions)} ${restoredSessions === 1 ? "is" : "are"} back on.`
      : `Holiday on ${day} removed. No sessions needed restoring.`,
  ]
  if (keptCancelledSessions) {
    parts.push(`${pluralSessions(keptCancelledSessions)} stayed cancelled because ${keptCancelledSessions === 1 ? "its schedule has" : "their schedules have"} ended or already ${keptCancelledSessions === 1 ? "has" : "have"} a session that day.`)
  }
  if (reviewFlagsCleared) {
    parts.push(`${reviewFlagsCleared} make-up${reviewFlagsCleared === 1 ? " is" : "s are"} no longer waiting for review.`)
  }
  return parts.join(" ")
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
  referenceInstant: initialReferenceInstant,
  selectedDate,
}: {
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
  // From the ticking clock, so a page left open past midnight moves on to the new day.
  const today = getAcademyDateKey(referenceInstant)
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

  // Mark holiday opens in place, above the day, in place of a dialog.
  const [holidayComposerOpen, setHolidayComposerOpen] = useState(false)
  // The dates being reopened, not a flag: the coach can move to another closed
  // day while a removal is in flight and remove that one too. Server actions
  // run one after another, so the second waits for the first.
  const [retractingHolidayDates, setRetractingHolidayDates] = useState<readonly string[]>([])
  const retractingHoliday = retractingHolidayDates.includes(selectedDate)
  // Above the day, not inside it: the coach may have moved to another day by
  // the time the answer comes back. Every message names its days, so it reads
  // right whichever day is selected.
  const [holidayFeedback, setHolidayFeedback] = useState<ActionFeedback | null>(null)
  // "Pick a date" swaps the week strip for the month, which shows each day's sessions and holidays.
  const [monthOpen, setMonthOpen] = useState(false)
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
  const expandedOccurrence = expandedOccurrenceId
    ? dayOccurrences.find((occurrence) => occurrence.id === expandedOccurrenceId) ?? null
    : null
  const replacementGuard = useUnsavedWorkGuard({
    // Only while the replacement form is actually on screen. Once the session
    // starts, is cancelled or moves away, the form is gone and there is nothing
    // left to lose, so leaving should not ask.
    isDirty: Boolean(expandedOccurrence)
      && expandedOccurrence?.status === "scheduled"
      && occurrenceIsUpcoming(expandedOccurrence, referenceInstant)
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
   * Opening the month replaces the strip that held "Pick a date", so focus is
   * moved to the month's heading rather than left on a button that is gone,
   * where the next Tab would restart at the top of the document. Gated on the
   * ref so only a deliberate press moves it.
   */
  useEffect(() => {
    if (!monthOpen || !shouldFocusMonth.current) return
    shouldFocusMonth.current = false
    monthHeadingRef.current?.focus({ preventScroll: true })
  }, [monthOpen])

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
      if (openDay) setMonthOpen(false)
      return
    }
    // Stay on the day until a cancel or move has its answer, so its outcome is seen.
    if (pendingSessionAction !== null) return
    // A month change remounts this screen, which would drop a removal's answer.
    if (retractingHolidayDates.length && dateKey.slice(0, 7) !== selectedMonth) return
    if (!replacementGuard.confirmDiscard(
      "Leave this day and discard the unsaved replacement details?",
    )) return
    setFeedback(null)
    // A finished holiday notice has been seen; one still on its way names its day.
    setHolidayFeedback(null)
    setExpandedOccurrenceId(null)
    if (openDay) {
      setMonthOpen(false)
      shouldFocusDay.current = true
    }
    // Via navigateAfterCommit so the guard's history step-back cannot cancel the push.
    replacementGuard.navigateAfterCommit(() => {
      router.push(`${pathname}?${dateQuery(new URLSearchParams(searchParams.toString()), dateKey)}`, { scroll: false })
    })
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
    <SessionsShell activeTab="calendar">
      {monthOpen ? (
        <section className={styles.month} aria-labelledby="coach-calendar-month-title">
          <div className={styles.monthHead}>
            <h2 id="coach-calendar-month-title" ref={monthHeadingRef} tabIndex={-1}>{formatDateKey(monthWindow.from, {
              month: "long",
              year: "numeric",
              weekday: undefined,
              day: undefined,
            })}</h2>
            <div className={styles.monthNav}>
              <button type="button" aria-label="Previous month" onClick={() => {
                const month = shiftMonth(selectedMonth, -1)
                selectDate(month === today.slice(0, 7) ? today : `${month}-01`, false)
              }}><ChevronLeft aria-hidden="true" /></button>
              <button type="button" onClick={() => selectDate(today, true)}>Today</button>
              <button type="button" aria-label="Next month" onClick={() => {
                const month = shiftMonth(selectedMonth, 1)
                selectDate(month === today.slice(0, 7) ? today : `${month}-01`, false)
              }}><ChevronRight aria-hidden="true" /></button>
            </div>
          </div>
          <MonthGrid
            holidayByDate={holidayByDate}
            month={selectedMonth}
            occurrences={monthOccurrences}
            selectedDate={selectedDate}
            today={today}
            onSelect={(dateKey) => selectDate(dateKey, true)}
          />
        </section>
      ) : (
        <WeekStrip
          onChoose={(dateKey) => selectDate(dateKey, false)}
          onPick={() => {
            shouldFocusMonth.current = true
            setMonthOpen(true)
          }}
          pickOpen={monthOpen}
          selectedDate={selectedDate}
        />
      )}

      <InlineNotice
        action={holidayFeedback?.action}
        message={holidayFeedback?.message}
        tone={holidayFeedback?.tone}
        reserveSpace={false}
      />

      {holidayComposerOpen ? (
        <HolidayComposer
          onClose={() => setHolidayComposerOpen(false)}
          onNotice={setHolidayFeedback}
          selectedDate={selectedDate}
          today={today}
          viewMonth={selectedMonth}
        />
      ) : null}

      <section className={styles.panel} aria-labelledby="coach-day-view-title">
        <div className={styles.panelHead}>
          <h2 id="coach-day-view-title" ref={dayHeadingRef} tabIndex={-1}>
            {selectedDate === today ? "Today · " : ""}{formatDateKey(selectedDate, { year: "numeric" })}
          </h2>
          <p>
            <span>{dayOccurrenceSummary(scheduledDayCount, cancelledDayCount)}</span>
            {holidayComposerOpen ? null : (
              <button className={styles.link} type="button" onClick={() => setHolidayComposerOpen(true)}>
                Mark holiday
              </button>
            )}
          </p>
        </div>

        {selectedHoliday ? (
          <div className={styles.notice}>
            <span>{selectedHoliday.label} · academy closed</span>
            {/* Removing a holiday puts back only the sessions it cancelled, except upcoming ones of a schedule ended since. */}
            <button
              className={styles.button}
              type="button"
              disabled={retractingHoliday}
              onClick={() => {
                if (retractingHoliday) return
                const dateKey = selectedDate
                const day = formatDateKey(dateKey)
                const confirmed = window.confirm(
                  `Remove the ${selectedHoliday.label} holiday on ${day}? The sessions it cancelled come back, except upcoming ones whose schedule has ended since, and any whose schedule already has a session that day.`,
                )
                if (!confirmed) return
                setRetractingHolidayDates((current) => [...current, dateKey])
                setHolidayFeedback(null)
                void retractAcademyHoliday(dateKey)
                  .then((result) => {
                    if (!result.ok) {
                      setHolidayFeedback({
                        message: `The holiday on ${day} was not removed. ${result.message}`,
                        tone: "error",
                      })
                      return
                    }
                    setHolidayFeedback({
                      message: holidayRemovedMessage(dateKey, result.data),
                      tone: "success",
                    })
                  })
                  .catch((error: unknown) => {
                    const failure = describeSaveFailure({
                      error,
                      retained: "The holiday is unchanged",
                      unconfirmed: "Check the connection, then reload the page to see whether the holiday was removed",
                      subject: `Removing the holiday on ${day}`,
                    })
                    setHolidayFeedback({ action: failure.signIn, message: failure.message, tone: "error" })
                  })
                  .finally(() => setRetractingHolidayDates((current) => (
                    current.filter((candidate) => candidate !== dateKey)
                  )))
              }}
            >
              {retractingHoliday ? "Removing…" : "Remove holiday"}
            </button>
          </div>
        ) : null}

        {!dayOccurrences.length ? (
          // Any day can be selected, so this names the day, not today.
          <div className={styles.empty}>
            <h3>No sessions on this day.</h3>
            {selectedHoliday ? (
              <p>The academy is closed, and nothing was scheduled.</p>
            ) : (
              <p><Link className={styles.link} href="/coach/schedules/new">Create a schedule</Link></p>
            )}
          </div>
        ) : (
          <ul className={styles.rows}>
            {dayOccurrences.map((occurrence) => {
              const series = seriesById.get(occurrence.seriesId)
              if (!series) return null
              const roster = occurrenceRoster(occurrence)
              const isExpanded = expandedOccurrenceId === occurrence.id
              const fullSessionLabel = occurrenceLabel(series, occurrence)
              const playerCountLabel = `${roster.length} ${roster.length === 1 ? "player" : "players"}`
              const cancelledLabel = occurrence.status !== "cancelled"
                ? null
                : cancellationLabel(occurrence, sessionOccurrences, holidayByDate)
              const tag = occurrenceTag(occurrence, cancelledLabel, today, referenceInstant)
              return (
                <li
                  key={occurrence.id}
                  className={[isExpanded ? styles.open : "", cancelledLabel ? styles.struck : ""].filter(Boolean).join(" ") || undefined}
                >
                  <button
                    className={styles.rowHead}
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${fullSessionLabel}. ${tag.label}. ${playerCountLabel}.`}
                    onClick={() => openOccurrence(occurrence)}
                  >
                    <time className={styles.time} dateTime={occurrence.startsAt}>{formatAcademyTime(occurrence.startsAt)}</time>
                    <span className={styles.copy}>
                      <strong>{series.programme} · {series.batch}</strong>
                      <small>{occurrence.venue} · {playerCountLabel}</small>
                    </span>
                    <span className={styles.tag} data-tone={tag.tone}>{tag.label}</span>
                    <ChevronDown className={styles.chevron} aria-hidden="true" />
                  </button>
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
                          retained: "The session is still scheduled",
                          unconfirmed: "Check the connection, then reload the page to see whether the session was cancelled",
                          subject: "The cancellation",
                        })
                        setFeedback({
                          action: failure.signIn,
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
                          retained: "Your replacement details are still on screen",
                          subject: "The replacement session",
                        })
                        setFeedback({
                          action: failure.signIn,
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
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </SessionsShell>
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
  const replaceFormId = `occurrence-replace-${occurrence.id}`
  const [replaceOpen, setReplaceOpen] = useState(false)
  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined

  useEffect(() => {
    if (feedback?.tone !== "error") return
    if (feedback.field === "dateKey") dateInputRef.current?.focus()
    if (feedback.field === "startTime") timeInputRef.current?.focus()
    if (feedback.field === "durationMinutes") durationInputRef.current?.focus()
    if (feedback.field === "venue") venueInputRef.current?.focus()
  }, [feedback])

  return (
    <div className={styles.detail}>
      <span className={styles.label}>{occurrence.durationMinutes} minutes · {roster.length} {roster.length === 1 ? "player" : "players"}</span>
      {roster.length ? (
        <ul className={styles.roster} aria-label="Session roster">
          {roster.map((player) => (
            <li key={player.member.id}>
              <span className={styles.initials} aria-hidden="true">{player.member.initials}</span>
              {player.member.fullName}
            </li>
          ))}
        </ul>
      ) : <p className={styles.help}>No players were assigned to this occurrence.</p>}
      <InlineNotice
        action={feedback?.action}
        id={feedbackId}
        message={feedback?.message}
        tone={feedback?.tone}
        reserveSpace={false}
      />
      {!isFuture && occurrence.status === "scheduled" ? (
        <div className={styles.actions}>
          <Link
            className={styles.primary}
            href={`/coach/attendance/players/record?date=${encodeURIComponent(occurrence.occurrenceDate)}&occurrence=${encodeURIComponent(occurrence.id)}&from=calendar`}
          >
            Open attendance
          </Link>
        </div>
      ) : null}
      {!isFuture || occurrence.status === "cancelled" ? null : (
        <div className={styles.occurrenceActions}>
          <button
            className={styles.button}
            type="button"
            aria-controls={replaceFormId}
            aria-expanded={replaceOpen}
            disabled={pendingAction !== null}
            onClick={() => setReplaceOpen(!replaceOpen)}
          >Replace session</button>
          <button className={styles.danger} type="button" disabled={pendingAction !== null} onClick={onCancel}>
            {pendingAction === "cancel"
              ? "Cancelling…"
              : retryAction === "cancel" ? "Cancel session again" : "Cancel session"}
          </button>
          {replaceOpen ? (
            <form
              id={replaceFormId}
              className={styles.replace}
              onSubmit={(event) => {
                event.preventDefault()
                onReplace()
              }}
            >
              <label className={styles.field}><span>Date</span><input ref={dateInputRef} name="replacementDate" type="date" disabled={pendingAction !== null} min={today} value={replacement.dateKey} aria-invalid={feedback?.field === "dateKey" || undefined} aria-describedby={feedback?.field === "dateKey" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, dateKey: event.target.value })} /></label>
              <label className={styles.field}><span>Time</span><input ref={timeInputRef} name="replacementStartTime" type="time" disabled={pendingAction !== null} value={replacement.startTime} aria-invalid={feedback?.field === "startTime" || undefined} aria-describedby={feedback?.field === "startTime" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, startTime: event.target.value })} /></label>
              <label className={styles.field}><span>Minutes</span><input ref={durationInputRef} name="replacementDurationMinutes" type="number" disabled={pendingAction !== null} min={30} max={300} step={15} value={replacement.durationMinutes} aria-invalid={feedback?.field === "durationMinutes" || undefined} aria-describedby={feedback?.field === "durationMinutes" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, durationMinutes: event.target.value })} /></label>
              <label className={styles.field}><span>Venue</span><input ref={venueInputRef} name="replacementVenue" required maxLength={120} disabled={pendingAction !== null} value={replacement.venue} aria-invalid={feedback?.field === "venue" || undefined} aria-describedby={feedback?.field === "venue" ? feedbackId : undefined} onChange={(event) => setReplacement({ ...replacement, venue: event.target.value })} /></label>
              <button className={styles.primary} type="submit" disabled={pendingAction !== null}>
                {pendingAction === "replace"
                  ? "Creating…"
                  : retryAction === "replace" ? "Create replacement again" : "Create replacement"}
              </button>
            </form>
          ) : null}
        </div>
      )}
      <span className="sr-only">{occurrenceLabel(series, occurrence)}</span>
    </div>
  )
}

export function MonthGrid({
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
    <div className={styles.grid}>
      {/* Each cell's own name carries the full date, so the headings are not read. */}
      {weekdays.map((day) => (
        <span key={day.value} aria-hidden="true">{day.short[0]}<span className={styles.word}>{day.short.slice(1)}</span></span>
      ))}
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
         *
         * A live session on a closed day (left from before such moves were
         * refused) is shown, so the grid never disagrees with the day view.
         */
        const label = holiday
          ? `${formatDateKey(dateKey)}, closed for ${holiday.label}${count ? `, but ${count} ${count === 1 ? "session is" : "sessions are"} still scheduled` : ""}`
          : `${formatDateKey(dateKey)}, ${count} ${count === 1 ? "session" : "sessions"}`
        return (
          <button
            key={dateKey}
            type="button"
            className={styles.cell}
            data-holiday={holiday ? "" : undefined}
            aria-current={dateKey === today ? "date" : undefined}
            aria-label={label}
            aria-pressed={isSelected}
            onClick={() => onSelect(dateKey)}
          >
            <strong>{Number(dateKey.slice(-2))}</strong>
            {holiday
              ? <small>{holiday.label}{count ? ` · ${count}` : ""}</small>
              : count ? (
                <small>
                  {count}
                  {/* Its own element so a narrow screen can drop it. The
                      accessible name above carries the full "N sessions". */}
                  <span className={styles.word}> {count === 1 ? "session" : "sessions"}</span>
                </small>
              ) : null}
          </button>
        )
      })}
    </div>
  )
}
