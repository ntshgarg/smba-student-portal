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
import { useEffect, useMemo, useRef, useState, useTransition } from "react"

import {
  useAttendancePortal,
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  InlineNotice,
  type ActionFeedback,
  type InlineNoticeAction,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  chronologicalOccurrencesForDate,
  eligiblePlayerIdsForOccurrence,
  playerAttendanceRecordHref,
  rosterProgressForOccurrences,
} from "@/lib/attendance/recording-workspace"
import {
  discardPlayerAttendanceDraft,
  persistPlayerAttendanceDraft,
  readPlayerAttendanceDraft,
  rebaseRestoredAttendanceDraft,
  restoredAttendanceDraftNotice,
} from "@/lib/client/attendance-draft-storage"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { describeRefusedSave } from "@/lib/client/session-expiry"
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
 * The prompt for leaving with marks the coach has not saved. Hoisted because
 * `discardDraftForSelectionChange` now hands it back to `confirmDiscard`
 * explicitly: the surface message the guard uses for everything else becomes
 * the expiry's own wording while a refused save stands, and that wording must
 * not reach this path. Confirming here really does discard the marks -- the
 * stored draft for the occurrence being left is cleared with them -- so "kept
 * on this device" would be a lie exactly where it costs a register.
 */
const discardMarksPrompt = "Leave this session and discard the unsaved attendance changes?"

/**
 * `offerRetry`, `signIn` and `leaveConfirmation` ride on the feedback so every
 * existing `setFeedback(null)` also withdraws the retry prompt, the sign-in
 * link and the re-worded leave confirmation together. The first two never
 * appear at once: a refusal the coach can act on here offers the button, an
 * expired sign-in offers the link.
 */
