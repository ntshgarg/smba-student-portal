"use client"

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  RotateCcw,
  X,
} from "lucide-react"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"

import { useCoachPortal } from "@/components/coach/coach-portal-provider"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type { AttendanceAdjustmentRecord } from "@/lib/attendance/adjustments"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  formatAcademyDate,
  formatAcademyTime,
  formatDateKey,
  formatSessionLabelFromInstant,
} from "@/lib/format"
import { calendarWindowForMonth, enumerateDateKeys } from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"

const MAX_REASON_LENGTH = 160

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function displayDate(dateKey: string) {
  return formatDateKey(dateKey, {
    day: "numeric",
    month: "short",
    weekday: "short",
    year: "numeric",
  })
}

function adjustmentTimestamp(value: Date | string) {
  return `${formatAcademyDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} · ${formatAcademyTime(value)}`
}

const calendarWeekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function displayMonth(monthKey: string) {
  return formatDateKey(`${monthKey}-01`, {
    day: undefined,
    month: "long",
    weekday: undefined,
    year: "numeric",
  })
}

export type AttendanceAdjustmentsWorkspaceHandle = {
  requestClose: () => boolean
}

type AttendanceAdjustmentsWorkspaceProps = {
  id?: string
  initialAdjustmentId?: string
  initialPlayerId?: string
  labelledBy?: string
}

type AdjustmentFeedback = ActionFeedback & {
  field?: string
}

export const AttendanceAdjustmentsWorkspace = forwardRef<
  AttendanceAdjustmentsWorkspaceHandle,
  AttendanceAdjustmentsWorkspaceProps
