"use client"

import { ArrowLeft, Check, UsersRound } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { saveStaffAttendanceAction } from "@/app/coach/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
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

  function resolvedChoice(coachAccountId: string) {
    return draftByCoach.get(coachAccountId)
      ?? storedByCoach.get(coachAccountId)
      ?? "cleared"
  }

  function chooseDate(dateKey: string) {
    if (!dateKey || dateKey === selectedDate) return
    if (drafts.length && !confirmDiscard()) return
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
    setDrafts((current) => {
      const rest = current.filter((draft) => draft.coachAccountId !== coachAccountId)
      return next === base
        ? rest
        : [...rest, {
          choice: next,
          coachAccountId,
          dateKey: selectedDate,
          expectedChoice: base,
        }]
    })
    setFeedback(null)
  }

  async function saveRollCall() {
    if (!drafts.length || isSaving) return
    setIsSaving(true)
    setFeedback(null)
    try {
      const result = await saveStaffAttendanceAction({ changes: drafts })
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
      setDrafts([])
      setFeedback({ message: "Staff attendance saved", tone: "success" })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Staff attendance could not be saved",
        tone: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const futureDate = selectedDate > referenceDate

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
                    {choices.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        className={currentChoice === choice.value ? `is-${choice.value}` : undefined}
                        aria-pressed={currentChoice === choice.value}
                        disabled={unavailable || isSaving}
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
            message={drafts.length
              ? `${drafts.length} unsaved ${drafts.length === 1 ? "change" : "changes"}`
              : feedback?.message}
            tone={drafts.length ? "info" : feedback?.tone}
          />
          <button
            type="button"
            disabled={!drafts.length || isSaving || futureDate}
            onClick={saveRollCall}
          >
            <Check aria-hidden="true" /> {isSaving ? "Saving…" : "Save staff attendance"}
          </button>
        </div>
      </section>
    </div>
  )
}
