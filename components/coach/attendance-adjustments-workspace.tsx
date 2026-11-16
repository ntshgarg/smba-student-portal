"use client"

import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  RotateCcw,
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
  useTransition,
} from "react"

import {
  useAttendancePortal,
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import { initials } from "@/components/coach/members/directory/shared"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type { AttendanceAdjustmentRecord } from "@/lib/attendance/adjustments"
import { MAKEUP_WINDOW_DAYS } from "@/lib/attendance/domain"
import { describeSaveFailure } from "@/lib/client/network-failure"
import {
  formatAcademyDate,
  formatAcademyTime,
  formatDateKey,
  formatSessionLabelFromInstant,
  sessionLabelParts,
} from "@/lib/format"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"

import styles from "./attendance-adjustments-workspace.module.css"

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

/** "15 Jul", the day and month on a date card. */
function dayMonth(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "short", weekday: undefined })
}

/** "Wed, 15 Jul", a date card's title. */
function shortDate(dateKey: string) {
  const weekday = formatDateKey(dateKey, { day: undefined, month: undefined, weekday: "short" })
  return `${weekday}, ${dayMonth(dateKey)}`
}

/** "16–29 Jul", or "30 Jul – 5 Aug" across a month end. */
function dateSpan(first: string, last: string) {
  if (first === last) return dayMonth(first)
  if (first.slice(0, 7) === last.slice(0, 7)) return `${Number(first.slice(8))}–${dayMonth(last)}`
  return `${dayMonth(first)} – ${dayMonth(last)}`
}

type StepState = "current" | "done" | "locked"