type SaveFeedback = ActionFeedback & {
  leaveConfirmation?: string
  offerRetry?: boolean
  signIn?: InlineNoticeAction
}

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
  // The day's occurrences come from the server one date at a time
  // (`getCoachAttendanceRecorderSnapshot` fetches `from: dateKey, to: dateKey`),
  // so between the tap and the round trip the provider still holds the previous
  // date and this date's list is empty for reasons that have nothing to do with
  // the coach's schedule. The transition is what tells those two empties apart.
  const [isChangingDate, startDateChange] = useTransition()
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: draftChanges.length > 0,
    // Leaving the *page* discards nothing while an expiry stands: the marks are
    // on the device, the notice has just said so, and this register is the one
    // place they cannot be saved from. The guard still confirms -- only the
    // sentence changes, and only once the draft has been read back out of
    // storage. See `describeRefusedSave`.
    message: feedback?.leaveConfirmation ?? discardMarksPrompt,
    scope: "record-player-attendance",
  })

  // Advanced from the instant the server rendered with, by however much real
  // time has passed, rather than reset to the device's own clock. The register
  // has to notice a session starting while the coach is looking at it, so the
  // 30s tick stays; what changes is whose "now" it counts from.
  //
  // Courtside that removes a dependency on the phone being set correctly:
  // whether this session can be marked at all is `occurrenceIsUpcoming` on this instant, so a handset
  // running minutes fast used to be what stood between a coach and the register.
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

  // Marks the coach never got to save survive only here. The stored copy is
  // keyed by occurrence, so it can come back to the register it was made on and
  // nowhere else. Restoring is announced rather than silent: these are unsaved
  // marks, not saved state, and the coach has to know which they are looking at.
  //
  // Read after the mounting render rather than during it, as the report resume
  // hint is (`components/coach/reports/report-resume.ts`), so the server-rendered
  // register is what hydrates.
  //
  // What comes back is rebased onto that hydrated register before any of it is
  // shown. The expectation each mark carries is the one part of a draft that
  // does not merely age: a week is long enough for the register to be written
  // elsewhere, and a mark expecting what the cell held that evening is then
  // unsaveable — see `rebaseRestoredAttendanceDraft`. The rebase stays in memory
  // and storage keeps the draft as it was marked: rebasing again on the next
  // read costs nothing, while overwriting the stored expectation would erase
  // what the warning below is counted from. This component is keyed on the
  // selection, so the navigation `chooseOccurrence` fires remounts it and reads
  // the draft a second time within the same tap.
  //
  // `attendanceRecords` is a dependency because the rebase reads it, not because
  // a new one should restore the draft again: the provider hands down a fresh
  // object on every revalidation, and a second restore would re-announce, as
  // recovered from an earlier visit, marks the coach is in the middle of making.
  // The ref holds the restore to once per selected occurrence, against whatever
  // the register has hydrated by the time the timer runs.
  const restoredOccurrenceIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedOccurrenceId) return
    const timer = window.setTimeout(() => {
      if (restoredOccurrenceIdRef.current === selectedOccurrenceId) return
      restoredOccurrenceIdRef.current = selectedOccurrenceId
      const restored = readPlayerAttendanceDraft(selectedOccurrenceId)
      if (!restored.length) return
      const recorded = attendanceRecords[selectedOccurrenceId] ?? {}
      const rebased = rebaseRestoredAttendanceDraft(
        restored,
        (change) => recorded[change.playerId] ?? "cleared",
      )
      if (!rebased.changes.length) return
      setDraftChanges(rebased.changes)
      setFeedback({
        message: restoredAttendanceDraftNotice(
          rebased.changes.length,
          "save attendance",
          rebased.changedUnderneath,
        ),
        tone: "info",
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [attendanceRecords, selectedOccurrenceId])

  const seriesById = useMemo(
    () => new Map(sessionSeries.map((series) => [series.id, series])),
    [sessionSeries],
  )
  const dayOccurrences = useMemo(
    () => chronologicalOccurrencesForDate(sessionOccurrences, selectedDate),
    [selectedDate, sessionOccurrences],
  )
  /*
   * How far each of the day's registers got, for the picker.
   *
   * The picker used to derive its one status word from `occurrence.status` and
   * the clock alone, so eight sessions all read "Available" whether their
   * register was untouched, half done, or finished that morning. The answer was
   * already in the component: `getCoachAttendanceRecorderSnapshot` fetches
   * `attendanceRecords` for *every* occurrence in the day's window, not just the
   * selected one, and `renderOccurrenceButton` simply never consulted it.
   *
   * Counted rather than reduced to a flag. `attendanceRecords[id]` being
   * non-empty means at least one player was marked, and putting "Recorded" on a
   * register abandoned at 3 of 30 would be a worse claim than saying nothing --
   * it is the reassuring word on the dangerous case.
   *
   * The eligible set is resolved here for all of them rather than inline per
   * button, so a hundred players across eight occurrences is one pass per render
   * instead of one per paint of each row.
   */
  const rosterProgressByOccurrence = useMemo(() => rosterProgressForOccurrences({
    assignments: sessionAssignments,
    occurrences: dayOccurrences,
    players: players.map((player) => ({
      id: player.member.id,
      joinedOn: player.member.trainingStartOn,
    })),
    records: attendanceRecords,
  }), [attendanceRecords, dayOccurrences, players, sessionAssignments])

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
  // Deliberately the saved count, not saved-plus-draft: the footer already
  // reports unsaved marks as "N unsaved changes", so keeping this one to what
  // the register actually holds means the two numbers describe different things
  // instead of disagreeing about the same one.
  const selectedProgress = selectedOccurrenceId
    ? rosterProgressByOccurrence.get(selectedOccurrenceId)
    : undefined
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
  // Carried on the save button as `aria-disabled` rather than `disabled`:
  // disabling the element that currently holds focus hands focus to `<body>`,
  // and it is the coach's own press that disables it — so every save, including
  // the failure whose "Save attendance again" below is the way back, would send
  // the next Tab to the top of the document. `saveAttendance` reads the same
  // constant, so a press that still reaches the handler does nothing.
  const cannotSave = !draftChanges.length || isSaving || selectedUnavailable
  // `aria-disabled` on its own would leave the button a permanent tab stop
  // whose press is a silent no-op, and the footer renders under "Attendance is
  // not available." below and with nothing marked yet. So only the in-flight
  // save keeps it tabbable: that is the one state the coach is already standing
  // on, and `tabindex="-1"` does not blur an element that already holds focus,
  // so the save that just emptied `draftChanges` still hands the next Tab to
  // the control after this one.
  const saveOutOfReach = cannotSave && !isSaving

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
    if (!confirmDiscard(discardMarksPrompt)) return false
    if (selectedOccurrenceId) discardPlayerAttendanceDraft(selectedOccurrenceId)
    setDraftChanges([])
    setFeedback(null)
    return true
  }

  function chooseDate(dateKey: string) {
    if (!dateKey || dateKey === selectedDate || !discardDraftForSelectionChange()) return
    // The chosen date is shown at once — it is the coach's own input, and the
    // date row must not lag behind the picker. Only the navigation that fetches
    // it is deferred, so `isChangingDate` is raised for the round trip in which
    // the occurrence list on screen still belongs to the date the coach has
    // left. It does not cover the whole of that mismatch: the commit remounts
    // this component (`app/coach/attendance/players/record/page.tsx` keys it on
    // the selection) with a fresh, unset transition, while the provider re-seeds
    // `sessionOccurrences` from props a tick later, so the previous date's list
    // is still in place for that one frame. A frame rather than a venue
    // connection is the whole of what this buys. The input keeps no `disabled`,
    // for the reason the save button below does not: it is the element the coach
    // is standing on, and disabling it here would hand focus to `<body>` on a
    // slow venue connection.
    setSelectedDate(dateKey)
    setSelectedOccurrenceId(null)
    setFeedback(null)
    startDateChange(() => replaceSelection(dateKey, null))
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
    if (cannotSave || !selectedOccurrence) return
    setIsSaving(true)
    setFeedback(null)
    try {
      const result = await withSaveDeadline(
        saveAttendanceRegister(draftChanges),
        saveDeadlineMs,
      )
      if (!result.ok) {
        setFeedback({
          ...describeRefusedSave(result, {
            // Read back rather than assumed: `chooseAttendance` persists on
            // every mark, but a device that refused the write leaves the coach
            // holding marks that only exist on this screen.
            marksOnDevice: () => (
              readPlayerAttendanceDraft(selectedOccurrence.id).length > 0
            ),
            place: "session",
            subject: "Attendance",
          }),
          tone: "error",
        })
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
    const progress = rosterProgressByOccurrence.get(occurrence.id)
    // "Available" stays the honest word for a register nobody has touched: a
    // session that has only just started has not failed at anything, and
    // "0/30 marked" on it would read as an accusation. Once there is progress
    // the count replaces it, and it keeps reading as progress at the end rather
    // than flipping to a different word, so the coach never has to learn which
    // of two vocabularies a row is speaking.
    const state = occurrence.status === "cancelled"
      ? "Cancelled"
      : upcoming
        ? "Upcoming"
        : progress?.marked
          ? `${progress.marked}/${progress.eligible} marked`
          : "Available"

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
            {/*
              * The same question the picker now answers, for the coach who has
              * already opened the session: without it, "how far did I get?" is
              * a scroll through the whole roster looking for "Not marked".
              */}
            <strong>{selectedProgress?.marked
              ? `${selectedProgress.marked}/${roster.length} marked`
              : `${roster.length} ${roster.length === 1 ? "player" : "players"}`}</strong>
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
                        {/* `aria-disabled`, not `disabled`, for the reason the
                            save button below carries it: macOS Safari and
                            Firefox do not move focus to a button on click, so a
                            coach who marks with the keyboard and then clicks
                            Save is still standing on a roster button when the
                            save disables it, and a disabled element hands focus
                            to `<body>`. `chooseAttendance` re-checks `isSaving`,
                            so a press that still lands does nothing. */}
                        {attendanceChoices.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`attendance-roster-choice is-${option.value}`}
                            aria-pressed={choice === option.value}
                            aria-disabled={isSaving}
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
              action={feedback?.signIn}
              reserveSpace={false}
              message={feedback?.message ?? (draftChanges.length
                ? `${draftChanges.length} unsaved ${draftChanges.length === 1 ? "change" : "changes"}`
                : undefined)}
              tone={feedback?.tone ?? (draftChanges.length ? "info" : undefined)}
            />
            <button
              type="button"
              aria-busy={isSaving}
              aria-disabled={cannotSave}
              tabIndex={saveOutOfReach ? -1 : undefined}
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
                {/* The count is the same claim the empty state below makes, so
                    it waits on the same flag rather than reporting the previous
                    date's list as this one's. */}
                <strong>{isChangingDate ? "—" : dayOccurrences.length}</strong>
              </div>

              {isChangingDate ? (
                // "No sessions on this date." is a statement about the coach's
                // own schedule, and until the round trip lands the register has
                // no basis for it — the provider is holding the previous date's
                // sessions, not this date's absence of any. This branch withholds
                // it for that round trip; see `chooseDate` for the single frame
                // after the commit that it does not cover.
                <div className="attendance-record-empty" role="status">
                  <CalendarDays aria-hidden="true" />
                  <h3>Loading sessions…</h3>
                  <p>Checking the schedule for this date.</p>
                </div>
              ) : !dayOccurrences.length ? (
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
