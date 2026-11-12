"use client"

import { ArrowLeft, CalendarDays, Check, RotateCcw, UsersRound } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { saveStaffAttendanceAction } from "@/app/coach/actions"
import {
  InlineNotice,
  type ActionFeedback,
  type InlineNoticeAction,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  discardStaffAttendanceDraft,
  keepMarkedExpectations,
  leftOutAttendanceDraftNotice,
  persistStaffAttendanceDraft,
  readStaffAttendanceDraft,
  rebaseRestoredAttendanceDraft,
  restoredAttendanceDraftNotice,
} from "@/lib/client/attendance-draft-storage"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { describeRefusedSave } from "@/lib/client/session-expiry"
import type {
  StaffAttendanceChange,
  StaffAttendanceChoice,
} from "@/lib/coach/staff-attendance"
import { formatDateKey } from "@/lib/format"

type StaffMember = {
  accountId: string
  fullName: string
  initials: string
  joinedOn: string
}

type StaffRecord = {
  choice: StaffAttendanceChoice
  coachAccountId: string
}

const choices: Array<{
  label: string
  value: Exclude<StaffAttendanceChoice, "cleared">
}> = [
  { label: "Present", value: "present" },
  { label: "Absent", value: "absent" },
]

/**
 * The prompt for leaving with marks the coach has not saved. Hoisted because
 * `chooseDate` now hands it back to `confirmDiscard` explicitly: the surface
 * message the guard uses for everything else becomes the expiry's own wording
 * while a refused save stands, and that wording must not reach this path.
 * Confirming here really does discard the marks -- `chooseDate` clears the
 * stored draft for the date it is leaving -- so "kept on this device" would be
 * a lie exactly where it costs a register.
 */
const discardMarksPrompt = "Leave this date and discard the unsaved staff attendance changes?"

/**
 * Leaving the *page* does not clear the stored draft, so when the device kept
 * it the marks come back the next time this date is opened. Changing the date
 * on this page still really discards, and keeps `discardMarksPrompt`.
 */
const keptMarksPrompt = "Leave this date? Your unsaved marks are kept on this device"
  + " and come back when you open it again."

/** Shown when the head coach tries to change the date while a save is running. */
const waitForSaveMessage = "Staff attendance is still saving. Wait for it to finish"
  + " before choosing another date."

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
 * Shorter than the player register's deadline: one day of assistant coaches is a
 * handful of changes with fewer validation queries each, so a healthy save
 * settles sooner. Still far above a slow-network round trip. It is a deadline,
 * not a cancellation — see `withSaveDeadline`.
 */
const saveDeadlineMs = 15_000

/**
 * A date change that has not arrived by now is treated as lost -- a dropped
 * venue connection -- rather than left on "Loading roll call…" for good.
 */
const dateChangeDeadlineMs = 20_000

const staffSubjects = { one: "that assistant coach", many: "those assistant coaches" }

