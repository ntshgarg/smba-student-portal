"use client"

import { ArrowLeft, Check, RotateCcw, UsersRound } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { saveStaffAttendanceAction } from "@/app/coach/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  discardStaffAttendanceDraft,
  persistStaffAttendanceDraft,
  readStaffAttendanceDraft,
  rebaseRestoredAttendanceDraft,
  restoredAttendanceDraftNotice,
} from "@/lib/client/attendance-draft-storage"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
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
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

/**
 * Shorter than the player register's deadline: one day of junior coaches is a
 * handful of changes with fewer validation queries each, so a healthy save
 * settles sooner. Still far above a slow-network round trip. It is a deadline,
 * not a cancellation — see `withSaveDeadline`.
 */
const saveDeadlineMs = 15_000

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
  const [isSaving, setIsSaving] = useState(false)
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: drafts.length > 0,
    message: "Leave this date and discard the unsaved staff attendance changes?",
    scope: "staff-roll-call",
  })
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
  const cannotSave = !drafts.length || isSaving || futureDate
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
  // Read after the mounting render rather than during it, as the report resume
  // hint is (`components/coach/reports/report-resume.ts`), so the server-rendered
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
    const timer = window.setTimeout(() => {
      const restored = readStaffAttendanceDraft(selectedDate)
      if (!restored.length) return
      const rebased = rebaseRestoredAttendanceDraft(
        restored,
        (change) => storedByCoach.get(change.coachAccountId) ?? "cleared",
      )
      if (!rebased.changes.length) return
      setDrafts(rebased.changes)
      setFeedback({
        message: restoredAttendanceDraftNotice(
          rebased.changes.length,
          "save staff attendance",
          rebased.changedUnderneath,
        ),
        tone: "info",
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [selectedDate, storedByCoach])

  function resolvedChoice(coachAccountId: string) {
    return draftByCoach.get(coachAccountId)
      ?? storedByCoach.get(coachAccountId)
      ?? "cleared"
  }

  function chooseDate(dateKey: string) {
    if (!dateKey || dateKey === selectedDate) return
    if (drafts.length && !confirmDiscard()) return
    if (drafts.length) discardStaffAttendanceDraft(selectedDate)
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
    if (isSaving) return
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
    persistStaffAttendanceDraft(selectedDate, nextDrafts)
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
        setFeedback({ message: result.message, tone: "error" })
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
      setDrafts([])
      setFeedback({ message: "Staff attendance saved", tone: "success" })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "Staff attendance could not be saved",
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

        <div className="attendance-record-section-heading staff-roll-call-heading">
          <div>
            <span>Daily staff record</span>
            <h2>Junior coaches</h2>
          </div>
          <strong>{juniorCoaches.length}</strong>
        </div>

        {!juniorCoaches.length ? (
          <div className="attendance-record-empty is-roster">
            <UsersRound aria-hidden="true" />
            <h3>No junior coaches yet.</h3>
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
                        : "Junior coach"}</small>
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
