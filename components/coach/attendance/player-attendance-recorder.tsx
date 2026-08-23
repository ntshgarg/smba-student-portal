"use client"

import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  ChevronUp,
  Clock3,
  MapPin,
  RotateCcw,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { CSSProperties } from "react"
import { useEffect, useMemo, useState } from "react"

import {
  useAttendancePortal,
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  chronologicalOccurrencesForDate,
  eligiblePlayerIdsForOccurrence,
  playerAttendanceRecordHref,
} from "@/lib/attendance/recording-workspace"
import {
  discardPlayerAttendanceDraft,
  persistPlayerAttendanceDraft,
  readPlayerAttendanceDraft,
  restoredAttendanceDraftNotice,
} from "@/lib/client/attendance-draft-storage"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import {
  academyTimeInputValue,
  formatAcademyTime,
  formatDateKey,
  formatSessionLabel,
} from "@/lib/format"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import type {
  SessionAttendanceChoice,
  SessionAttendanceChange,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

const attendanceChoices = [
  { label: "Present", value: "present" },
  { label: "Absent", value: "absent" },
] satisfies Array<{ label: string; value: SessionAttendanceChoice }>

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

/**
 * Courtside connections are slow rather than dead, so this deadline only has to
 * beat an indefinite hang. A register is a few kilobytes, but the server runs
 * several validation queries per player inside one immediate transaction and
 * then revalidates the academy data in the response, so it is set well above a
 * slow-network round trip to the Mumbai region rather than tuned to payload
 * size. It is a deadline, not a cancellation — see `withSaveDeadline`.
 */
const saveDeadlineMs = 20_000

function sessionLabel(
  occurrence: TrainingSessionOccurrence,
  series: TrainingSessionSeries,
) {
  return formatSessionLabel({
    batch: series.batch,
    durationMinutes: occurrence.durationMinutes,
    programme: series.programme,
    startTime: academyTimeInputValue(occurrence.startsAt),
  })
}

export function PlayerAttendanceRecorder({
  initialDate,
  initialFromCalendar,
  initialOccurrenceId,
  initialReferenceInstant,
}: {
  initialDate: string
  initialFromCalendar: boolean
  initialOccurrenceId: string | null
  initialReferenceInstant: number
}) {
  const { players } = useMemberPortal()
  const {
    attendanceAdjustments,
    attendanceRecords,
    saveAttendanceRegister,
  } = useAttendancePortal()
  const {
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useSessionPortal()
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState(initialOccurrenceId)
  const [draftChanges, setDraftChanges] = useState<SessionAttendanceChange[]>([])
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [referenceInstant, setReferenceInstant] = useState(initialReferenceInstant)
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: draftChanges.length > 0,
    message: "Leave this session and discard the unsaved attendance changes?",
    scope: "record-player-attendance",
  })

  useEffect(() => {
    const timer = window.setInterval(() => setReferenceInstant(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Marks the coach never got to save survive only here. The stored copy is
  // keyed by occurrence, so it can come back to the register it was made on and
  // nowhere else. Restoring is announced rather than silent: these are unsaved
  // marks, not saved state, and the coach has to know which they are looking at.
  //
  // Read after the mounting render rather than during it, as the report resume
  // hint is (`components/coach/reports/report-resume.ts`), so the server-rendered
  // register is what hydrates.
  useEffect(() => {
    if (!selectedOccurrenceId) return
    const timer = window.setTimeout(() => {
      const restored = readPlayerAttendanceDraft(selectedOccurrenceId)
      if (!restored.length) return
      setDraftChanges(restored)
      setFeedback({
        message: restoredAttendanceDraftNotice(restored.length, "save attendance"),
        tone: "info",
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [selectedOccurrenceId])

  const seriesById = useMemo(
    () => new Map(sessionSeries.map((series) => [series.id, series])),
    [sessionSeries],
  )
  const dayOccurrences = useMemo(
    () => chronologicalOccurrencesForDate(sessionOccurrences, selectedDate),
    [selectedDate, sessionOccurrences],
  )
  const selectedOccurrence = dayOccurrences.find(
    (occurrence) => occurrence.id === selectedOccurrenceId,
  ) ?? null
  const selectedSeries = selectedOccurrence
    ? seriesById.get(selectedOccurrence.seriesId) ?? null
    : null
  const eligiblePlayerIds = selectedOccurrence
    ? new Set(eligiblePlayerIdsForOccurrence({
      assignments: sessionAssignments,
      occurrence: selectedOccurrence,
      players: players.map((player) => ({
        id: player.member.id,
        joinedOn: player.member.trainingStartOn,
      })),
    }))
    : new Set<string>()
  const roster = players.filter((player) => eligiblePlayerIds.has(player.member.id))
  const activeSourceAdjustmentByPlayer = new Map(
    attendanceAdjustments
      .filter((adjustment) => (
        !adjustment.voidedAt
        && adjustment.sourceOccurrenceId === selectedOccurrenceId
      ))
      .map((adjustment) => [adjustment.playerId, adjustment]),
  )
  const draftByPlayer = new Map(
    draftChanges.map((change) => [change.playerId, change.choice]),
  )
  const selectedUnavailable = !selectedOccurrence
    || selectedOccurrence.status !== "scheduled"
    || occurrenceIsUpcoming(selectedOccurrence, referenceInstant)

  function resolvedChoice(playerId: string) {
    if (!selectedOccurrence) return undefined
    const draft = draftByPlayer.get(playerId)
    if (draft === "cleared") return undefined
    return draft ?? attendanceRecords[selectedOccurrence.id]?.[playerId]
  }

  function replaceSelection(dateKey: string, occurrenceId: string | null) {
    router.replace(playerAttendanceRecordHref({
      dateKey,
      fromCalendar: initialFromCalendar,
      occurrenceId,
    }), { scroll: false })
  }

  function discardDraftForSelectionChange() {
    if (!draftChanges.length) return true
    if (!confirmDiscard()) return false
    if (selectedOccurrenceId) discardPlayerAttendanceDraft(selectedOccurrenceId)
    setDraftChanges([])
    setFeedback(null)
    return true
  }

  function chooseDate(dateKey: string) {
    if (!dateKey || dateKey === selectedDate || !discardDraftForSelectionChange()) return
    setSelectedDate(dateKey)
    setSelectedOccurrenceId(null)
    setFeedback(null)
    replaceSelection(dateKey, null)
  }

  function chooseOccurrence(occurrence: TrainingSessionOccurrence) {
    if (occurrence.status !== "scheduled" || occurrenceIsUpcoming(occurrence, referenceInstant)) return
    if (occurrence.id === selectedOccurrenceId) {
      if (!discardDraftForSelectionChange()) return
      setSelectedOccurrenceId(null)
      setFeedback(null)
      replaceSelection(selectedDate, null)
      return
    }
    if (!discardDraftForSelectionChange()) return
    setSelectedOccurrenceId(occurrence.id)
    setFeedback(null)
    replaceSelection(selectedDate, occurrence.id)
  }

  function chooseAttendance(playerId: string, choice: SessionAttendanceChoice) {
    if (!selectedOccurrence || selectedUnavailable || isSaving) return
    if (activeSourceAdjustmentByPlayer.has(playerId)) return
    const base = attendanceRecords[selectedOccurrence.id]?.[playerId]
    const current = resolvedChoice(playerId)
    const next = current === choice ? "cleared" : choice
    // Resolved against this render's `draftChanges`, exactly as `resolvedChoice`
    // above already is, so the next register state is known here and can be
    // stored on the same tick it is shown.
    const rest = draftChanges.filter((change) => change.playerId !== playerId)
    const matchesBase = next === base || (next === "cleared" && !base)
    const nextChanges: SessionAttendanceChange[] = matchesBase
      ? rest
      : [...rest, {
        choice: next,
        expectedChoice: base ?? "cleared",
        occurrenceId: selectedOccurrence.id,
        playerId,
      }]
    setDraftChanges(nextChanges)
    persistPlayerAttendanceDraft(selectedOccurrence.id, nextChanges)
    setFeedback(null)
  }

  async function saveAttendance() {
    if (!draftChanges.length || isSaving || !selectedOccurrence) return
    setIsSaving(true)
    setFeedback(null)
    try {
      const result = await withSaveDeadline(
        saveAttendanceRegister(draftChanges),
        saveDeadlineMs,
      )
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        return
      }
      discardPlayerAttendanceDraft(selectedOccurrence.id)
      setDraftChanges([])
      setFeedback({ message: "Attendance saved", tone: "success" })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "Attendance could not be saved",
        retained: "Your marks are still on screen",
        subject: "Attendance",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const backHref = initialFromCalendar
    ? `/coach/calendar?date=${encodeURIComponent(selectedDate)}`
    : "/coach#attendance"
  const backLabel = initialFromCalendar ? "Back to calendar" : "Back to Attendance"
  const selectedOccurrenceIndex = dayOccurrences.findIndex(
    (occurrence) => occurrence.id === selectedOccurrenceId,
  )
  const leadingOccurrences = selectedOccurrenceIndex >= 0
    ? dayOccurrences.slice(0, selectedOccurrenceIndex + 1)
    : dayOccurrences
  const trailingOccurrences = selectedOccurrenceIndex >= 0
    ? dayOccurrences.slice(selectedOccurrenceIndex + 1)
    : []
  const rosterListStyle = {
    "--attendance-roster-rows": Math.ceil(roster.length / 2),
  } as CSSProperties & { "--attendance-roster-rows": number }

  function renderOccurrenceButton(occurrence: TrainingSessionOccurrence) {
    const series = seriesById.get(occurrence.seriesId)
    if (!series) return null
    const upcoming = occurrenceIsUpcoming(occurrence, referenceInstant)
    const unavailable = occurrence.status !== "scheduled" || upcoming
    const isSelected = occurrence.id === selectedOccurrenceId
    const state = occurrence.status === "cancelled"
      ? "Cancelled"
      : upcoming ? "Upcoming" : "Available"

    return (
      <button
        key={occurrence.id}
        type="button"
        className={[
          isSelected ? "is-selected" : "",
          unavailable ? "" : "is-available",
        ].filter(Boolean).join(" ") || undefined}
        aria-expanded={unavailable ? undefined : isSelected}
        aria-controls={unavailable ? undefined : "attendance-roster-panel"}
        disabled={unavailable}
        onClick={() => chooseOccurrence(occurrence)}
      >
        <time dateTime={occurrence.startsAt}>{formatAcademyTime(occurrence.startsAt)}</time>
        <span className="attendance-occurrence-copy">
          <strong>{series.programme} · {series.batch}</strong>
          <small><MapPin aria-hidden="true" /> {occurrence.venue}</small>
        </span>
        <span className="attendance-occurrence-state">
          <em>{state}</em>
          {unavailable ? null : isSelected
            ? <ChevronUp aria-hidden="true" />
            : <ChevronRight aria-hidden="true" />}
        </span>
      </button>
    )
  }

  const rosterPanel = (
    <section
      id="attendance-roster-panel"
      className={`attendance-roster-recorder${selectedOccurrence && selectedSeries ? " has-selection" : " is-awaiting-selection"}`}
      aria-labelledby="attendance-roster-title"
    >
      {!selectedOccurrence || !selectedSeries ? (
        <div className="attendance-record-empty is-selection">
          <Users aria-hidden="true" />
          <h2 id="attendance-roster-title">Select a session.</h2>
          <p>The eligible roster will appear here for attendance.</p>
        </div>
      ) : (
        <>
          <div className="attendance-record-section-heading attendance-roster-heading">
            <div>
              <span>Session roster</span>
              <h2 id="attendance-roster-title">
                {sessionLabel(selectedOccurrence, selectedSeries)}
              </h2>
              <p>
                <Clock3 aria-hidden="true" /> {selectedOccurrence.durationMinutes} minutes
                <span aria-hidden="true">·</span>
                <MapPin aria-hidden="true" /> {selectedOccurrence.venue}
              </p>
            </div>
            <strong>{roster.length} {roster.length === 1 ? "player" : "players"}</strong>
          </div>

          {selectedUnavailable ? (
            <div className="attendance-record-empty is-roster">
              <h3>Attendance is not available.</h3>
              <p>{selectedOccurrence.status === "cancelled"
                ? "This session was cancelled."
                : "Attendance opens when the session begins."}</p>
            </div>
          ) : !roster.length ? (
            <div className="attendance-record-empty is-roster">
              <h3>No eligible players.</h3>
              <p>Only players assigned to this occurrence can be recorded.</p>
            </div>
          ) : (
            <ol className="attendance-record-roster-list" style={rosterListStyle}>
              {roster.map((player, index) => {
                const choice = resolvedChoice(player.member.id)
                const adjustment = activeSourceAdjustmentByPlayer.get(player.member.id)
                const folio = String(index + 1).padStart(2, "0")
                const tabletColumnBreak = Math.ceil(roster.length / 2)
                const rowClassName = [
                  index >= tabletColumnBreak ? "is-second-column" : "",
                  index === tabletColumnBreak ? "is-column-start" : "",
                ].filter(Boolean).join(" ") || undefined

                return (
                  <li key={player.member.id} className={rowClassName}>
                    <span className="attendance-roster-folio" aria-hidden="true">{folio}</span>
                    <span className="attendance-roster-player">
                      <strong>{player.member.fullName}</strong>
                      <small>{adjustment ? "Rescheduled" : choice ? "Marked" : "Not marked"}</small>
                    </span>
                    {adjustment ? (
                      <Link
                        className="attendance-roster-adjustment"
                        href={`/coach/attendance/adjustments?adjustment=${encodeURIComponent(adjustment.id)}&player=${encodeURIComponent(player.member.id)}`}
                      >
                        Rescheduled <span aria-hidden="true">·</span> View
                      </Link>
                    ) : (
                      <span
                        className="attendance-roster-choices"
                        role="group"
                        aria-label={`Attendance for ${player.member.fullName}`}
                      >
                        {attendanceChoices.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`attendance-roster-choice is-${option.value}`}
                            aria-pressed={choice === option.value}
                            disabled={isSaving}
                            onClick={() => chooseAttendance(player.member.id, option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          <div className="attendance-record-footer">
            <InlineNotice
              reserveSpace={false}
              message={feedback?.message ?? (draftChanges.length
                ? `${draftChanges.length} unsaved ${draftChanges.length === 1 ? "change" : "changes"}`
                : undefined)}
              tone={feedback?.tone ?? (draftChanges.length ? "info" : undefined)}
            />
            <button
              type="button"
              disabled={!draftChanges.length || isSaving || selectedUnavailable}
              onClick={saveAttendance}
            >
              {feedback?.offerRetry
                ? <RotateCcw aria-hidden="true" />
                : <Check aria-hidden="true" />}
              {isSaving
                ? "Saving…"
                : feedback?.offerRetry ? "Save attendance again" : "Save attendance"}
            </button>
          </div>
        </>
      )}
    </section>
  )

  return (
    <div className="coach-calendar coach-attendance-workspace player-attendance-recorder page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Player attendance navigation">
        <Link href={backHref}><ArrowLeft aria-hidden="true" /> {backLabel}</Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Player attendance</span>
          <h1 id="record-player-attendance-title">Record attendance</h1>
        </div>
      </header>

      <section className="attendance-record-workspace" aria-labelledby="record-player-attendance-title">
        <div className="attendance-record-date-row">
          <label>
            <span>Training date</span>
            <input
              name="attendanceDate"
              type="date"
              value={selectedDate}
              onChange={(event) => chooseDate(event.target.value)}
            />
          </label>
          <p>{formatDateKey(selectedDate, { year: "numeric" })}</p>
        </div>

        <div className="attendance-record-layout">
          <section
            className={`attendance-occurrence-picker${trailingOccurrences.length ? " has-trailing-occurrences" : ""}`}
            aria-labelledby="attendance-session-picker-title"
          >
            <div className={`attendance-occurrence-lead${selectedOccurrenceIndex < 0 ? " is-without-selection" : ""}`}>
              <div className="attendance-record-section-heading">
                <div>
                  <span>Scheduled sessions</span>
                  <h2 id="attendance-session-picker-title">Choose one session</h2>
                </div>
                <strong>{dayOccurrences.length}</strong>
              </div>

              {!dayOccurrences.length ? (
                <div className="attendance-record-empty">
                  <CalendarDays aria-hidden="true" />
                  <h3>No sessions on this date.</h3>
                  <p>Choose another date or create the recurring schedule first.</p>
                </div>
              ) : (
                <div className="attendance-occurrence-list">
                  {leadingOccurrences.map(renderOccurrenceButton)}
                </div>
              )}
            </div>

            {rosterPanel}

            {trailingOccurrences.length ? (
              <div className="attendance-occurrence-tail">
                <div className="attendance-occurrence-list">
                  {trailingOccurrences.map(renderOccurrenceButton)}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  )
}