/** A missed (red) or attended (green) session as one pressable date card. */
function DateCard({
  dateKey,
  detail,
  onClick,
  pressed,
  tone,
}: {
  dateKey: string
  detail: string
  onClick: () => void
  pressed: boolean
  tone: "attended" | "missed"
}) {
  return (
    <button
      className={`${styles.dateCard} ${styles[tone]}`}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className={styles.dateBadge} aria-hidden="true">
        {Number(dateKey.slice(8))}
        <small>{formatDateKey(dateKey, { day: undefined, month: "short", weekday: undefined })}</small>
      </span>
      <span>
        {/* "Wed, 15 Jul 2026": the year tells 15 Jul 2025 from 15 Jul 2026. */}
        <strong>{shortDate(dateKey)} {dateKey.slice(0, 4)}</strong>
        <small>{detail}</small>
      </span>
      <span className={styles.tick} aria-hidden="true">{pressed ? <Check /> : null}</span>
    </button>
  )
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
  /**
   * The server's "now", not the device's. `sourceOptions` gates on
   * `occurrence.occurrenceDate <= todayKey`, so taking these at mount grew the
   * missed-session list by one every midnight and moved the DOM the
   * accessibility gate measures -- which is the drift lib/clock.ts names against
   * this file, and one of the reasons a ceiling recorded against no CSS change
   * kept having to be re-recorded.
   */
  referenceDate: string
  referenceInstant: number
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
  referenceDate,
  referenceInstant: initialReferenceInstant,
}, ref) {
  const { players } = useMemberPortal()
  const {
    attendanceAdjustments,
    attendanceRecords,
    keepAttendanceAdjustment,
    publishAttendanceAdjustment,
    voidAttendanceAdjustment,
  } = useAttendancePortal()
  const {
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useSessionPortal()
  const router = useRouter()
  const [isChangingPlayer, startPlayerChange] = useTransition()
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
  const [todayKey] = useState(referenceDate)
  const [referenceInstant] = useState(initialReferenceInstant)
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
  // Per player: two players can miss the same session, and a make-up recorded
  // for one of them says nothing about the other's absence.
  const playerActiveAdjustments = useMemo(
    () => activeAdjustments.filter((item) => item.playerId === selectedPlayerId),
    [activeAdjustments, selectedPlayerId],
  )
  const adjustedSourceIds = useMemo(
    () => new Set(playerActiveAdjustments.map((item) => item.sourceOccurrenceId)),
    [playerActiveAdjustments],
  )
  // A session that proves one make-up cannot also be another's missed session.
  const usedCompletionIds = useMemo(
    () => new Set(playerActiveAdjustments.flatMap((item) => (
      item.completionOccurrenceId ? [item.completionOccurrenceId] : []
    ))),
    [playerActiveAdjustments],
  )
  const sourceOptions = useMemo(() => {
    if (!selectedPlayerId) return []

    return sessionOccurrences
      .filter((occurrence) => (
        occurrence.status === "scheduled"
        && attendanceRecords[occurrence.id]?.[selectedPlayerId] === "absent"
        && !adjustedSourceIds.has(occurrence.id)
        && !usedCompletionIds.has(occurrence.id)
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
    usedCompletionIds,
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
  // Newest first, one card per date; a date with two missed sessions asks for
  // the exact one under the list.
  const sourceDates = [...sourceOptionsByDate.keys()].sort().reverse()
  const activeSourceDate = selectedSourceDate || sourceOccurrence?.occurrenceDate || ""
  const selectedSourceDateOptions = activeSourceDate
    ? sourceOptionsByDate.get(activeSourceDate) ?? []
    : []
  const completionOptions = useMemo(() => {
    if (!sourceOccurrence || !selectedPlayer) return []
    const min = shiftDateKey(sourceOccurrence.occurrenceDate, 1)
    const max = [shiftDateKey(sourceOccurrence.occurrenceDate, MAKEUP_WINDOW_DAYS), todayKey].sort()[0]
    const playerAssignments = sessionAssignments.filter(
      (assignment) => assignment.playerId === selectedPlayerId,
    )
    const legacyCompletionDates = new Set(playerActiveAdjustments
      .filter((adjustment) => !adjustment.completionOccurrenceId)
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
    attendanceRecords,
    playerActiveAdjustments,
    referenceInstant,
    selectedPlayer,
    selectedPlayerId,
    sessionAssignments,
    sessionOccurrences,
    sourceOccurrence,
    todayKey,
    usedCompletionIds,
  ])
  const completionOccurrence = completionOccurrenceId
    ? occurrenceById.get(completionOccurrenceId)
    : undefined
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
    // Only the player's own absences are loaded, so until this lands the records
    // on screen belong to the player just left, not to the one chosen.
    startPlayerChange(() => {
      router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, { scroll: false })
    })
  }

  function chooseSource(occurrenceId: string) {
    const occurrence = occurrenceById.get(occurrenceId)
    setSourceOccurrenceId(occurrenceId)
    setSelectedSourceDate(occurrence?.occurrenceDate ?? "")
    setCompletionOccurrenceId("")
    setReason("")
    setFeedback(null)
  }

  function clearSourceSelection() {
    setSourceOccurrenceId("")
    setSelectedSourceDate("")
    setCompletionOccurrenceId("")
    setReason("")
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
        retained: "Your adjustment draft is still on screen",
        subject: "The reschedule",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "publish",
        tone: "error",
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function keepAdjustment(adjustment: AttendanceAdjustmentRecord) {
    const pendingKey = `keep:${adjustment.id}`
    setPendingAction(pendingKey)
    setFeedback(null)
    try {
      const result = await keepAttendanceAdjustment(adjustment.id)
      if (!result.ok) {
        setFeedback({ field: result.field, message: result.message, tone: "error" })
        return
      }
      setFeedback({ message: "Make-up kept", tone: "success" })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "It still needs review",
        unconfirmed: "Check the connection, then reload the page to see whether the make-up was kept",
        subject: "Keeping the make-up",
      })
      setFeedback({ action: failure.signIn, message: failure.message, tone: "error" })
    } finally {
      setPendingAction(null)
    }
  }

  async function voidAdjustment(adjustment: AttendanceAdjustmentRecord) {
    const player = playerById.get(adjustment.playerId)
    // A missed session cancelled since no longer counts, so no absence comes back.
    const missedCancelled = occurrenceById.get(adjustment.sourceOccurrenceId)?.status === "cancelled"
    const confirmed = window.confirm(
      `Void this make-up adjustment${player ? ` for ${player.member.fullName}` : ""}? ${missedCancelled
        ? "Its missed session was cancelled afterwards, so no absence will count against them."
        : "The original absence will be restored."}`,
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
      setFeedback({
        message: missedCancelled ? "Adjustment voided" : "Adjustment voided and original absence restored",
        tone: "success",
      })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "The adjustment is still published",
        unconfirmed: "Check the connection, then reload the page to see whether the adjustment was voided",
        subject: "The adjustment",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: adjustment.id,
        tone: "error",
      })
    } finally {
      setPendingAction(null)
    }
  }

  const isPublishing = pendingAction === "publish"
  const steps: Array<{ label: string; state: StepState }> = [
    { label: "Player", state: selectedPlayer ? "done" : "current" },
    {
      label: "Missed",
      state: sourceOccurrence ? "done" : selectedPlayer ? "current" : "locked",
    },
    {
      label: "Made up on",
      state: completionOccurrence ? "done" : sourceOccurrence ? "current" : "locked",
    },
  ]
  const reviewCount = history.filter((item) => item.reviewRequiredAt && !item.voidedAt).length

  function sessionWhen(occurrenceId: string) {
    const occurrence = occurrenceById.get(occurrenceId)
    if (!occurrence) return ""
    const { range } = sessionLabelParts(sessionLabel(occurrenceId))
    return range ? `${shortDate(occurrence.occurrenceDate)} · ${range}` : shortDate(occurrence.occurrenceDate)
  }

  const playerSelect = (
    <select
      ref={playerSelectRef}
      name="playerId"
      value={selectedPlayerId}
      aria-label={selectedPlayer ? "Change player" : undefined}
      aria-invalid={feedback?.field === "playerId" || undefined}
      aria-describedby={feedback?.field === "playerId" ? feedbackId : undefined}
      disabled={isPublishing}
      onChange={(event) => choosePlayer(event.target.value)}
    >
      <option value="">Choose a player</option>
      {players.map((player) => (
        <option key={player.member.id} value={player.member.id}>
          {player.member.fullName}
        </option>
      ))}
    </select>
  )

  return (
    <div className={styles.workspace} id={id} role="region" aria-labelledby={labelledBy}>
      <section className={styles.editor} aria-labelledby="new-makeup-title">
        <header className={styles.band}>
          <div>
            <h2 id="new-makeup-title">New make-up</h2>
            <p>Move a missed session to one the player attended</p>
          </div>
          {players.length ? (
            <ol className={styles.steps} aria-label="Steps">
              {steps.map((step) => (
                <li
                  key={step.label}
                  className={styles[step.state]}
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  {step.state === "done" ? <Check aria-hidden="true" /> : null}
                  {step.label}
                  {step.state === "done" ? <span className="sr-only">, done</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </header>

        <div className={styles.body}>
          {feedback ? (
            <InlineNotice
              action={feedback.action}
              className={styles.notice}
              id={feedbackId}
              message={feedback.message}
              reserveSpace={false}
              tone={feedback.tone}
            />
          ) : null}

          {/*
            * Day one, and any day the academy has no approved players: the
            * form would open on a select whose only option is "Choose a
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
          ) : (
            <>
              {selectedPlayer ? (
                <div className={styles.chosenPlayer}>
                  <span className={styles.initials} aria-hidden="true">
                    {initials(selectedPlayer.member.fullName)}
                  </span>
                  <span>
                    <strong>{selectedPlayer.member.fullName}</strong>
                    <small>
                      {[...new Set([selectedPlayer.training.level, selectedPlayer.training.batch])].join(" · ")}
                      {" · "}
                      {isChangingPlayer
                        ? "checking for missed sessions…"
                        : `${sourceOptions.length} missed ${sourceOptions.length === 1 ? "session" : "sessions"} to make up`}
                    </small>
                  </span>
                  {/* The select itself sits over "Change", so one tap opens the list. */}
                  <span className={styles.change}>
                    <span aria-hidden="true">Change</span>
                    {playerSelect}
                  </span>
                </div>
              ) : (
                <label className={styles.playerField}>
                  <span className={styles.label}>Player</span>
                  {playerSelect}
                </label>
              )}

              <div className={styles.columns}>
                <fieldset
                  ref={sourceChoiceRef}
                  className={styles.step}
                  disabled={!selectedPlayer || isPublishing}
                  aria-invalid={feedback?.field === "sourceOccurrenceId" || undefined}
                  aria-describedby={feedback?.field === "sourceOccurrenceId" ? feedbackId : undefined}
                >
                  <legend className={styles.label}>Missed session</legend>
                  {!selectedPlayer ? (
                    <p className={styles.placeholder}>Choose a player first</p>
                  ) : sourceDates.length ? (
                    <div className={styles.cards}>
                      {sourceDates.map((dateKey) => {
                        const dateOptions = sourceOptionsByDate.get(dateKey) ?? []
                        return (
                          <DateCard
                            key={dateKey}
                            dateKey={dateKey}
                            detail={dateOptions.length === 1
                              ? `${sessionLabel(dateOptions[0].id)} · absent`
                              : `${dateOptions.length} missed sessions`}
                            pressed={dateKey === activeSourceDate}
                            tone="missed"
                            onClick={() => chooseSourceDate(dateKey)}
                          />
                        )
                      })}
                    </div>
                  ) : isChangingPlayer ? (
                    <p className={styles.placeholder} role="status">Checking for missed sessions…</p>
                  ) : (
                    <p className={styles.placeholder}>
                      {selectedPlayer.member.fullName} has no unreconciled absences.
                    </p>
                  )}

                  {selectedSourceDateOptions.length > 1 ? (
                    <div className={styles.exactSession}>
                      <p>
                        <strong>{shortDate(activeSourceDate)}</strong>
                        <small>Choose the exact missed session</small>
                      </p>
                      {selectedSourceDateOptions.map((occurrence) => (
                        <button
                          key={occurrence.id}
                          type="button"
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
                </fieldset>

                <fieldset
                  ref={completionChoiceRef}
                  className={styles.step}
                  disabled={!sourceOccurrence || isPublishing}
                  aria-invalid={feedback?.field === "completionOccurrenceId" || undefined}
                  aria-describedby={feedback?.field === "completionOccurrenceId" ? feedbackId : undefined}
                >
                  <legend className={styles.label}>
                    Made up on <span>(attended, within {MAKEUP_WINDOW_DAYS} days)</span>
                  </legend>
                  {!sourceOccurrence ? (
                    <p className={styles.placeholder}>Choose the missed session first</p>
                  ) : completionOptions.length ? (
                    <>
                      <div className={`${styles.cards} ${styles.scroll}`}>
                        {completionOptions.map((occurrence) => (
                          <DateCard
                            key={occurrence.id}
                            dateKey={occurrence.occurrenceDate}
                            detail={sessionLabel(occurrence.id)}
                            pressed={occurrence.id === completionOccurrenceId}
                            tone="attended"
                            onClick={() => {
                              setCompletionOccurrenceId(occurrence.id)
                              setFeedback(null)
                            }}
                          />
                        ))}
                      </div>
                      <p className={styles.hint}>
                        {completionOptions.length} attended {completionOptions.length === 1 ? "session" : "sessions"},{" "}
                        {dateSpan(completionOptions[0].occurrenceDate, completionOptions[completionOptions.length - 1].occurrenceDate)}
                      </p>
                    </>
                  ) : (
                    <p className={`${styles.placeholder} ${styles.warning}`}>
                      <CircleAlert aria-hidden="true" />
                      No attended sessions are available in the 14-day window.
                    </p>
                  )}
                </fieldset>
              </div>

              <fieldset className={styles.finish} disabled={!completionOccurrence || isPublishing}>
                <legend className="sr-only">Reason and summary</legend>
                <label className={styles.reason}>
                  <span className={styles.label}>Reason <small>Optional</small></span>
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

                <div className={styles.summary}>
                  <p>Missed <strong>{sourceOccurrence ? sessionWhen(sourceOccurrence.id) : "—"}</strong></p>
                  <ArrowRight aria-hidden="true" />
                  <p>Made up on <strong>{completionOccurrence ? sessionWhen(completionOccurrence.id) : "—"}</strong></p>
                </div>
              </fieldset>

              <div className={styles.actions}>
                <button
                  className={styles.button}
                  type="button"
                  disabled={!draftIsDirty || isPublishing}
                  onClick={cancelDraft}
                >
                  Cancel
                </button>
                <button
                  className={`${styles.button} ${styles.primary}`}
                  type="button"
                  disabled={!completionOccurrence || pendingAction !== null}
                  onClick={() => void publishAdjustment()}
                >
                  {retryAction === "publish" ? <RotateCcw aria-hidden="true" /> : null}
                  {isPublishing
                    ? "Publishing…"
                    : retryAction === "publish" ? "Publish make-up again" : "Publish make-up"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className={styles.history} aria-label="Past make-ups">
        <button
          className={styles.disclosure}
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
          <strong>
            Past make-ups ({history.length})
            {selectedPlayer ? <small> for {selectedPlayer.member.fullName}</small> : null}
          </strong>
          {reviewCount ? (
            <span>{reviewCount} {reviewCount === 1 ? "needs" : "need"} review</span>
          ) : null}
          <ChevronRight aria-hidden="true" />
        </button>

        {isHistoryOpen ? (
          // The global class names are hooks for the shared reveal stagger (portal.css).
          <div id="attendance-adjustment-history" className={`${styles.historyList} coach-adjustment-history-list`}>
            {history.length ? history.map((adjustment) => {
              const player = playerById.get(adjustment.playerId)
              const source = occurrenceById.get(adjustment.sourceOccurrenceId)
              const resolvedOccurrence = adjustment.completionOccurrenceId
                ? occurrenceById.get(adjustment.completionOccurrenceId)
                : undefined
              const isVoided = Boolean(adjustment.voidedAt)
              const requiresReview = Boolean(adjustment.reviewRequiredAt) && !isVoided
              const status = isVoided ? "voided" : requiresReview ? "review" : "published"
              const isExpanded = adjustment.id === expandedAdjustmentId
              const keepKey = `keep:${adjustment.id}`
              const reviewCause = source?.status === "cancelled"
                ? "Its missed session was cancelled afterwards."
                : resolvedOccurrence && resolvedOccurrence.status !== "scheduled"
                  ? "Its make-up session was cancelled."
                  : resolvedOccurrence
                    && attendanceRecords[resolvedOccurrence.id]?.[adjustment.playerId] !== "present"
                    ? "The player’s Present mark on the make-up session was removed."
                    : "A session it rests on has changed since it was recorded."

              return (
                <article key={adjustment.id} className={styles.historyRow} data-status={status}>
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
                    <span className={styles.initials} aria-hidden="true">
                      {initials(player?.member.fullName ?? "Player")}
                    </span>
                    <span>
                      <strong>{player?.member.fullName ?? "Player"}</strong>
                      <small>
                        Missed {source ? shortDate(source.occurrenceDate) : "session"}
                        {" → made up "}{shortDate(adjustment.completedOn)}
                      </small>
                    </span>
                    <span className={styles.pill}>
                      {isVoided ? "Voided" : requiresReview ? "Needs review" : "Published"}
                    </span>
                    <span className={styles.view}>
                      {requiresReview ? "Review" : "View"} <ChevronRight aria-hidden="true" />
                    </span>
                  </button>

                  {isExpanded ? (
                    <div id={`adjustment-details-${adjustment.id}`} className={`${styles.details} coach-adjustment-history-details`}>
                      {requiresReview ? (
                        <p className={styles.reviewWarning}>
                          <CircleAlert aria-hidden="true" />
                          <span><strong>This adjustment requires review.</strong> {reviewCause} Keep the make-up if the player trained and is still marked Present on the make-up session, or void it.</span>
                        </p>
                      ) : null}
                      <dl>
                        <div><dt>Missed session</dt><dd>{source ? displayDate(source.occurrenceDate) : "Unavailable"}</dd></div>
                        <div><dt>Made up on</dt><dd>{displayDate(adjustment.completedOn)}</dd></div>
                        <div><dt>Published</dt><dd>{adjustmentTimestamp(adjustment.publishedAt)}</dd></div>
                        <div><dt>Session</dt><dd>{resolvedOccurrence ? sessionLabel(resolvedOccurrence.id) : "Date-level record"}</dd></div>
                        {adjustment.reason ? <div className={styles.wide}><dt>Reason</dt><dd>{adjustment.reason}</dd></div> : null}
                      </dl>
                      {isVoided ? (
                        <p className={styles.voidedNote}>
                          Voided {adjustment.voidedAt ? adjustmentTimestamp(adjustment.voidedAt) : ""}. The original absence remains in the register.
                        </p>
                      ) : (
                        <div className={styles.actions}>
                          {requiresReview ? (
                            <button
                              className={`${styles.button} ${styles.keep}`}
                              type="button"
                              disabled={pendingAction !== null}
                              onClick={() => void keepAdjustment(adjustment)}
                            >
                              <Check aria-hidden="true" />
                              {pendingAction === keepKey ? "Keeping…" : "Keep make-up"}
                            </button>
                          ) : null}
                          <button
                            className={`${styles.button} ${styles.void}`}
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
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              )
            }) : (
              <p className={styles.historyEmpty}>
                <strong>No make-ups published yet.</strong>
                Completed make-up attendance will become part of this audit record.
              </p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
})
