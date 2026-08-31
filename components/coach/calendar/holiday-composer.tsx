"use client"

import { CalendarOff, CircleAlert, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useSessionPortal } from "@/components/coach/coach-portal-provider"
import { InlineNotice } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatReportMonth } from "@/lib/coach/report-utils"
import { formatDateKey } from "@/lib/format"
import type { HolidayImpact } from "@/lib/sessions/holidays"

const MAX_DATES = 31

type Feedback = { message: string; tone: "error" | "info" | "success" }

/**
 * Every date from `from` to `to` inclusive. A closure is declared over calendar
 * days, not training days -- the academy is shut on the Sunday in the middle of
 * a Diwali block too, even though nothing was scheduled then. Dates with no
 * sessions simply cancel nothing.
 */
export function expandDateRange(from: string, to: string): string[] {
  if (!from || !to || to < from) return []
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  const last = new Date(`${to}T00:00:00.000Z`)
  while (cursor.getTime() <= last.getTime() && dates.length <= MAX_DATES) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function pluralSessions(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`
}

export function HolidayComposer({
  onClose,
  selectedDate,
  today,
}: {
  onClose: () => void
  selectedDate: string
  today: string
}) {
  const { markAcademyHolidays, previewAcademyHolidays } = useSessionPortal()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLInputElement>(null)
  const [from, setFrom] = useState(selectedDate)
  const [to, setTo] = useState(selectedDate)
  const [label, setLabel] = useState("")
  const [impact, setImpact] = useState<HolidayImpact | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow

    if (dialog && !dialog.open) dialog.showModal()
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog?.open) dialog.close()
      previouslyFocused?.focus()
    }
  }, [])

  const dates = expandDateRange(from, to)
  const rangeTooLong = dates.length > MAX_DATES
  const rangeInvalid = !from || !to || to < from

  // Any edit invalidates the checked impact, so the confirm button can never
  // apply a closure the coach has not seen the consequences of.
  function editRange(next: { from?: string; to?: string }) {
    if (next.from !== undefined) {
      setFrom(next.from)
      if (to < next.from) setTo(next.from)
    }
    if (next.to !== undefined) setTo(next.to)
    setImpact(null)
    setFeedback(null)
  }

  async function check() {
    if (busy || rangeInvalid || rangeTooLong) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await previewAcademyHolidays(dates)
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        return
      }
      setImpact(result.data)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The closure could not be checked",
        retained: "Your dates are still on screen",
        subject: "The check",
      })
      setFeedback({ message: failure.message, tone: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (busy || !impact) return
    if (!label.trim()) {
      setFeedback({ message: "Name the holiday so the register can show it.", tone: "error" })
      labelRef.current?.focus()
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const result = await markAcademyHolidays({ dateKeys: dates, label })
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        return
      }
      onClose()
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The academy could not be closed",
        retained: "Your dates and holiday name are still on screen",
        subject: "The closure",
      })
      setFeedback({ message: failure.message, tone: "error" })
    } finally {
      setBusy(false)
    }
  }

  const closingPast = impact?.dates.some(
    (date) => date.dateKey < today || date.startedSessions > 0,
  ) ?? false
  // Pluralised on the number of DAYS being closed, not on the number of marks
  // or make-ups found. Twenty-four marks on one day is still "this day".
  const dayWord = impact && impact.totals.datesToClose === 1 ? "this day" : "these days"
  const warnings = impact
    ? [
      impact.totals.attendanceMarks > 0 && {
        key: "attendance",
        title: `Attendance is already recorded on ${dayWord}`,
        body: `${impact.totals.attendanceMarks} mark${impact.totals.attendanceMarks === 1 ? "" : "s"} across ${impact.totals.attendancePlayers} player${impact.totals.attendancePlayers === 1 ? "" : "s"} will stop counting towards attendance. The marks are kept, so removing the holiday restores them.`,
      },
      impact.totals.makeUpCompletions > 0 && {
        key: "makeups",
        title: `${impact.totals.makeUpCompletions} make-up session${impact.totals.makeUpCompletions === 1 ? " was" : "s were"} completed on ${dayWord}`,
        body: "Those players are still credited for the session they originally missed. Each will be flagged for review on the Attendance adjustments screen so you can decide.",
      },
      impact.publishedReportMonths.length > 0 && {
        key: "reports",
        title: `Reports are already published for ${impact.publishedReportMonths.map(formatReportMonth).join(", ")}`,
        body: "Published reports keep the attendance figures they were sent with, so a parent's copy will not change. The register and the calendar will.",
      },
    ].filter((warning): warning is { key: string; title: string; body: string } => Boolean(warning))
    : []

  return (
    <dialog
      ref={dialogRef}
      className="coach-holiday-backdrop"
      aria-labelledby="holiday-composer-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="coach-holiday-panel" onMouseDown={(event) => event.stopPropagation()}>
        <button
          ref={closeButtonRef}
          className="coach-holiday-close"
          type="button"
          onClick={onClose}
          aria-label="Close holiday panel"
        >
          <X aria-hidden="true" />
        </button>

        <header className="coach-holiday-heading">
          <span className="eyebrow">Close the academy</span>
          <h2 id="holiday-composer-title">Mark a holiday</h2>
          <p>
            Every session on the chosen dates is cancelled at once. Those days leave the
            attendance count entirely, so nobody is marked absent and no percentage moves.
            Monthly fees do not change.
          </p>
        </header>

        <div className="coach-holiday-fields">
          <label>
            <span>First day</span>
            <input
              name="holidayFrom"
              type="date"
              value={from}
              disabled={busy}
              onChange={(event) => editRange({ from: event.target.value })}
            />
          </label>
          <label>
            <span>Last day</span>
            <input
              name="holidayTo"
              type="date"
              value={to}
              min={from}
              disabled={busy}
              onChange={(event) => editRange({ to: event.target.value })}
            />
          </label>
          <label>
            <span>Holiday name</span>
            <input
              ref={labelRef}
              name="holidayLabel"
              value={label}
              maxLength={60}
              placeholder="Diwali"
              disabled={busy}
              onChange={(event) => {
                setLabel(event.target.value)
                setFeedback(null)
              }}
            />
          </label>
        </div>

        {rangeInvalid ? (
          <p className="coach-holiday-hint">Choose a last day on or after the first day.</p>
        ) : rangeTooLong ? (
          <p className="coach-holiday-hint">Close at most {MAX_DATES} days at a time.</p>
        ) : (
          <p className="coach-holiday-hint">
            {dates.length === 1
              ? formatDateKey(dates[0], { year: "numeric" })
              : `${dates.length} days, ${formatDateKey(dates[0])} to ${formatDateKey(dates[dates.length - 1], { year: "numeric" })}`}
          </p>
        )}

        {impact ? (
          <div className="coach-holiday-impact">
            <h3>
              {impact.totals.datesToClose === 0
                ? "Nothing left to close"
                : `Closing ${impact.totals.datesToClose} day${impact.totals.datesToClose === 1 ? "" : "s"} cancels ${pluralSessions(impact.totals.scheduledSessions)}`}
            </h3>
            {impact.totals.datesAlreadyClosed > 0 ? (
              <p className="coach-holiday-note">
                {impact.totals.datesAlreadyClosed} of these days {impact.totals.datesAlreadyClosed === 1 ? "is" : "are"} already
                a holiday and will be left as {impact.totals.datesAlreadyClosed === 1 ? "it is" : "they are"}.
              </p>
            ) : null}
            {closingPast ? (
              <p className="coach-holiday-note">
                This closure covers sessions that have already run. That is allowed, and it
                is why the checks below matter.
              </p>
            ) : null}

            {warnings.length ? (
              <ul className="coach-holiday-warnings">
                {warnings.map((warning) => (
                  <li key={warning.key}>
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <strong>{warning.title}</strong>
                      <p>{warning.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : impact.totals.datesToClose > 0 ? (
              <p className="coach-holiday-note">
                No attendance has been recorded on {dayWord}, so nothing is being undone.
              </p>
            ) : null}

            <ul className="coach-holiday-dates">
              {impact.dates.map((date) => (
                <li key={date.dateKey}>
                  <span>{formatDateKey(date.dateKey)}</span>
                  <strong>
                    {date.existingHolidayLabel
                      ? `Already a holiday — ${date.existingHolidayLabel}`
                      : date.scheduledSessions
                        ? pluralSessions(date.scheduledSessions)
                        : "No sessions"}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />

        <div className="coach-holiday-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          {impact ? (
            <button
              className="coach-holiday-confirm"
              type="button"
              onClick={() => void confirm()}
              disabled={busy || impact.totals.datesToClose === 0}
            >
              <CalendarOff aria-hidden="true" />
              {busy ? "Closing…" : "Close the academy"}
            </button>
          ) : (
            <button
              className="coach-holiday-confirm"
              type="button"
              onClick={() => void check()}
              disabled={busy || rangeInvalid || rangeTooLong}
            >
              {busy ? "Checking…" : "Check what this closes"}
            </button>
          )}
        </div>
      </section>
    </dialog>
  )
}
