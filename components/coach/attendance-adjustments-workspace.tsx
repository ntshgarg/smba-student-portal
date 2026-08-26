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
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  useAttendancePortal,
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type { AttendanceAdjustmentRecord } from "@/lib/attendance/adjustments"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  formatAcademyDate,
  formatAcademyTime,
  formatDateKey,
  formatSessionLabelFromInstant,
} from "@/lib/format"
import {
  assignmentCoversOccurrence,
  calendarWindowForMonth,
  enumerateDateKeys,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
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
  initialHistoryOpen?: boolean
  initialPlayerId?: string
  labelledBy?: string
}

/**
 * Publishing a reschedule and voiding any history row share one notice, so
 * `retryAction` mirrors `pendingAction` to name which control offers the retry.
 */
type AdjustmentFeedback = ActionFeedback & {
  field?: string
  offerRetry?: boolean
  retryAction?: string
}

export const AttendanceAdjustmentsWorkspace = forwardRef<
  AttendanceAdjustmentsWorkspaceHandle,
  AttendanceAdjustmentsWorkspaceProps
>(function AttendanceAdjustmentsWorkspace({
  id = "attendance-reschedule-panel",
  initialAdjustmentId,
  initialHistoryOpen = false,
  initialPlayerId,
  labelledBy = "reschedule-attendance-trigger",
}, ref) {
  const { players } = useMemberPortal()
  const {
    attendanceAdjustments,
    attendanceRecords,
    publishAttendanceAdjustment,
    voidAttendanceAdjustment,
  } = useAttendancePortal()
  const {
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useSessionPortal()
  const router = useRouter()
  const initialAdjustment = attendanceAdjustments.find((item) => item.id === initialAdjustmentId)
  const requestedInitialPlayerId = initialAdjustment?.playerId ?? initialPlayerId
  const validInitialPlayerId = players.some(
    (player) => player.member.id === requestedInitialPlayerId,
  ) ? requestedInitialPlayerId : undefined
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    validInitialPlayerId ?? "",
  )
  const [sourceOccurrenceId, setSourceOccurrenceId] = useState("")
  const [completionOccurrenceId, setCompletionOccurrenceId] = useState("")
  const [reason, setReason] = useState("")
  const [isReviewing, setIsReviewing] = useState(false)
  const [sourceMonth, setSourceMonth] = useState(() => getIndiaDateKey().slice(0, 7))
  const [selectedSourceDate, setSelectedSourceDate] = useState("")
  const [pendingAction, setPendingAction] = useState<"publish" | string | null>(null)
  const [feedback, setFeedback] = useState<AdjustmentFeedback | null>(null)
  const [expandedAdjustmentId, setExpandedAdjustmentId] = useState<string | null>(
    initialAdjustment?.id ?? null,
  )
  const [isHistoryOpen, setIsHistoryOpen] = useState(
    initialHistoryOpen || Boolean(initialAdjustment),
  )
  const deepLinkedAdjustmentRef = useRef<HTMLButtonElement>(null)
  const hasFocusedDeepLinkRef = useRef(false)
  const playerSelectRef = useRef<HTMLSelectElement>(null)
  const sourceChoiceRef = useRef<HTMLFieldSetElement>(null)
  const completionChoiceRef = useRef<HTMLFieldSetElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const feedbackId = "attendance-adjustment-feedback"
  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined
  const [todayKey] = useState(() => getIndiaDateKey())
  const [referenceInstant] = useState(() => Date.now())
  const draftIsDirty = Boolean(sourceOccurrenceId || completionOccurrenceId || reason.trim())
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
  const selectedPlayer = selectedPlayerId ? playerById.get(selectedPlayerId) : undefined
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
  const sourceCalendarTrailingDays = (
    7 - ((sourceCalendarLeadingDays + sourceCalendarDates.length) % 7)
  ) % 7
  const activeSourceDate = selectedSourceDate || sourceOccurrence?.occurrenceDate || ""
  const selectedSourceDateOptions = activeSourceDate
    ? sourceOptionsByDate.get(activeSourceDate) ?? []
    : []
  const completionOptions = useMemo(() => {
    if (!sourceOccurrence || !selectedPlayer) return []
    const min = shiftDateKey(sourceOccurrence.occurrenceDate, 1)
    const max = [shiftDateKey(sourceOccurrence.occurrenceDate, 14), todayKey].sort()[0]
    const playerAssignments = sessionAssignments.filter(
      (assignment) => assignment.playerId === selectedPlayerId,
    )
    const usedCompletionIds = new Set(activeAdjustments
      .filter((adjustment) => adjustment.playerId === selectedPlayerId)
      .flatMap((adjustment) => adjustment.completionOccurrenceId
        ? [adjustment.completionOccurrenceId]
        : []))
    const legacyCompletionDates = new Set(activeAdjustments
      .filter((adjustment) => (
        adjustment.playerId === selectedPlayerId
        && !adjustment.completionOccurrenceId
      ))
      .map((adjustment) => adjustment.completedOn))

    return sessionOccurrences
      .filter((occurrence) => (
        occurrence.status === "scheduled"
        && occurrence.occurrenceDate >= min
        && occurrence.occurrenceDate <= max
        && !occurrenceIsUpcoming(occurrence, referenceInstant)
        && attendanceRecords[occurrence.id]?.[selectedPlayerId] === "present"
        && !usedCompletionIds.has(occurrence.id)
        && !legacyCompletionDates.has(occurrence.occurrenceDate)
        && playerWasEnrolledForOccurrence(selectedPlayer.member.trainingStartOn, occurrence)
        && playerAssignments.some((assignment) => (
          assignmentCoversOccurrence(assignment, occurrence)
        ))
      ))
      .sort((first, second) => (
        first.startsAt.localeCompare(second.startsAt)
        || first.id.localeCompare(second.id)
      ))
  }, [
    activeAdjustments,
    attendanceRecords,
    referenceInstant,
    selectedPlayer,
    selectedPlayerId,
    sessionAssignments,
    sessionOccurrences,
    sourceOccurrence,
    todayKey,
  ])
  const completionOccurrence = completionOccurrenceId
    ? occurrenceById.get(completionOccurrenceId)
    : undefined
  const completedOn = completionOccurrence?.occurrenceDate ?? ""
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
    if (feedback.field === "completionOccurrenceId") {
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
    setCompletionOccurrenceId("")
    setReason("")
    setIsReviewing(false)
    setSelectedSourceDate("")
  }

  function replaceHistoryUrl(historyOpen: boolean, adjustmentId: string | null) {
    const params = new URLSearchParams(window.location.search)
    if (historyOpen) params.set("history", "open")
    else params.delete("history")
    if (adjustmentId) params.set("adjustment", adjustmentId)
    else params.delete("adjustment")
    const query = params.toString()
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    )
  }

  function choosePlayer(playerId: string) {
    if (playerId === selectedPlayerId) return
    if (draftIsDirty && !confirmDiscard("Change player and discard this adjustment draft?")) return
    resetDraft()
    setSelectedPlayerId(playerId)
    setFeedback(null)
    const params = new URLSearchParams(window.location.search)
    params.delete("adjustment")
    if (playerId) params.set("player", playerId)
    else params.delete("player")
    const query = params.toString()
    router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, { scroll: false })
  }

  function chooseSource(occurrenceId: string) {
    const occurrence = occurrenceById.get(occurrenceId)
    setSourceOccurrenceId(occurrenceId)
    setSelectedSourceDate(occurrence?.occurrenceDate ?? "")
    setCompletionOccurrenceId("")
    setReason("")
    setIsReviewing(false)
    setFeedback(null)
  }

  function clearSourceSelection() {
    setSourceOccurrenceId("")
    setSelectedSourceDate("")
    setCompletionOccurrenceId("")
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
      setCompletionOccurrenceId("")
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
    if (!selectedPlayerId || !sourceOccurrenceId || !completionOccurrenceId || pendingAction) return
    setPendingAction("publish")
    setFeedback(null)
    try {
      const result = await publishAttendanceAdjustment({
        completionOccurrenceId,
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
      replaceHistoryUrl(true, published.id)
      setFeedback({ message: "Attendance rescheduled", tone: "success" })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The adjustment could not be published",
        retained: "Your adjustment draft is still on screen",
        subject: "The reschedule",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "publish",
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
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The adjustment could not be voided",
        retained: "The adjustment is still published",
        subject: "The adjustment",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: adjustment.id,
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
          <h2 className="sr-only" id="makeup-editor-title">Attendance adjustment editor</h2>

          {isReviewing ? (
            <p className="operational-eyebrow coach-adjustment-review-heading">Review adjustment</p>
          ) : null}

          {feedback ? (
            <InlineNotice
              className="coach-adjustments-notice"
              id={feedbackId}
              message={feedback.message}
              reserveSpace={false}
              tone={feedback.tone}
            />
          ) : null}

          {/*
            * Day one, and any day the academy has no approved players: the
            * three-step form opens on a select whose only option is "Choose a
            * player", with nothing saying why or what to do first. The
            * Attendance card links here unconditionally, so this is reachable
            * from the dashboard of an academy that has never onboarded anyone,
            * and it reads as broken rather than as empty.
            *
            * Rendered as a branch rather than an early return: this component
            * is a forwardRef whose body declares its hooks -- including
            * `useImperativeHandle` and `useUnsavedWorkGuard` -- above this
            * point, and returning before them would break the rules of hooks.
            *
            * Wording follows the register's three empty branches, which each
            * name their own cause and link the one action that resolves it.
            */}
          {!players.length ? (
            <div className="coach-register-empty-schedule">
              <h2>No players yet.</h2>
              <p>
                Attendance can be rescheduled once players are approved and
                assigned to a recurring session.
              </p>
              <Link href="/coach/onboarding">Open onboarding</Link>
            </div>
          ) : !isReviewing ? (
            <div className="coach-adjustment-form">
              <label className="coach-adjustment-field">
                <span><strong>Player</strong><small>1 of 3</small></span>
                <select
                  ref={playerSelectRef}
                  name="playerId"
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
                <fieldset
                  ref={sourceChoiceRef}
                  className={`coach-adjustment-choice-group${sourceOptions.length ? "" : " is-empty"}`}
                  aria-invalid={feedback?.field === "sourceOccurrenceId" || undefined}
                  aria-describedby={feedback?.field === "sourceOccurrenceId" ? feedbackId : undefined}
                >
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
                          <strong aria-live="polite">{displayMonth(effectiveSourceMonth)}</strong>
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
                          role="group"
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
                                <span aria-hidden="true">{day}</span>
                              </button>
                            )
                          })}
                          {Array.from({ length: sourceCalendarTrailingDays }, (_, index) => (
                            <i key={`missed-calendar-trailing-empty-${index}`} aria-hidden="true" />
                          ))}
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
                    <div className="coach-adjustment-empty-step is-compact">
                      <CalendarDays aria-hidden="true" />
                      <p>{selectedPlayer.member.fullName} has no unreconciled absences.</p>
                    </div>
                  )}
                </fieldset>
              ) : null}

              {sourceOccurrence ? (
                <fieldset ref={completionChoiceRef} className="coach-adjustment-choice-group" aria-invalid={feedback?.field === "completionOccurrenceId" || undefined} aria-describedby={feedback?.field === "completionOccurrenceId" ? feedbackId : undefined}>
                  <legend><strong>Completed on</strong><small>3 of 3</small></legend>
                  <p className="coach-adjustment-helper">
                    Choose the exact attended session where the make-up was completed.
                  </p>
                  {completionOptions.length ? (
                    <div className="coach-adjustment-choice-list">
                      {completionOptions.map((occurrence) => (
                        <button
                          key={occurrence.id}
                          type="button"
                          className={occurrence.id === completionOccurrenceId ? "is-active" : undefined}
                          aria-pressed={occurrence.id === completionOccurrenceId}
                          onClick={() => {
                            setCompletionOccurrenceId(occurrence.id)
                            setFeedback(null)
                          }}
                        >
                          <span>
                            <strong>{displayDate(occurrence.occurrenceDate)}</strong>
                            <small>{sessionLabel(occurrence.id)} · {occurrence.venue}</small>
                          </span>
                          {occurrence.id === completionOccurrenceId
                            ? <Check aria-hidden="true" />
                            : <ArrowRight aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="coach-adjustment-empty-step is-warning">
                      <CircleAlert aria-hidden="true" />
                      <p>No attended sessions are available in the 14-day window.</p>
                    </div>
                  )}

                  <label className="coach-adjustment-reason">
                    <span><strong>Reason</strong><small>Optional</small></span>
                    <input
                      ref={reasonRef}
                      name="reason"
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
                    disabled={!completionOccurrenceId}
                    onClick={() => setIsReviewing(true)}
                  >
                    Review adjustment <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : sourceOccurrence && selectedPlayer ? (
            <div className="coach-adjustment-review">
              <div className="coach-adjustment-transfer">
                <div>
                  <span>Missed session</span>
                  <strong>{displayDate(sourceOccurrence.occurrenceDate)}</strong>
                  <small>{sessionLabel(sourceOccurrence.id)}</small>
                </div>
                <span className="coach-adjustment-transfer-arrow" aria-hidden="true">
                  <ArrowRight />
                </span>
                <div>
                  <span>Completed on</span>
                  <strong>{displayDate(completedOn)}</strong>
                  <small>{completionOccurrence ? sessionLabel(completionOccurrence.id) : "Attended session"}</small>
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
                  {retryAction === "publish"
                    ? <RotateCcw aria-hidden="true" />
                    : <Check aria-hidden="true" />}
                  {pendingAction === "publish"
                    ? "Publishing…"
                    : retryAction === "publish" ? "Publish reschedule again" : "Publish reschedule"}
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
          aria-controls={isHistoryOpen ? "attendance-adjustment-history" : undefined}
          onClick={() => {
            const nextOpen = !isHistoryOpen
            setIsHistoryOpen(nextOpen)
            if (!nextOpen) setExpandedAdjustmentId(null)
            replaceHistoryUrl(nextOpen, nextOpen ? expandedAdjustmentId : null)
          }}
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
                        aria-controls={isExpanded ? `adjustment-details-${adjustment.id}` : undefined}
                        onClick={() => {
                          const nextAdjustmentId = isExpanded ? null : adjustment.id
                          setExpandedAdjustmentId(nextAdjustmentId)
                          replaceHistoryUrl(true, nextAdjustmentId)
                        }}
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
                        <ChevronDown aria-hidden="true" />
                      </button>

                      <div className="coach-adjustment-history-row-actions">
                        <span
                          className={[
                            "coach-adjustment-history-status",
                            isVoided ? "is-voided" : requiresReview ? "requires-review" : "is-published",
                          ].join(" ")}
                        >
                          {isVoided ? "Voided" : requiresReview ? "Requires review" : "Published"}
                        </span>
                      </div>

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
                            <button
                              className="coach-adjustment-history-void"
                              type="button"
                              disabled={pendingAction !== null}
                              onClick={() => void voidAdjustment(adjustment)}
                            >
                              <RotateCcw aria-hidden="true" />
                              {pendingAction === adjustment.id
                                ? "Voiding…"
                                : retryAction === adjustment.id
                                  ? "Void adjustment again"
                                  : "Void adjustment"}
                            </button>
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