export function StaffRollCall({
  initialDate,
  initialRecords,
  juniorCoaches,
  referenceDate,
}: {
  initialDate: string
  initialRecords: StaffRecord[]
  juniorCoaches: StaffMember[]
  referenceDate: string
}) {
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [records, setRecords] = useState(initialRecords)
  const [drafts, setDrafts] = useState<StaffAttendanceChange[]>([])
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  // Answers a date pick: a running save holding it back, or a day that never
  // arrived. Shown under the date picker, where the head coach just tapped.
  // Seeded with null so it is told apart from the other states by tests.
  const [selectionNotice, setSelectionNotice] = useState<ActionFeedback | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // Whether the device holds the marks on screen; undefined until a write or a
  // restore has said. See the player recorder's `draftKeptOnDevice`.
  const [draftKeptOnDevice, setDraftKeptOnDevice] = useState<boolean | undefined>(undefined)
  // The expectation each restored mark was made against, by coach, until that
  // coach is re-tapped. See `keepMarkedExpectations`.
  const restoredExpectationsRef = useRef(new Map<string, StaffAttendanceChoice>())
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: drafts.length > 0,
    // Leaving the *page* discards nothing while an expiry stands: the marks are
    // on the device, the notice has just said so, and this register is the one
    // place they cannot be saved from. The guard still confirms -- only the
    // sentence changes, and only once the draft has been read back out of
    // storage. See `describeRefusedSave`. Otherwise the sentence follows what
    // the device kept: see `keptMarksPrompt`.
    message: feedback?.leaveConfirmation
      ?? (draftKeptOnDevice ? keptMarksPrompt : discardMarksPrompt),
    scope: "staff-roll-call",
  })
  // The page is keyed on the date the server rendered, so between picking a
  // new day and that day's records arriving, `records` still belongs to the
  // day being left. Showing them -- and using them as the base for a tap --
  // put the previous day's marks under the new date, where a tap could do the
  // opposite of what the head coach meant. Until the new day arrives the list
  // is withheld and nothing can be marked.
  const isChangingDate = selectedDate !== initialDate
  const storedByCoach = useMemo(
    () => new Map(records.map((record) => [record.coachAccountId, record.choice])),
    [records],
  )
  const draftByCoach = useMemo(
    () => new Map(drafts.map((draft) => [draft.coachAccountId, draft.choice])),
    [drafts],
  )
  const futureDate = selectedDate > referenceDate
  // Carried on the save button as `aria-disabled` rather than `disabled`:
  // disabling the element that currently holds focus hands focus to `<body>`,
  // and it is the coach's own press that disables it — so every save, including
  // the failure whose "Save staff attendance again" below is the way back, would
  // send the next Tab to the top of the document. `saveRollCall` reads the same
  // constant, so a press that still reaches the handler does nothing.
  const cannotSave = !drafts.length || isSaving || futureDate || isChangingDate
  // `aria-disabled` on its own would leave the button a permanent tab stop
  // whose press is a silent no-op, and the footer renders on a future date and
  // with nothing marked yet. So only the in-flight save keeps it tabbable: that
  // is the one state the coach is already standing on, and `tabindex="-1"` does
  // not blur an element that already holds focus, so the save that just emptied
  // `drafts` still hands the next Tab to the control after this one.
  const saveOutOfReach = cannotSave && !isSaving

  // The roll call is one day of marks, so the stored copy is keyed by date and
  // can only ever return to the date it was made for — yesterday's marks cannot
  // surface on today's register. Restoring is announced rather than silent:
  // these are unsaved marks, not the saved record.
  //
  // Read after the mounting render rather than during it, so the server-rendered
  // roll call is what hydrates.
  //
  // What comes back is rebased onto that hydrated day before any of it is shown,
  // for the reason the player recorder does it: the value a mark expects is the
  // one part of a draft that goes stale rather than merely aging, and a mark
  // expecting what the cell held a week ago is unsaveable once anything else has
  // written the day — see `rebaseRestoredAttendanceDraft`. As there, the rebase
  // stays in memory: storage keeps the expectation the coach marked against,
  // which is the only thing the "marked differently elsewhere" count can be
  // measured from, and every read rebases anyway. `storedByCoach` is a
  // dependency because the rebase reads it and needs no guard against restoring
  // twice: it only changes when this register's own save succeeds, and that
  // discards the draft before the effect can run again.
  useEffect(() => {
    if (isChangingDate) return
    const timer = window.setTimeout(() => {
      const stored = readStaffAttendanceDraft(selectedDate)
      if (!stored.length) return
      // Only marks this roll call can show and change come back. An assistant
      // coach archived or promoted since has no row, so a restored mark for
      // them could be neither seen nor undone, yet the server refused every
      // save because of it. As in the player register, those are left out and
      // named.
      const markable = new Set(juniorCoaches
        .filter((coach) => selectedDate >= coach.joinedOn && selectedDate <= referenceDate)
        .map((coach) => coach.accountId))
      const restored = stored.filter((change) => markable.has(change.coachAccountId))
      const leftOut = stored.length - restored.length
      const rebased = rebaseRestoredAttendanceDraft(
        restored,
        (change) => storedByCoach.get(change.coachAccountId) ?? "cleared",
      )
      if (!rebased.changes.length) {
        if (leftOut) {
          discardStaffAttendanceDraft(selectedDate)
          setFeedback({
            message: leftOutAttendanceDraftNotice(leftOut, staffSubjects),
            tone: "info",
          })
        }
        return
      }
      restoredExpectationsRef.current = new Map(
        restored.map((change) => [change.coachAccountId, change.expectedChoice]),
      )
      setDrafts(rebased.changes)
      setDraftKeptOnDevice(true)
      setFeedback({
        message: restoredAttendanceDraftNotice(
          rebased.changes.length,
          "save staff attendance",
          rebased.changedUnderneath,
          leftOut,
          staffSubjects,
        ),
        tone: "info",
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [isChangingDate, juniorCoaches, referenceDate, selectedDate, storedByCoach])

  // The page remounts for the new date when it arrives. If that navigation is
  // lost, go back to the day this roll call does hold -- its records are
  // exactly the ones on screen -- and say so, instead of loading for ever.
  useEffect(() => {
    if (!isChangingDate) return
    const pendingDate = selectedDate
    const timer = window.setTimeout(() => {
      setSelectedDate(initialDate)
      setSelectionNotice({
        message: `The roll call for ${formatDateKey(pendingDate)} did not load.`
          + " Check the connection and choose the date again.",
        tone: "error",
      })
    }, dateChangeDeadlineMs)
    return () => window.clearTimeout(timer)
  }, [initialDate, isChangingDate, selectedDate])

  function resolvedChoice(coachAccountId: string) {
    return draftByCoach.get(coachAccountId)
      ?? storedByCoach.get(coachAccountId)
      ?? "cleared"
  }

  function chooseDate(dateKey: string) {
    if (!dateKey || dateKey === selectedDate) return
    // A save in flight holds the date where it is: moving on remounted the
    // roll call before the save answered, so a failure was never shown.
    if (isSaving) {
      setSelectionNotice({ message: waitForSaveMessage, tone: "info" })
      return
    }
    setSelectionNotice(null)
    if (drafts.length && !confirmDiscard(discardMarksPrompt)) return
    if (drafts.length) discardStaffAttendanceDraft(selectedDate)
    restoredExpectationsRef.current = new Map()
    setDrafts([])
    setFeedback(null)
    setSelectedDate(dateKey)
    router.replace(`/coach/attendance/staff/record?date=${encodeURIComponent(dateKey)}`, {
      scroll: false,
    })
  }

  function chooseAttendance(
    coachAccountId: string,
    choice: StaffAttendanceChoice,
  ) {
    if (isSaving || isChangingDate) return
    const base = storedByCoach.get(coachAccountId) ?? "cleared"
    const current = resolvedChoice(coachAccountId)
    const next = current === choice ? "cleared" : choice
    // Resolved against this render's `drafts`, exactly as `resolvedChoice` above
    // already is, so the next roll-call state is known here and can be stored on
    // the same tick it is shown.
    const rest = drafts.filter((draft) => draft.coachAccountId !== coachAccountId)
    const nextDrafts = next === base
      ? rest
      : [...rest, {
        choice: next,
        coachAccountId,
        dateKey: selectedDate,
        expectedChoice: base,
      }]
    setDrafts(nextDrafts)
    restoredExpectationsRef.current.delete(coachAccountId)
    setDraftKeptOnDevice(persistStaffAttendanceDraft(
      selectedDate,
      keepMarkedExpectations(
        nextDrafts,
        (draft) => draft.coachAccountId,
        restoredExpectationsRef.current,
      ),
    ))
    setFeedback(null)
  }

  async function saveRollCall() {
    if (cannotSave) return
    setIsSaving(true)
    setFeedback(null)
    try {
      const result = await withSaveDeadline(
        saveStaffAttendanceAction({ changes: drafts }),
        saveDeadlineMs,
      )
      if (!result.ok) {
        setFeedback({
          ...describeRefusedSave(result, {
            // Read back rather than assumed: `chooseAttendance` persists on
            // every mark, but a device that refused the write leaves the coach
            // holding marks that only exist on this screen.
            marksOnDevice: () => readStaffAttendanceDraft(selectedDate).length > 0,
            place: "date",
            subject: "Staff attendance",
          }),
          tone: "error",
        })
        return
      }
      setRecords((current) => {
        const changed = new Set(drafts.map((draft) => draft.coachAccountId))
        return [
          ...current.filter((record) => !changed.has(record.coachAccountId)),
          ...drafts.map((draft) => ({
            choice: draft.choice,
            coachAccountId: draft.coachAccountId,
          })),
        ]
      })
      discardStaffAttendanceDraft(selectedDate)
      restoredExpectationsRef.current = new Map()
      setDrafts([])
      setFeedback({ message: "Staff attendance saved", tone: "success" })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "Staff attendance could not be saved",
        // The service skips a mark the day already holds, so a repeat of a
        // save that did land changes nothing.
        repeatable: true,
        retained: "Your marks are still on screen",
        subject: "Staff attendance",
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

  return (
    <div className="coach-calendar coach-attendance-workspace page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Staff attendance navigation">
        <Link href="/coach#attendance"><ArrowLeft aria-hidden="true" /> Back to Attendance</Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Staff attendance</span>
          <h1 id="staff-roll-call-title">Staff roll call</h1>
        </div>
      </header>

      <section
        className="attendance-record-workspace staff-roll-call staff-roll-call-ledger"
        aria-labelledby="staff-roll-call-title"
      >
        <div className="attendance-record-date-row">
          <label>
            <span>Roll-call date</span>
            <input
              name="attendanceDate"
              type="date"
              max={referenceDate}
              value={selectedDate}
              onChange={(event) => chooseDate(event.target.value)}
            />
          </label>
          <p>{formatDateKey(selectedDate, { year: "numeric" })}</p>
        </div>
        {selectionNotice ? (
          <InlineNotice
            message={selectionNotice.message}
            reserveSpace={false}
            tone={selectionNotice.tone}
          />
        ) : null}

        <div className="attendance-record-section-heading staff-roll-call-heading">
          <div>
            <span>Daily staff record</span>
            <h2>Assistant coaches</h2>
          </div>
          <strong>{juniorCoaches.length}</strong>
        </div>

        {isChangingDate ? (
          <div className="attendance-record-empty is-roster" role="status">
            <CalendarDays aria-hidden="true" />
            <h3>Loading roll call…</h3>
            <p>Checking staff attendance for this date.</p>
          </div>
        ) : !juniorCoaches.length ? (
          <div className="attendance-record-empty is-roster">
            <UsersRound aria-hidden="true" />
            <h3>No assistant coaches yet.</h3>
            <p>Provisioned staff will appear here for daily roll call.</p>
          </div>
        ) : (
          <div className="staff-roll-call-list">
            <div className="staff-roll-call-register-head" aria-hidden="true">
              <span>No.</span>
              <span>Coach</span>
              <span>Attendance status</span>
            </div>
            {juniorCoaches.map((coach, index) => {
              const unavailable = futureDate || selectedDate < coach.joinedOn
              const currentChoice = resolvedChoice(coach.accountId)
              const folio = String(index + 1).padStart(2, "0")
              return (
                <article key={coach.accountId}>
                  <span className="staff-roll-call-folio" aria-hidden="true">{folio}</span>
                  <div className="staff-roll-call-person">
                    <div>
                      <strong>{coach.fullName}</strong>
                      <small>{unavailable
                        ? futureDate ? "Future date" : `Joined ${formatDateKey(coach.joinedOn)}`
                        : "Assistant coach"}</small>
                    </div>
                  </div>
                  <div
                    className="staff-roll-call-choice-box"
                    role="group"
                    aria-label={`Attendance for ${coach.fullName}`}
                  >
                    {/* `unavailable` stays on `disabled`: it is a property of
                        the date rather than of a press, and it would otherwise
                        leave two dead tab stops per coach on every date they
                        cannot be marked on. The in-flight save is carried on
                        `aria-disabled` alone, for the reason the save button
                        below is: macOS Safari and Firefox do not move focus to
                        a button on click, so a coach who marks with the
                        keyboard and then clicks Save is still standing on a
                        choice button when the save disables it, and a disabled
                        element hands focus to `<body>`. `chooseAttendance`
                        re-checks `isSaving`, so a press that still lands does
                        nothing. */}
                    {choices.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        className={currentChoice === choice.value ? `is-${choice.value}` : undefined}
                        aria-pressed={currentChoice === choice.value}
                        disabled={unavailable}
                        aria-disabled={unavailable || isSaving}
                        onClick={() => chooseAttendance(coach.accountId, choice.value)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <div className="attendance-record-footer">
          <InlineNotice
            action={feedback?.signIn}
            message={feedback?.message ?? (drafts.length
              ? `${drafts.length} unsaved ${drafts.length === 1 ? "change" : "changes"}`
              : undefined)}
            tone={feedback?.tone ?? (drafts.length ? "info" : undefined)}
          />
          <button
            type="button"
            aria-busy={isSaving}
            aria-disabled={cannotSave}
            tabIndex={saveOutOfReach ? -1 : undefined}
            onClick={saveRollCall}
          >
            {feedback?.offerRetry
              ? <RotateCcw aria-hidden="true" />
              : <Check aria-hidden="true" />}
            {isSaving
              ? "Saving…"
              : feedback?.offerRetry ? "Save staff attendance again" : "Save staff attendance"}
          </button>
        </div>
      </section>
    </div>
  )
}