>(function AttendanceAdjustmentsWorkspace({
  id = "attendance-reschedule-panel",
  initialAdjustmentId,
  initialPlayerId,
  labelledBy = "reschedule-attendance-trigger",
}, ref) {
  const {
    attendanceAdjustments,
    attendanceRecords,
    players,
    publishAttendanceAdjustment,
    sessionOccurrences,
    sessionSeries,
    voidAttendanceAdjustment,
  } = useCoachPortal()
  const initialAdjustment = attendanceAdjustments.find((item) => item.id === initialAdjustmentId)
  const requestedInitialPlayerId = initialAdjustment?.playerId ?? initialPlayerId
  const validInitialPlayerId = players.some(
    (player) => player.member.id === requestedInitialPlayerId,
  ) ? requestedInitialPlayerId : undefined
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    validInitialPlayerId ?? "",
  )
  const [sourceOccurrenceId, setSourceOccurrenceId] = useState("")
  const [completedOn, setCompletedOn] = useState("")
  const [reason, setReason] = useState("")
  const [isReviewing, setIsReviewing] = useState(false)
  const [sourceMonth, setSourceMonth] = useState(() => getIndiaDateKey().slice(0, 7))
  const [selectedSourceDate, setSelectedSourceDate] = useState("")
  const [pendingAction, setPendingAction] = useState<"publish" | string | null>(null)
  const [feedback, setFeedback] = useState<AdjustmentFeedback | null>(null)
  const [expandedAdjustmentId, setExpandedAdjustmentId] = useState<string | null>(
    initialAdjustment?.id ?? null,
  )
  const [isHistoryOpen, setIsHistoryOpen] = useState(Boolean(initialAdjustment))
  const deepLinkedAdjustmentRef = useRef<HTMLButtonElement>(null)
  const hasFocusedDeepLinkRef = useRef(false)
  const playerSelectRef = useRef<HTMLSelectElement>(null)
  const sourceChoiceRef = useRef<HTMLFieldSetElement>(null)
  const completionChoiceRef = useRef<HTMLFieldSetElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const feedbackId = "attendance-adjustment-feedback"
  const [todayKey] = useState(() => getIndiaDateKey())
  const [referenceInstant] = useState(() => Date.now())
  const draftIsDirty = Boolean(sourceOccurrenceId || completedOn || reason.trim())
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: draftIsDirty,
    message: "Leave this adjustment and discard the draft?",
    scope: "coach-attendance-adjustment",
  })

  useImperativeHandle(ref, () => ({
    requestClose() {
      if (pendingAction !== null) {
        setFeedback({
          message: "Wait for the current attendance update to finish",
          tone: "info",
        })
        return false
      }
      if (draftIsDirty && !confirmDiscard(
        "Close reschedule attendance and discard this draft?",
      )) return false
      resetDraft()
      setFeedback(null)
      return true
    },
  }), [confirmDiscard, draftIsDirty, pendingAction])

  const seriesById = useMemo(
    () => new Map(sessionSeries.map((series) => [series.id, series])),
    [sessionSeries],
  )
  const occurrenceById = useMemo(
    () => new Map(sessionOccurrences.map((occurrence) => [occurrence.id, occurrence])),
    [sessionOccurrences],
  )
  const playerById = useMemo(
    () => new Map(players.map((player) => [player.member.id, player])),
    [players],
  )
  const activeAdjustments = useMemo(
    () => attendanceAdjustments.filter((item) => !item.voidedAt),
    [attendanceAdjustments],
  )
  const adjustedSourceIds = useMemo(
    () => new Set(activeAdjustments.map((item) => item.sourceOccurrenceId)),
    [activeAdjustments],
  )
  const sourceOptions = useMemo(() => {
    if (!selectedPlayerId) return []

    return sessionOccurrences
      .filter((occurrence) => (
        occurrence.status === "scheduled"
        && attendanceRecords[occurrence.id]?.[selectedPlayerId] === "absent"
        && !adjustedSourceIds.has(occurrence.id)
        && occurrence.occurrenceDate <= todayKey
        && !occurrenceIsUpcoming(occurrence, referenceInstant)
      ))
      .sort((first, second) => (
        second.startsAt.localeCompare(first.startsAt)
        || first.id.localeCompare(second.id)
      ))
  }, [
    adjustedSourceIds,
    attendanceRecords,
    referenceInstant,
    selectedPlayerId,
    sessionOccurrences,
    todayKey,
  ])
  const sourceOccurrence = sourceOccurrenceId
    ? occurrenceById.get(sourceOccurrenceId)
    : undefined
  const sourceOptionsByDate = useMemo(() => {
    const grouped = new Map<string, typeof sourceOptions>()
    sourceOptions.forEach((occurrence) => {
      const group = grouped.get(occurrence.occurrenceDate) ?? []
      group.push(occurrence)
      grouped.set(occurrence.occurrenceDate, group)
    })
    grouped.forEach((group) => group.sort((first, second) => (
      first.startsAt.localeCompare(second.startsAt)
      || first.id.localeCompare(second.id)
    )))
    return grouped
  }, [sourceOptions])
  const sourceMonths = useMemo(() => (
    [...new Set(sourceOptions.map((occurrence) => occurrence.occurrenceDate.slice(0, 7)))].sort()
  ), [sourceOptions])
  const effectiveSourceMonth = sourceMonths.includes(sourceMonth)
    ? sourceMonth
    : sourceMonths.at(-1) ?? sourceMonth
  const sourceMonthIndex = sourceMonths.indexOf(effectiveSourceMonth)
  const sourceCalendarWindow = useMemo(
    () => calendarWindowForMonth(effectiveSourceMonth),
    [effectiveSourceMonth],
  )
  const sourceCalendarDates = useMemo(
    () => enumerateDateKeys(sourceCalendarWindow.from, sourceCalendarWindow.to),
    [sourceCalendarWindow],
  )
  const sourceCalendarLeadingDays = (
    new Date(`${sourceCalendarWindow.from}T00:00:00.000Z`).getUTCDay() + 6
  ) % 7
  const activeSourceDate = selectedSourceDate || sourceOccurrence?.occurrenceDate || ""
  const selectedSourceDateOptions = activeSourceDate
    ? sourceOptionsByDate.get(activeSourceDate) ?? []
    : []
  const completionOptions = useMemo(() => {
    if (!sourceOccurrence) return []
    const min = shiftDateKey(sourceOccurrence.occurrenceDate, 1)
    const max = [shiftDateKey(sourceOccurrence.occurrenceDate, 14), todayKey].sort()[0]

    return [...new Set(sessionOccurrences
      .filter((occurrence) => (
        occurrence.status === "scheduled"
        && occurrence.occurrenceDate >= min
        && occurrence.occurrenceDate <= max
        && !occurrenceIsUpcoming(occurrence, referenceInstant)
      ))
      .map((occurrence) => occurrence.occurrenceDate))]
      .sort()
  }, [referenceInstant, sessionOccurrences, sourceOccurrence, todayKey])
  const selectedPlayer = selectedPlayerId ? playerById.get(selectedPlayerId) : undefined
  const history = [...attendanceAdjustments]
    .filter((item) => !selectedPlayerId || item.playerId === selectedPlayerId)
    .sort((first, second) => (
      new Date(second.publishedAt).getTime() - new Date(first.publishedAt).getTime()
    ))

  useEffect(() => {
    if (!initialAdjustment || !isHistoryOpen || hasFocusedDeepLinkRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const target = deepLinkedAdjustmentRef.current
      if (!target) return
      hasFocusedDeepLinkRef.current = true
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: "nearest", behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialAdjustment, isHistoryOpen])

  useEffect(() => {
    if (feedback?.tone !== "error" || !feedback.field) return
    if (feedback.field === "playerId") playerSelectRef.current?.focus()
    if (feedback.field === "sourceOccurrenceId") {
      const sourceTarget = sourceChoiceRef.current
        ?.querySelector<HTMLButtonElement>("button[aria-pressed='true'], button:not(:disabled)")
      const target = sourceTarget ?? playerSelectRef.current
      target?.focus()
    }
    if (feedback.field === "completedOn") {
      completionChoiceRef.current
        ?.querySelector<HTMLButtonElement>("button[aria-pressed='true'], button:not(:disabled)")
        ?.focus()
    }
    if (feedback.field === "reason") reasonRef.current?.focus()
  }, [feedback])

  function sessionLabel(occurrenceId: string) {
    const occurrence = occurrenceById.get(occurrenceId)
    const series = occurrence ? seriesById.get(occurrence.seriesId) : undefined
    if (!occurrence || !series) return "Scheduled training session"
    return formatSessionLabelFromInstant({
      batch: series.batch,
      durationMinutes: occurrence.durationMinutes,
      programme: series.programme,
      startsAt: occurrence.startsAt,
    })
  }

  function resetDraft() {
    setSourceOccurrenceId("")
    setCompletedOn("")
    setReason("")
    setIsReviewing(false)
    setSelectedSourceDate("")
  }

  function choosePlayer(playerId: string) {
    if (playerId === selectedPlayerId) return
    if (draftIsDirty && !confirmDiscard("Change player and discard this adjustment draft?")) return
    resetDraft()
    setSelectedPlayerId(playerId)
    setFeedback(null)
  }

  function chooseSource(occurrenceId: string) {
    const occurrence = occurrenceById.get(occurrenceId)
    setSourceOccurrenceId(occurrenceId)
    setSelectedSourceDate(occurrence?.occurrenceDate ?? "")
    setCompletedOn("")
    setReason("")
    setIsReviewing(false)
    setFeedback(null)
  }

  function clearSourceSelection() {
    setSourceOccurrenceId("")
    setSelectedSourceDate("")
    setCompletedOn("")
    setReason("")
    setIsReviewing(false)
    setFeedback(null)
  }

  function chooseSourceMonth(monthKey: string) {
    if (monthKey === effectiveSourceMonth) return
    if (draftIsDirty && !confirmDiscard(
      "Change month and discard this attendance adjustment draft?",
    )) return
    resetDraft()
    setSourceMonth(monthKey)
    setFeedback(null)
  }

  function chooseSourceDate(dateKey: string) {
    const occurrences = sourceOptionsByDate.get(dateKey) ?? []
    if (!occurrences.length) return

    if (dateKey === activeSourceDate) {
      clearSourceSelection()
      return
    }

    setSelectedSourceDate(dateKey)
    setFeedback(null)
    if (occurrences.length === 1) {
      chooseSource(occurrences[0].id)
      return
    }

    if (!occurrences.some((occurrence) => occurrence.id === sourceOccurrenceId)) {
      setSourceOccurrenceId("")
      setCompletedOn("")
      setReason("")
      setIsReviewing(false)
    }
  }

  function cancelDraft() {
    if (draftIsDirty && !confirmDiscard("Cancel this adjustment draft?")) return
    resetDraft()
    setFeedback(null)
  }

  async function publishAdjustment() {
    if (!selectedPlayerId || !sourceOccurrenceId || !completedOn || pendingAction) return
    setPendingAction("publish")
    setFeedback(null)
    try {
      const result = await publishAttendanceAdjustment({
        completedOn,
        playerId: selectedPlayerId,
        reason,
        sourceOccurrenceId,
      })
      if (!result.ok) {
        if (result.field) setIsReviewing(false)
        setFeedback({ field: result.field, message: result.message, tone: "error" })
        return
      }
      const published = result.data
      resetDraft()
      setIsHistoryOpen(true)
      setExpandedAdjustmentId(published.id)
      setFeedback({ message: "Attendance rescheduled", tone: "success" })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The adjustment could not be published",
        tone: "error",
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function voidAdjustment(adjustment: AttendanceAdjustmentRecord) {
    const player = playerById.get(adjustment.playerId)
    const confirmed = window.confirm(
      `Void this make-up adjustment${player ? ` for ${player.member.fullName}` : ""}? The original absence will be restored.`,
    )
    if (!confirmed) return

    setPendingAction(adjustment.id)
    setFeedback(null)
    try {
      const result = await voidAttendanceAdjustment(adjustment.id)
      if (!result.ok) {
        setFeedback({ field: result.field, message: result.message, tone: "error" })
        return
      }
      setFeedback({ message: "Adjustment voided and original absence restored", tone: "success" })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The adjustment could not be voided",
        tone: "error",
      })
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div
      className="coach-adjustments-workspace"
      id={id}
      role="region"
      aria-labelledby={labelledBy}
    >
      <div className="coach-adjustments-grid">
        <section className="coach-adjustment-editor" aria-labelledby="makeup-editor-title">
          <div className="coach-adjustment-editor-heading">
            <div>
              <span>{isReviewing ? "Review adjustment" : "New adjustment"}</span>
              <h2 className="sr-only" id="makeup-editor-title">New attendance adjustment</h2>
            </div>
          </div>

          {feedback ? (
            <InlineNotice
              className="coach-adjustments-notice"
              id={feedbackId}
              message={feedback.message}
              reserveSpace={false}
              tone={feedback.tone}
            />
          ) : null}

          {!isReviewing ? (
            <div className="coach-adjustment-form">
              <label className="coach-adjustment-field">
                <span><strong>Player</strong><small>1 of 3</small></span>
                <select
                  ref={playerSelectRef}
                  value={selectedPlayerId}
                  aria-invalid={feedback?.field === "playerId" || undefined}
                  aria-describedby={feedback?.field === "playerId" ? feedbackId : undefined}
                  onChange={(event) => choosePlayer(event.target.value)}
                >
                  <option value="">Choose a player</option>
                  {players.map((player) => (
                    <option key={player.member.id} value={player.member.id}>
                      {player.member.fullName}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPlayer ? (
                <fieldset ref={sourceChoiceRef} className="coach-adjustment-choice-group" aria-invalid={feedback?.field === "sourceOccurrenceId" || undefined} aria-describedby={feedback?.field === "sourceOccurrenceId" ? feedbackId : undefined}>
                  <legend><strong>Missed session</strong><small>2 of 3</small></legend>
                  {sourceOptions.length ? (
                    <div className="coach-adjustment-missed-session-picker">
                      <div className="coach-adjustment-missed-calendar">
                        <div className="coach-adjustment-missed-calendar-toolbar">
                          <button
                            type="button"
                            aria-label="Show previous month with missed sessions"
                            disabled={sourceMonthIndex <= 0}
                            onClick={() => chooseSourceMonth(sourceMonths[sourceMonthIndex - 1])}
                          >
                            <ChevronLeft aria-hidden="true" />
                          </button>
                          <label>
                            <span className="sr-only">Choose missed-session month</span>
                            <select
                              aria-label="Choose missed-session month"
                              value={effectiveSourceMonth}
                              onChange={(event) => chooseSourceMonth(event.target.value)}
                            >
                              {sourceMonths.map((monthKey) => (
                                <option key={monthKey} value={monthKey}>{displayMonth(monthKey)}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            aria-label="Show next month with missed sessions"
                            disabled={sourceMonthIndex < 0 || sourceMonthIndex >= sourceMonths.length - 1}
                            onClick={() => chooseSourceMonth(sourceMonths[sourceMonthIndex + 1])}
                          >
                            <ChevronRight aria-hidden="true" />
                          </button>
                        </div>

                        <p className="coach-adjustment-missed-calendar-key">
                          <span aria-hidden="true" /> Missed session
                        </p>

                        <div
                          className="coach-adjustment-missed-calendar-grid"
                          aria-label={`Missed sessions in ${displayMonth(effectiveSourceMonth)}`}
                        >
                          {calendarWeekdays.map((weekday) => (
                            <span className="is-weekday" key={weekday}>{weekday}</span>
                          ))}
                          {Array.from({ length: sourceCalendarLeadingDays }, (_, index) => (
                            <i key={`missed-calendar-empty-${index}`} aria-hidden="true" />
                          ))}
                          {sourceCalendarDates.map((dateKey) => {
                            const dateOptions = sourceOptionsByDate.get(dateKey) ?? []
                            const isSelected = dateKey === activeSourceDate
                            const day = Number(dateKey.slice(-2))

                            if (!dateOptions.length) {
                              return <span className="is-date is-clear" key={dateKey} aria-hidden="true">{day}</span>
                            }

                            return (
                              <button
                                key={dateKey}
                                type="button"
                                className={isSelected ? "is-selected" : undefined}
                                aria-current={dateKey === todayKey ? "date" : undefined}
                                aria-label={`${isSelected ? "Deselect" : "Select"} ${displayDate(dateKey)}, ${dateOptions.length} missed ${dateOptions.length === 1 ? "session" : "sessions"}`}
                                aria-pressed={isSelected}
                                onClick={() => chooseSourceDate(dateKey)}
                              >
                                {day}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {selectedSourceDateOptions.length > 1 ? (
                        <div className="coach-adjustment-choice-list is-source-slots">
                          <p>
                            <strong>{displayDate(activeSourceDate)}</strong>
                            <small>Choose the exact missed session</small>
                          </p>
                          {selectedSourceDateOptions.map((occurrence) => (
                            <button
                              key={occurrence.id}
                              type="button"
                              className={occurrence.id === sourceOccurrenceId ? "is-active" : undefined}
                              aria-pressed={occurrence.id === sourceOccurrenceId}
                              onClick={() => chooseSource(occurrence.id)}
                            >
                              <span>
                                <strong>{sessionLabel(occurrence.id)}</strong>
                                <small>{occurrence.venue}</small>
                              </span>
                              {occurrence.id === sourceOccurrenceId
                                ? <Check aria-hidden="true" />
                                : <ArrowRight aria-hidden="true" />}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="coach-adjustment-empty-step">
                      <CalendarDays aria-hidden="true" />
                      <p>{selectedPlayer.member.fullName} has no unreconciled absences.</p>
                    </div>
                  )}
                </fieldset>
              ) : null}

              {sourceOccurrence ? (
                <fieldset ref={completionChoiceRef} className="coach-adjustment-choice-group" aria-invalid={feedback?.field === "completedOn" || undefined} aria-describedby={feedback?.field === "completedOn" ? feedbackId : undefined}>
                  <legend><strong>Completed on</strong><small>3 of 3</small></legend>
                  <p className="coach-adjustment-helper">
                    Choose the academy training date when the make-up was completed.
                  </p>
                  {completionOptions.length ? (
                    <div className="coach-adjustment-date-grid">
                      {completionOptions.map((dateKey) => (
                        <button
                          key={dateKey}
                          type="button"
                          className={dateKey === completedOn ? "is-active" : undefined}
                          aria-pressed={dateKey === completedOn}
                          onClick={() => {
                            setCompletedOn(dateKey)
                            setFeedback(null)
                          }}
                        >
                          <span>{formatDateKey(dateKey, { day: undefined, month: undefined, weekday: "short" })}</span>
                          <strong>{formatDateKey(dateKey, { day: "numeric", month: "short", weekday: undefined })}</strong>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="coach-adjustment-empty-step is-warning">
                      <CircleAlert aria-hidden="true" />
                      <p>No eligible academy training dates are available in the 14-day window.</p>
                    </div>
                  )}

                  <label className="coach-adjustment-reason">
                    <span><strong>Reason</strong><small>Optional</small></span>
                    <input
                      ref={reasonRef}
                      type="text"
                      maxLength={MAX_REASON_LENGTH}
                      value={reason}
                      placeholder="For example, school examination"
                      aria-invalid={feedback?.field === "reason" || undefined}
                      aria-describedby={feedback?.field === "reason" ? feedbackId : undefined}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <small>{reason.length}/{MAX_REASON_LENGTH}</small>
                  </label>
                </fieldset>
              ) : null}

              {sourceOccurrence ? (
                <div className="coach-adjustment-draft-actions">
                  <button className="is-quiet" type="button" onClick={cancelDraft}>
                    <X aria-hidden="true" /> Cancel draft
                  </button>
                  <button
                    className="is-primary"
                    type="button"
                    disabled={!completedOn}
                    onClick={() => setIsReviewing(true)}
                  >
                    Review adjustment <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : sourceOccurrence && selectedPlayer ? (
            <div className="coach-adjustment-review">
              <div className="coach-adjustment-transfer" aria-label="Attendance adjustment summary">
                <div>
                  <span>Missed session</span>
                  <strong>{displayDate(sourceOccurrence.occurrenceDate)}</strong>
                  <small>{sessionLabel(sourceOccurrence.id)}</small>
                </div>
                <ArrowRight aria-hidden="true" />
                <div>
                  <span>Make-up completed</span>
                  <strong>{displayDate(completedOn)}</strong>
                  <small>Academy training day</small>
                </div>
              </div>

              {reason.trim() ? (
                <div className="coach-adjustment-review-reason">
                  <span>Reason</span>
                  <p>{reason.trim()}</p>
                </div>
              ) : null}

              <div className="coach-adjustment-impact">
                <Check aria-hidden="true" />
                <p><strong>Ready to reschedule attendance.</strong> Publish to confirm this adjustment.</p>
              </div>

              <div className="coach-adjustment-draft-actions">
                <button className="is-quiet" type="button" disabled={pendingAction !== null} onClick={() => setIsReviewing(false)}>
                  <ArrowLeft aria-hidden="true" /> Edit draft
                </button>
                <button className="is-primary" type="button" disabled={pendingAction !== null} onClick={() => void publishAdjustment()}>
                  <Check aria-hidden="true" /> {pendingAction === "publish" ? "Publishing…" : "Publish make-up"}
                </button>
              </div>
            </div>
          ) : null}
        </section>

      </div>

      <section className="coach-adjustment-history">
        <button
          className="coach-adjustment-history-disclosure"
          type="button"
          aria-expanded={isHistoryOpen}
          aria-controls="attendance-adjustment-history"
          onClick={() => setIsHistoryOpen((current) => !current)}
        >
          <span>
            <strong>Previous reschedules ({history.length})</strong>
            <small>
              {selectedPlayer
                ? `Published record for ${selectedPlayer.member.fullName}`
                : "Published attendance record"}
            </small>
          </span>
          <ChevronDown aria-hidden="true" />
        </button>

        {isHistoryOpen ? (
          <div id="attendance-adjustment-history">
            {history.length ? (
              <div className="coach-adjustment-history-list">
                {history.map((adjustment) => {
                  const player = playerById.get(adjustment.playerId)
                  const source = occurrenceById.get(adjustment.sourceOccurrenceId)
                  const resolvedOccurrence = adjustment.completionOccurrenceId
                    ? occurrenceById.get(adjustment.completionOccurrenceId)
                    : undefined
                  const isVoided = Boolean(adjustment.voidedAt)
                  const requiresReview = Boolean(adjustment.reviewRequiredAt) && !isVoided
                  const isExpanded = adjustment.id === expandedAdjustmentId

                  return (
                    <article
                      key={adjustment.id}
                      className={[
                        "coach-adjustment-history-item",
                        isVoided ? "is-voided" : "",
                        requiresReview ? "requires-review" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      <button
                        ref={adjustment.id === initialAdjustment?.id
                          ? deepLinkedAdjustmentRef
                          : undefined}
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`adjustment-details-${adjustment.id}`}
                        onClick={() => setExpandedAdjustmentId(isExpanded ? null : adjustment.id)}
                      >
                        <span className="coach-adjustment-history-mark" aria-hidden="true">
                          {isVoided ? <RotateCcw /> : requiresReview ? <CircleAlert /> : <Check />}
                        </span>
                        <span>
                          <strong>{player?.member.fullName ?? "Player"}</strong>
                          <small>
                            {source ? displayDate(source.occurrenceDate) : "Missed session"}
                            {" → "}{displayDate(adjustment.completedOn)}
                          </small>
                        </span>
                        <em>{isVoided ? "Voided" : requiresReview ? "Requires review" : "Published"}</em>
                        <ChevronDown aria-hidden="true" />
                      </button>

                      {isExpanded ? (
                        <div id={`adjustment-details-${adjustment.id}`} className="coach-adjustment-history-details">
                          {requiresReview ? (
                            <div className="coach-adjustment-review-warning">
                              <CircleAlert aria-hidden="true" />
                              <p><strong>This adjustment requires review.</strong> Check the ordinary attendance recorded on its completion date.</p>
                            </div>
                          ) : null}
                          <dl>
                            <div><dt>Missed session</dt><dd>{source ? displayDate(source.occurrenceDate) : "Unavailable"}</dd></div>
                            <div><dt>Completed on</dt><dd>{displayDate(adjustment.completedOn)}</dd></div>
                            <div><dt>Published</dt><dd>{adjustmentTimestamp(adjustment.publishedAt)}</dd></div>
                            <div><dt>Traceability</dt><dd>{resolvedOccurrence ? sessionLabel(resolvedOccurrence.id) : "Date-level record"}</dd></div>
                            {adjustment.reason ? <div className="is-wide"><dt>Reason</dt><dd>{adjustment.reason}</dd></div> : null}
                          </dl>
                          {!isVoided ? (
                            <div className="coach-adjustment-history-actions">
                              <button type="button" disabled={pendingAction !== null} onClick={() => void voidAdjustment(adjustment)}>
                                <RotateCcw aria-hidden="true" /> {pendingAction === adjustment.id ? "Voiding…" : "Void adjustment"}
                              </button>
                            </div>
                          ) : (
                            <p className="coach-adjustment-voided-note">
                              Voided {adjustment.voidedAt ? adjustmentTimestamp(adjustment.voidedAt) : ""}. The original absence remains in the register.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="coach-adjustment-history-empty">
                <CalendarDays aria-hidden="true" />
                <h3>No reschedules published.</h3>
                <p>Completed make-up attendance will become part of this audit record.</p>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
})
