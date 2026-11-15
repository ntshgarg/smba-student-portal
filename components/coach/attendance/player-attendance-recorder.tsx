"use client"

import {
  CalendarDays,
  Check,
  ChevronRight,
  RotateCcw,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { memberInitials } from "@/lib/coach/member-utils"
import {
  chronologicalOccurrencesForDate,
  daySessionsMarked,
  eligiblePlayerIdsForOccurrence,
  playerAttendanceRecordHref,
  rosterProgressForOccurrences,
} from "@/lib/attendance/recording-workspace"
import {
  discardPlayerAttendanceDraft,
  leftOutAttendanceDraftNotice,
  persistPlayerAttendanceDraft,
  readPlayerAttendanceDraft,
  rebaseRestoredAttendanceDraft,
  restoredAttendanceDraftNotice,
} from "@/lib/client/attendance-draft-storage"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { describeRefusedSave, feedbackAfterMark } from "@/lib/client/session-expiry"
import { formatAcademyTime, formatDateKey } from "@/lib/format"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import type {
  SessionAttendanceChoice,
  SessionAttendanceChange,
  TrainingSessionOccurrence,
} from "@/lib/sessions/types"

import styles from "./mark.module.css"
import {
  StaffRollCall,
  staffRollCallProgress,
  type StaffMember,
  type StaffRecord,
  type StaffRollCallHandle,
} from "./staff-roll-call"
import { WeekStrip } from "./week-strip"

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

/** Leaving the page keeps a stored draft; changing session or date discards it. */
const keptMarksPrompt = "Leave this session? Your unsaved marks are kept on this device"
  + " and come back when you open it again."

/** Shown when the coach tries to change session or date while a save is running. */
const waitForSaveMessage = "Attendance is still saving. Wait for it to finish before"
  + " choosing another session or date."

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

/** The open card when it is the staff roll call rather than a session. */
const staffCard = "staff"

/**
 * The Mark tab: a week strip, then one list for the day -- the staff roll call
 * first, then every session -- where a tapped card opens in place. Only one card
 * is open at a time, so the open card's unsaved marks are the only ones there
 * can be, and leaving it asks first.
 */
export function PlayerAttendanceRecorder({
  initialDate,
  initialFromCalendar,
  initialOccurrenceId,
  initialReferenceInstant,
  initialStaffOpen,
  staff,
}: {
  initialDate: string
  initialFromCalendar: boolean
  initialOccurrenceId: string | null
  initialReferenceInstant: number
  initialStaffOpen: boolean
  /** The day's staff roll call, read for `initialDate`. */
  staff: {
    closedFor: string | null
    juniorCoaches: StaffMember[]
    records: StaffRecord[]
    referenceDate: string
  }
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
  // An occurrence id, `staffCard`, or null with every card closed.
  const [openCard, setOpenCard] = useState(initialStaffOpen ? staffCard : initialOccurrenceId)
  const staffOpen = openCard === staffCard
  const selectedOccurrenceId = staffOpen ? null : openCard
  const staffRef = useRef<StaffRollCallHandle>(null)
  const [draftChanges, setDraftChanges] = useState<SessionAttendanceChange[]>([])
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  // Answers a date or session tap that a running save held back, beside the week strip.
  const [selectionNotice, setSelectionNotice] = useState<ActionFeedback | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [referenceInstant, setReferenceInstant] = useState(initialReferenceInstant)
  // The day's occurrences come from the server one date at a time
  // (`getCoachAttendanceRecorderSnapshot` fetches `from: dateKey, to: dateKey`),
  // so between the tap and the round trip the provider still holds the previous
  // date and this date's list is empty for reasons that have nothing to do with
  // the coach's schedule. The transition is what tells those two empties apart.
  const [isChangingDate, startDateChange] = useTransition()
  // Whether the device holds the marks on screen, from the last write or a restore.
  const [draftKeptOnDevice, setDraftKeptOnDevice] = useState<boolean | undefined>(undefined)
  const { confirmDiscard, navigateAfterCommit } = useUnsavedWorkGuard({
    isDirty: draftChanges.length > 0,
    // Leaving the *page* discards nothing while an expiry stands: the marks are
    // on the device, the notice has just said so, and this register is the one
    // place they cannot be saved from. The guard still confirms -- only the
    // sentence changes, and only once the draft has been read back out of
    // storage. See `describeRefusedSave`.
    message: feedback?.leaveConfirmation
      ?? (draftKeptOnDevice ? keptMarksPrompt : discardMarksPrompt),
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
  const eligiblePlayerIds = useMemo(() => (
    selectedOccurrence
      ? new Set(eligiblePlayerIdsForOccurrence({
        assignments: sessionAssignments,
        occurrence: selectedOccurrence,
        players: players.map((player) => ({
          id: player.member.id,
          joinedOn: player.member.trainingStartOn,
        })),
      }))
      : new Set<string>()
  ), [players, selectedOccurrence, sessionAssignments])
  const roster = players.filter((player) => eligiblePlayerIds.has(player.member.id))
  // Deliberately the saved count, not saved-plus-draft: the footer already
  // reports unsaved marks as "N unsaved changes", so keeping this one to what
  // the register actually holds means the two numbers describe different things
  // instead of disagreeing about the same one.
  const selectedProgress = selectedOccurrenceId
    ? rosterProgressByOccurrence.get(selectedOccurrenceId)
    : undefined
  const activeSourceAdjustmentByPlayer = useMemo(() => new Map(
    attendanceAdjustments
      .filter((adjustment) => (
        !adjustment.voidedAt
        && adjustment.sourceOccurrenceId === selectedOccurrenceId
      ))
      .map((adjustment) => [adjustment.playerId, adjustment]),
  ), [attendanceAdjustments, selectedOccurrenceId])
  // Marks the coach never got to save survive only here. The stored copy is
  // keyed by occurrence, so it can come back to the register it was made on and
  // nowhere else. Restoring is announced rather than silent: these are unsaved
  // marks, not saved state, and the coach has to know which they are looking at.
  //
  // Read after the mounting render rather than during it, so the server-rendered
  // register is what hydrates.
  //
  // What comes back is rebased onto that hydrated register before any of it is
  // shown. The expectation each mark carries is the one part of a draft that
  // does not merely age: a week is long enough for the register to be written
  // elsewhere, and a mark expecting what the cell held that evening is then
  // unsaveable — see `rebaseRestoredAttendanceDraft`. The rebase is not written
  // back on restore, so a reload before any tap warns again; the next mark
  // persists the rebased expectations, once the coach has seen the warning.
  // This component is keyed on the
  // selection, so the navigation `chooseOccurrence` fires remounts it and reads
  // the draft a second time within the same tap.
  //
  // `attendanceRecords` is a dependency because the rebase reads it, not because
  // a new one should restore the draft again: the provider hands down a fresh
  // object on every revalidation, and a second restore would re-announce, as
  // recovered from an earlier visit, marks the coach is in the middle of making.
  // The ref holds the restore to once per selected occurrence, against whatever
  // the register has hydrated by the time the timer runs.
  //
  // Only marks this screen can show come back: a player no longer on the roster
  // or whose absence was made up has no buttons, yet their mark would fail the
  // whole save. Those are left out and named. Waits for the session to load so
  // an empty roster cannot drop everything.
  const restoredOccurrenceIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedOccurrenceId || selectedOccurrence?.id !== selectedOccurrenceId) return
    const timer = window.setTimeout(() => {
      if (restoredOccurrenceIdRef.current === selectedOccurrenceId) return
      restoredOccurrenceIdRef.current = selectedOccurrenceId
      const stored = readPlayerAttendanceDraft(selectedOccurrenceId)
      if (!stored.length) return
      // A session cancelled since cannot be saved; the marks stay on the device.
      if (selectedOccurrence.status !== "scheduled") {
        setFeedback({
          message: `${stored.length} unsaved ${stored.length === 1 ? "mark" : "marks"} from an earlier visit`
            + " cannot be saved because this session was cancelled. They stay on this device and"
            + " come back if the session is restored.",
          tone: "info",
        })
        return
      }
      const restored = stored.filter((change) => (
        eligiblePlayerIds.has(change.playerId)
        && !activeSourceAdjustmentByPlayer.has(change.playerId)
      ))
      const leftOut = stored.length - restored.length
      const recorded = attendanceRecords[selectedOccurrenceId] ?? {}
      const rebased = rebaseRestoredAttendanceDraft(
        restored,
        (change) => recorded[change.playerId] ?? "cleared",
      )
      if (!rebased.changes.length) {
        if (leftOut) {
          discardPlayerAttendanceDraft(selectedOccurrenceId)
          setFeedback({ message: leftOutAttendanceDraftNotice(leftOut), tone: "info" })
        }
        return
      }
      setDraftChanges(rebased.changes)
      setDraftKeptOnDevice(true)
      setFeedback({
        message: restoredAttendanceDraftNotice(
          rebased.changes.length,
          "save attendance",
          rebased.changedUnderneath,
          leftOut,
        ),
        tone: "info",
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    activeSourceAdjustmentByPlayer,
    attendanceRecords,
    eligiblePlayerIds,
    selectedOccurrence,
    selectedOccurrenceId,
  ])

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
  // On a phone the footer sticks to the foot of the screen only while there is
  // something to save or to report, so an untouched register has no bar over it.
  const footerPinned = Boolean(draftChanges.length || isSaving || feedback)

  function resolvedChoice(playerId: string) {
    if (!selectedOccurrence) return undefined
    const draft = draftByPlayer.get(playerId)
    if (draft === "cleared") return undefined
    return draft ?? attendanceRecords[selectedOccurrence.id]?.[playerId]
  }

  function replaceSelection(dateKey: string, card: string | null) {
    router.replace(playerAttendanceRecordHref({
      dateKey,
      fromCalendar: initialFromCalendar,
      occurrenceId: card === staffCard ? null : card,
      staffOpen: card === staffCard,
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

  // A save in flight holds the session and date, so its outcome can be shown.
  function blockedBySave() {
    if (!isSaving) return false
    setSelectionNotice({ message: waitForSaveMessage, tone: "info" })
    return true
  }

  // The open card's marks, before another card opens or the date changes. The
  // address change goes through the guard that held them: discarding the marks
  // steps the guard's extra history entry back, and that step would otherwise
  // cancel the navigation, leaving the address -- and a reload -- on the old
  // card or date.
  function releaseOpenCard(navigate: () => void) {
    if (staffOpen && staffRef.current) return staffRef.current.release(navigate)
    if (!discardDraftForSelectionChange()) return false
    navigateAfterCommit(navigate)
    return true
  }

  function chooseDate(dateKey: string) {
    if (!dateKey || dateKey === selectedDate || blockedBySave()) return
    // The chosen date is shown as soon as the guard lets the navigation go --
    // it is the coach's own input, and the week strip must not lag behind the
    // picker -- and in the same callback, so the new date is never drawn over
    // the old date's list before `isChangingDate` is raised. Only the
    // navigation that fetches it is deferred, so `isChangingDate` is raised for
    // the round trip in which the occurrence list on screen still belongs to the
    // date the coach has left. It does not cover the whole of that mismatch: the commit remounts
    // this component (`app/coach/attendance/players/record/page.tsx` keys it on
    // the selection) with a fresh, unset transition, while the provider re-seeds
    // `sessionOccurrences` from props a tick later, so the previous date's list
    // is still in place for that one frame. A frame rather than a venue
    // connection is the whole of what this buys. The input keeps no `disabled`,
    // for the reason the save button below does not: it is the element the coach
    // is standing on, and disabling it here would hand focus to `<body>` on a
    // slow venue connection.
    releaseOpenCard(() => {
      setSelectedDate(dateKey)
      setOpenCard(null)
      setFeedback(null)
      startDateChange(() => replaceSelection(dateKey, null))
    })
  }

  // Tapping the open session closes it.
  function chooseOccurrence(occurrence: TrainingSessionOccurrence) {
    if (occurrence.status !== "scheduled" || occurrenceIsUpcoming(occurrence, referenceInstant)) return
    if (blockedBySave()) return
    const next = occurrence.id === selectedOccurrenceId ? null : occurrence.id
    if (!releaseOpenCard(() => replaceSelection(selectedDate, next))) return
    setOpenCard(next)
    setFeedback(null)
  }

  function toggleStaff() {
    if (blockedBySave()) return
    const next = staffOpen ? null : staffCard
    if (!releaseOpenCard(() => replaceSelection(selectedDate, next))) return
    setOpenCard(next)
    setFeedback(null)
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
    setDraftKeptOnDevice(persistPlayerAttendanceDraft(selectedOccurrence.id, nextChanges))
    setFeedback(feedbackAfterMark)
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
      setSelectionNotice(null)
    }
  }

  const staffProgress = staffRollCallProgress({
    dateKey: initialDate,
    juniorCoaches: staff.juniorCoaches,
    records: staff.records,
  })
  // Counted by the dashboard card's rule: cancelled sessions are left out.
  const sessionsMarked = daySessionsMarked(dayOccurrences, rosterProgressByOccurrence)
  const daySummary = [
    staff.closedFor
      ? "Academy closed"
      : staffProgress.total ? `Staff ${staffProgress.marked}/${staffProgress.total}` : null,
    sessionsMarked.total
      ? `${sessionsMarked.total} ${sessionsMarked.total === 1 ? "session" : "sessions"}, ${sessionsMarked.marked} fully marked`
      : "No sessions",
  ].filter(Boolean).join(" · ")

  function renderOccurrence(occurrence: TrainingSessionOccurrence) {
    const series = seriesById.get(occurrence.seriesId)
    if (!series) return null
    const upcoming = occurrenceIsUpcoming(occurrence, referenceInstant)
    const unavailable = occurrence.status !== "scheduled" || upcoming
    const isSelected = occurrence.id === selectedOccurrenceId
    const { eligible = 0, marked = 0 } = rosterProgressByOccurrence.get(occurrence.id) ?? {}
    // "Not marked" is the honest word for a register nobody has touched: a
    // session that has only just started has not failed at anything, and
    // "0/30 marked" on it would read as an accusation. Once there is progress
    // the count replaces it, and it keeps reading as progress at the end rather
    // than flipping to a different word, so the coach never has to learn which
    // of two vocabularies a row is speaking.
    //
    // An empty roster is the one case that reasoning does not cover. `0/0` is
    // not an untouched register, it is a session with nobody to mark, and
    // calling it "Not marked" sent the coach in to find that out. On a Thursday
    // at an academy whose plans fall on other days, all four of the day's
    // sessions read that way and all four were empty. `eligible` is already
    // resolved here for the count, so the empty case costs one more branch.
    //
    // The open card shows what its own register holds instead -- deliberately
    // the saved count, as `selectedProgress` explains.
    const [tone, state]: [string, string] = isSelected
      ? ["band", selectedProgress?.marked
        ? `${selectedProgress.marked}/${roster.length} marked`
        : `${roster.length} ${roster.length === 1 ? "player" : "players"}`]
      : occurrence.status === "cancelled"
        ? ["muted", "Cancelled"]
        : upcoming
          ? ["upcoming", `Opens ${formatAcademyTime(occurrence.startsAt)}`]
          : !eligible
            ? ["muted", "No players"]
            : marked === eligible
              ? ["done", `${marked}/${eligible} marked`]
              : marked
                ? ["part", `${marked}/${eligible} marked`]
                : ["todo", "Not marked"]

    return (
      <li
        key={occurrence.id}
        className={`${styles.card}${isSelected ? ` ${styles.open}` : ""}`}
      >
        <button
          type="button"
          className={styles.head}
          aria-expanded={unavailable ? undefined : isSelected}
          // Only an open card's register is on the page to point at.
          aria-controls={!unavailable && isSelected ? "attendance-roster-panel" : undefined}
          disabled={unavailable}
          onClick={() => chooseOccurrence(occurrence)}
        >
          <time className={styles.time} dateTime={occurrence.startsAt}>
            {formatAcademyTime(occurrence.startsAt)}
          </time>
          <span className={styles.copy}>
            <strong id={isSelected ? "attendance-roster-title" : undefined}>
              {series.programme} · {series.batch}
            </strong>
            <small>{isSelected
              ? `${occurrence.durationMinutes} min · ${occurrence.venue}`
              : `${occurrence.venue} · ${eligible} ${eligible === 1 ? "player" : "players"}`}</small>
          </span>
          <span className={`${styles.pill} ${styles[tone]}`}>
            {tone === "done" ? <Check aria-hidden="true" /> : null}
            {state}
          </span>
          {unavailable ? null : (
            <span className={styles.toggle} aria-hidden="true">
              {isSelected ? <X /> : <ChevronRight />}
            </span>
          )}
        </button>
        {isSelected ? rosterPanel : null}
      </li>
    )
  }

  const rosterPanel = selectedOccurrence ? (
    <section
      id="attendance-roster-panel"
      className={styles.panel}
      aria-labelledby="attendance-roster-title"
    >
      {selectedUnavailable ? (
        <div className={styles.empty}>
          <h3>Attendance is not available.</h3>
          <p>{selectedOccurrence.status === "cancelled"
            ? "This session was cancelled."
            : "Attendance opens when the session begins."}</p>
        </div>
      ) : !roster.length ? (
        <div className={styles.empty}>
          <h3>No eligible players.</h3>
          <p>Only players assigned to this occurrence can be recorded.</p>
        </div>
      ) : (
        <ol className={styles.rows}>
          {roster.map((player) => {
            const choice = resolvedChoice(player.member.id)
            const adjustment = activeSourceAdjustmentByPlayer.get(player.member.id)

            return (
              <li key={player.member.id} className={styles.row}>
                <span className={styles.badge} aria-hidden="true">
                  {memberInitials(player.member.fullName)}
                </span>
                <span className={styles.person}>
                  <strong>{player.member.fullName}</strong>
                  <small>{adjustment ? "Rescheduled" : choice ? `Marked ${choice}` : "Not marked"}</small>
                </span>
                {adjustment ? (
                  <Link
                    className={styles.adjustment}
                    href={`/coach/attendance/adjustments?adjustment=${encodeURIComponent(adjustment.id)}&player=${encodeURIComponent(player.member.id)}`}
                  >
                    Rescheduled <span aria-hidden="true">·</span> View
                  </Link>
                ) : (
                  <span
                    className={styles.choices}
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
                        className={`${styles.choice} ${styles[option.value]}`}
                        aria-pressed={choice === option.value}
                        aria-disabled={isSaving}
                        onClick={() => chooseAttendance(player.member.id, option.value)}
                      >
                        {choice === option.value
                          ? option.value === "present"
                            ? <Check aria-hidden="true" />
                            : <X aria-hidden="true" />
                          : null}
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

      <div className={`${styles.footer}${footerPinned ? ` ${styles.pinned}` : ""}`}>
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
          className={styles.save}
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
    </section>
  ) : null

  return (
    <section className={styles.mark} aria-labelledby="attendance-day-title">
      <WeekStrip selectedDate={selectedDate} onChoose={chooseDate} />
      {selectionNotice ? (
        <InlineNotice
          message={selectionNotice.message}
          reserveSpace={false}
          tone={selectionNotice.tone}
        />
      ) : null}

      <div className={styles.dayLine}>
        <h2 id="attendance-day-title">{formatDateKey(selectedDate)}</h2>
        {/* The counts are the same claim the empty state below makes, so they
            wait on the same flag rather than reporting the previous date's
            list as this one's. */}
        {isChangingDate ? null : <p>{daySummary}</p>}
      </div>

      <ul className={styles.list}>
        {isChangingDate ? (
          // "No sessions on this date." is a statement about the coach's own
          // schedule, and until the round trip lands the register has no basis
          // for it — the provider is holding the previous date's sessions, not
          // this date's absence of any. The staff card waits too: its marks
          // are the previous date's as well. This branch withholds both for
          // that round trip; see `chooseDate` for the single frame after the
          // commit that it does not cover.
          <li className={styles.empty} role="status">
            <CalendarDays aria-hidden="true" />
            <h3>Loading sessions…</h3>
            <p>Checking the schedule for this date.</p>
          </li>
        ) : (
          <>
            <StaffRollCall
              ref={staffRef}
              closedFor={staff.closedFor}
              dateKey={initialDate}
              initialRecords={staff.records}
              juniorCoaches={staff.juniorCoaches}
              open={staffOpen}
              referenceDate={staff.referenceDate}
              onToggle={toggleStaff}
            />
            {dayOccurrences.length ? dayOccurrences.map(renderOccurrence) : (
              <li className={styles.empty}>
                <CalendarDays aria-hidden="true" />
                <h3>No sessions on this date.</h3>
                <p>Choose another date or create the recurring schedule first.</p>
              </li>
            )}
          </>
        )}
      </ul>
    </section>
  )
}
