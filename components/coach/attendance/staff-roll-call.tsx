"use client"

import { Check, ChevronRight, RotateCcw, UsersRound, X } from "lucide-react"
import type { Ref } from "react"
import { useEffect, useImperativeHandle, useMemo, useState } from "react"

import { saveStaffAttendanceAction } from "@/app/coach/actions"
import {
  InlineNotice,
  type ActionFeedback,
  type InlineNoticeAction,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import {
  discardStaffAttendanceDraft,
  leftOutAttendanceDraftNotice,
  persistStaffAttendanceDraft,
  readStaffAttendanceDraft,
  rebaseRestoredAttendanceDraft,
  restoredAttendanceDraftNotice,
} from "@/lib/client/attendance-draft-storage"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { describeRefusedSave, feedbackAfterMark } from "@/lib/client/session-expiry"
import type {
  StaffAttendanceChange,
  StaffAttendanceChoice,
} from "@/lib/coach/staff-attendance"
import { formatDateKey } from "@/lib/format"

import styles from "./mark.module.css"

export type StaffMember = {
  accountId: string
  fullName: string
  initials: string
  joinedOn: string
}

export type StaffRecord = {
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
 * `release` hands it back to `confirmDiscard` explicitly: the surface message
 * the guard uses for everything else becomes the expiry's own wording while a
 * refused save stands, and that wording must not reach this path. Confirming
 * here really does discard the marks -- `release` clears the stored draft for
 * the date -- so "kept on this device" would be a lie exactly where it costs a
 * register.
 */
const discardMarksPrompt = "Leave this date and discard the unsaved staff attendance changes?"

/** Leaving the page keeps a stored draft; closing the card or changing the date discards it. */
const keptMarksPrompt = "Leave this date? Your unsaved marks are kept on this device"
  + " and come back when you open it again."

/** Shown when the head coach tries to leave the card while a save is running. */
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
 * What the Mark tab asks of the open staff card before it opens another card or
 * changes the date: `release` answers false while a save is running or when the
 * coach keeps the unsaved marks, and otherwise discards them and answers true.
 */
export type StaffRollCallHandle = {
  release: () => boolean
}

/** Saved marks out of the coaches who can be marked on the day. */
export function staffRollCallProgress({
  dateKey,
  juniorCoaches,
  records,
}: {
  dateKey: string
  juniorCoaches: StaffMember[]
  records: StaffRecord[]
}) {
  const markable = juniorCoaches.filter((coach) => dateKey >= coach.joinedOn)
  const marked = new Set(records
    .filter((record) => record.choice !== "cleared")
    .map((record) => record.coachAccountId))
  return {
    marked: markable.filter((coach) => marked.has(coach.accountId)).length,
    total: markable.length,
  }
}

/**
 * The day's staff roll call, the first card on the Mark tab. It opens in place
 * like a session; the tab keeps one card open at a time and asks this one to
 * `release` its marks before it opens another or changes the date.
 */
export function StaffRollCall({
  closedFor,
  dateKey,
  initialRecords,
  juniorCoaches,
  onToggle,
  open,
  ref,
  referenceDate,
}: {
  /** The holiday's name when the academy was closed on this date. */
  closedFor: string | null
  dateKey: string
  initialRecords: StaffRecord[]
  juniorCoaches: StaffMember[]
  onToggle: () => void
  open: boolean
  ref?: Ref<StaffRollCallHandle>
  referenceDate: string
}) {
  const [records, setRecords] = useState(initialRecords)
  const [drafts, setDrafts] = useState<StaffAttendanceChange[]>([])
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  // Answers a card or date change held back by a save.
  const [selectionNotice, setSelectionNotice] = useState<ActionFeedback | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // Whether the device holds the marks on screen, from the last write or a restore.
  const [draftKeptOnDevice, setDraftKeptOnDevice] = useState<boolean | undefined>(undefined)
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: drafts.length > 0,
    // Leaving the *page* discards nothing while an expiry stands: the marks are
    // on the device, the notice has just said so, and this register is the one
    // place they cannot be saved from. The guard still confirms -- only the
    // sentence changes, and only once the draft has been read back out of
    // storage. See `describeRefusedSave`.
    message: feedback?.leaveConfirmation
      ?? (draftKeptOnDevice ? keptMarksPrompt : discardMarksPrompt),
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
  const futureDate = dateKey > referenceDate
  // Nothing is marked on a closed day; a mark saved before the closure is
  // kept, uncounted and hidden, and returns if the holiday is removed.
  const closedDay = Boolean(closedFor)
  // Carried on the save button as `aria-disabled` rather than `disabled`:
  // disabling the element that currently holds focus hands focus to `<body>`,
  // and it is the coach's own press that disables it — so every save, including
  // the failure whose "Save staff attendance again" below is the way back, would
  // send the next Tab to the top of the document. `saveRollCall` reads the same
  // constant, so a press that still reaches the handler does nothing.
  const cannotSave = !drafts.length || isSaving || futureDate || closedDay
  // `aria-disabled` on its own would leave the button a permanent tab stop
  // whose press is a silent no-op, and the footer renders on a future date and
  // with nothing marked yet. So only the in-flight save keeps it tabbable: that
  // is the one state the coach is already standing on, and `tabindex="-1"` does
  // not blur an element that already holds focus, so the save that just emptied
  // `drafts` still hands the next Tab to the control after this one.
  const saveOutOfReach = cannotSave && !isSaving
  const progress = staffRollCallProgress({ dateKey, juniorCoaches, records })

  // The roll call is one day of marks, so the stored copy is keyed by date and
  // can only ever return to the date it was made for — yesterday's marks cannot
  // surface on today's register. Restoring is announced rather than silent:
  // these are unsaved marks, not the saved record. It waits for the card to
  // open, as a session's register waits to be chosen, so marks never come back
  // into a card the coach cannot see.
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
    if (!open || closedDay) return
    const timer = window.setTimeout(() => {
      const stored = readStaffAttendanceDraft(dateKey)
      if (!stored.length) return
      // Only marks for coaches this roll call can mark come back; others are named.
      const markable = new Set(juniorCoaches
        .filter((coach) => dateKey >= coach.joinedOn && dateKey <= referenceDate)
        .map((coach) => coach.accountId))
      const restored = stored.filter((change) => markable.has(change.coachAccountId))
      const leftOut = stored.length - restored.length
      const rebased = rebaseRestoredAttendanceDraft(
        restored,
        (change) => storedByCoach.get(change.coachAccountId) ?? "cleared",
      )
      if (!rebased.changes.length) {
        if (leftOut) {
          discardStaffAttendanceDraft(dateKey)
          setFeedback({
            message: leftOutAttendanceDraftNotice(leftOut),
            tone: "info",
          })
        }
        return
      }
      setDrafts(rebased.changes)
      setDraftKeptOnDevice(true)
      setFeedback({
        message: restoredAttendanceDraftNotice(
          rebased.changes.length,
          "save staff attendance",
          rebased.changedUnderneath,
          leftOut,
        ),
        tone: "info",
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [closedDay, dateKey, juniorCoaches, open, referenceDate, storedByCoach])

  // A save in flight holds the card open, so its outcome can be shown.
  useImperativeHandle(ref, () => ({
    release() {
      if (isSaving) {
        setSelectionNotice({ message: waitForSaveMessage, tone: "info" })
        return false
      }
      setSelectionNotice(null)
      if (drafts.length && !confirmDiscard(discardMarksPrompt)) return false
      if (drafts.length) discardStaffAttendanceDraft(dateKey)
      setDrafts([])
      setFeedback(null)
      return true
    },
  }))

  function resolvedChoice(coachAccountId: string) {
    if (closedDay) return "cleared"
    return draftByCoach.get(coachAccountId)
      ?? storedByCoach.get(coachAccountId)
      ?? "cleared"
  }

  function chooseAttendance(
    coachAccountId: string,
    choice: StaffAttendanceChoice,
  ) {
    if (isSaving || closedDay) return
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
        dateKey,
        expectedChoice: base,
      }]
    setDrafts(nextDrafts)
    setDraftKeptOnDevice(persistStaffAttendanceDraft(dateKey, nextDrafts))
    setFeedback(feedbackAfterMark)
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
            marksOnDevice: () => readStaffAttendanceDraft(dateKey).length > 0,
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
      discardStaffAttendanceDraft(dateKey)
      setDrafts([])
      setFeedback({ message: "Staff attendance saved", tone: "success" })
    } catch (error) {
      const failure = describeSaveFailure({
        error,
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

  const summary = closedDay
    ? `Academy closed · ${closedFor}`
    : open
      ? formatDateKey(dateKey)
      : juniorCoaches.map((coach) => coach.fullName).join(" · ") || "No assistant coaches yet"
  const counted = `${progress.marked}/${progress.total} marked`
  // The open band always counts, as a session's does; closed, the card says how far the day got.
  const [pillTone, pillLabel]: [string, string] = closedDay
    ? [open ? "band" : "muted", "Closed"]
    : futureDate
      ? [open ? "band" : "upcoming", "Upcoming"]
      : open
        ? ["band", counted]
        : !progress.total
          ? ["muted", "Nobody to mark"]
          : progress.marked === progress.total
            ? ["done", counted]
            : progress.marked ? ["part", counted] : ["todo", "Not marked"]

  return (
    <li className={`${styles.card}${open ? ` ${styles.open}` : ""}`}>
      <button
        type="button"
        className={styles.head}
        aria-controls="staff-roll-call-panel"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.kind}>Staff</span>
        <span className={styles.copy}>
          <strong id="staff-roll-call-title">Assistant coaches</strong>
          <small>{summary}</small>
        </span>
        <span className={`${styles.pill} ${styles[pillTone]}`}>
          {pillTone === "done" ? <Check aria-hidden="true" /> : null}
          {pillLabel}
        </span>
        <span className={styles.toggle} aria-hidden="true">
          {open ? <X /> : <ChevronRight />}
        </span>
      </button>

      {open ? (
        <section
          id="staff-roll-call-panel"
          className={styles.panel}
          aria-labelledby="staff-roll-call-title"
        >
          {selectionNotice ? (
            <InlineNotice
              message={selectionNotice.message}
              reserveSpace={false}
              tone={selectionNotice.tone}
            />
          ) : null}

          {!juniorCoaches.length ? (
            <div className={styles.empty}>
              <UsersRound aria-hidden="true" />
              <h3>No assistant coaches yet.</h3>
              <p>Provisioned staff will appear here for daily roll call.</p>
            </div>
          ) : (
            <ol className={styles.rows}>
              {juniorCoaches.map((coach) => {
                const unavailable = futureDate || closedDay || dateKey < coach.joinedOn
                const currentChoice = resolvedChoice(coach.accountId)
                return (
                  <li key={coach.accountId} className={styles.row}>
                    <span className={styles.badge} aria-hidden="true">{coach.initials}</span>
                    <span className={styles.person}>
                      <strong>{coach.fullName}</strong>
                      <small>{unavailable
                        ? futureDate
                          ? "Future date"
                          : closedDay ? "Academy closed" : `Joined ${formatDateKey(coach.joinedOn)}`
                        : "Assistant coach"}</small>
                    </span>
                    <span
                      className={styles.choices}
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
                          className={`${styles.choice} ${styles[choice.value]}`}
                          aria-pressed={currentChoice === choice.value}
                          disabled={unavailable}
                          aria-disabled={unavailable || isSaving}
                          onClick={() => chooseAttendance(coach.accountId, choice.value)}
                        >
                          {currentChoice === choice.value
                            ? choice.value === "present"
                              ? <Check aria-hidden="true" />
                              : <X aria-hidden="true" />
                            : null}
                          {choice.label}
                        </button>
                      ))}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          <div className={styles.footer}>
            <InlineNotice
              action={feedback?.signIn}
              message={feedback?.message ?? (drafts.length
                ? `${drafts.length} unsaved ${drafts.length === 1 ? "change" : "changes"}`
                : undefined)}
              tone={feedback?.tone ?? (drafts.length ? "info" : undefined)}
            />
            <button
              type="button"
              className={styles.save}
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
      ) : null}
    </li>
  )
}
