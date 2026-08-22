"use client"

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Save,
  Send,
  X,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"

import { calculateMonthlyAttendance } from "@/lib/attendance/domain"
import {
  useAttendancePortal,
  useMemberPortal,
  useReportPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  shouldPersistResumeForDirtyTransition,
  useReportResume,
} from "@/components/coach/reports/report-resume"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  formatReportMonth,
  getCoachReportState,
  getCurrentIndiaMonth,
  getLatestCompletedReportMonth,
  shiftReportMonth,
} from "@/lib/coach/report-utils"
import type {
  CoachMonthlyReportRecord,
  CoachProfile,
  CoachReportAttendance,
  OperationalPlayerMemberRecord,
} from "@/lib/coach/types"
import { formatAcademyDate } from "@/lib/format"
import { REPORT_TEXT_MAX_LENGTH } from "@/lib/reports/contracts"
import type { TrainingProgramme } from "@/lib/sessions/types"

type ReportState = ReturnType<typeof getCoachReportState>

const stateLabels: Record<ReportState, string> = {
  "not-started": "Not started",
  draft: "Draft",
  revision: "Revision draft",
  published: "Published",
}
const reportCategories: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult"]

function reportCategory(player: OperationalPlayerMemberRecord) {
  return player.training.level
}

function formatPublishDate(value: string) {
  return formatAcademyDate(value, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function attendanceLabel(attendance: CoachReportAttendance) {
  if (!attendance.recorded) return attendance.pending ? "Attendance pending" : "Not recorded"
  const recorded = `${attendance.attended} of ${attendance.recorded} recorded sessions`
  return attendance.pending ? `${recorded} · ${attendance.pending} pending` : recorded
}

function getReportAttendance(
  player: OperationalPlayerMemberRecord,
  month: string,
  records: ReturnType<typeof useAttendancePortal>["attendanceRecords"],
  assignments: ReturnType<typeof useSessionPortal>["sessionAssignments"],
  occurrences: ReturnType<typeof useSessionPortal>["sessionOccurrences"],
  adjustments: ReturnType<typeof useAttendancePortal>["attendanceAdjustments"],
  referenceInstant: string,
): CoachReportAttendance {
  const playerAssignments = assignments.filter((assignment) => assignment.playerId === player.member.id)
  const monthOccurrences = occurrences.filter((occurrence) => occurrence.occurrenceDate.startsWith(`${month}-`))
  return calculateMonthlyAttendance({
    month,
    referenceDate: getIndiaDateKey(new Date(referenceInstant)),
    referenceInstant,
    joinedOn: player.member.joinedAt,
    assignments: playerAssignments,
    occurrences: monthOccurrences,
    records: monthOccurrences.flatMap((occurrence) => {
      const choice = records[occurrence.id]?.[player.member.id]
      return choice ? [{ occurrenceId: occurrence.id, choice }] : []
    }),
    adjustments: adjustments
      .filter((adjustment) => (
        adjustment.playerId === player.member.id && adjustment.voidedAt === null
      ))
      .map((adjustment) => ({
        id: adjustment.id,
        sourceOccurrenceId: adjustment.sourceOccurrenceId,
      })),
  })
}

function ReportPreview({
  attendance,
  coach,
  month,
  onClose,
  player,
  reportText,
}: {
  attendance: CoachReportAttendance
  coach: CoachProfile
  month: string
  onClose: () => void
  player: OperationalPlayerMemberRecord
  reportText: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow

    if (dialog && !dialog.open) dialog.showModal()
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog?.open) dialog.close()
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="coach-report-preview-backdrop"
      aria-labelledby="report-preview-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="coach-report-preview"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p id="report-preview-title" className="sr-only">
          {formatReportMonth(month)} monthly report preview for {player.member.fullName}
        </p>
        <button
          ref={closeButtonRef}
          className="coach-report-preview-close"
          type="button"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X aria-hidden="true" />
        </button>
        <div className="coach-report-letterhead">
          <Image src="/images/smba-logo.jpeg" alt="SMBA" width={720} height={488} />
          <span>Monthly development report</span>
        </div>
        <div className="coach-report-preview-heading">
          <p>{formatReportMonth(month)}</p>
          <h2>{player.member.fullName}</h2>
          <dl>
            <div>
              <dt>Program</dt>
              <dd>{reportCategory(player)}</dd>
            </div>
            <div>
              <dt>Attendance</dt>
              <dd>{attendanceLabel(attendance)}</dd>
            </div>
            <div>
              <dt>Coach</dt>
              <dd>{coach.fullName}</dd>
            </div>
          </dl>
        </div>
        <div className="coach-report-preview-copy">
          {reportText.trim()
            ? reportText.trim().split(/\n\s*\n/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)
            : <p className="is-empty">The coach’s report will appear here.</p>}
        </div>
      </section>
    </dialog>
  )
}

type ReportEditorFeedback = ActionFeedback & {
  field?: "reportText"
}

function ReportEditor({
  attendance,
  coach,
  headingRef,
  month,
  onResume,
  onDirtyChange,
  onPendingActionChange,
  pendingAction,
  player,
  report,
  requiresAdjustmentReview,
}: {
  attendance: CoachReportAttendance
  coach: CoachProfile
  headingRef: RefObject<HTMLHeadingElement | null>
  month: string
  onResume: () => void
  onDirtyChange: (dirty: boolean) => void
  onPendingActionChange: (pending: "draft" | "publish" | null) => void
  pendingAction: "draft" | "publish" | null
  player: OperationalPlayerMemberRecord
  report?: CoachMonthlyReportRecord
  requiresAdjustmentReview: boolean
}) {
  const { publishReport, saveReportDraft } = useReportPortal()
  const [reportText, setReportText] = useState(report?.reportText ?? "")
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [feedback, setFeedback] = useState<ReportEditorFeedback | null>(null)
  const dirtyRef = useRef(false)
  const reportTextRef = useRef<HTMLTextAreaElement>(null)
  const publicationKeyRef = useRef<string | null>(null)
  const fieldId = `report-${player.member.id}-${month}`
  const feedbackId = `${fieldId}-feedback`
  const reportTextInvalid = feedback?.tone === "error" && feedback.field === "reportText"
  const published = report?.published
  const isPublished = Boolean(published)
  const adjustmentReviewMessage = "Attendance includes a make-up adjustment that requires review. Publish this report with the current attendance record?"

  function focusReportText() {
    window.setTimeout(() => reportTextRef.current?.focus(), 0)
  }

  function updateReportText(nextText: string) {
    const dirty = nextText !== (report?.reportText ?? "")
    setReportText(nextText)
    publicationKeyRef.current = null
    if (dirty !== dirtyRef.current) {
      const becameDirty = shouldPersistResumeForDirtyTransition(dirtyRef.current, dirty)
      dirtyRef.current = dirty
      onDirtyChange(dirty)
      if (becameDirty) onResume()
    }
    setFeedback(dirty ? { message: "Unsaved changes", tone: "info" } : null)
  }

  async function saveDraft() {
    if (pendingAction !== null) return
    onPendingActionChange("draft")
    try {
      const result = await saveReportDraft({
        month,
        playerId: player.member.id,
        reportText,
      })
      if (!result.ok) {
        setFeedback({
          field: result.field === "reportText" ? "reportText" : undefined,
          message: result.message,
          tone: "error",
        })
        if (result.field === "reportText") focusReportText()
        return
      }
      dirtyRef.current = false
      onDirtyChange(false)
      onResume()
      setFeedback({ message: "Draft saved", tone: "success" })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The draft could not be saved",
        tone: "error",
      })
    } finally {
      onPendingActionChange(null)
    }
  }

  async function publish() {
    if (pendingAction !== null) return
    if (!reportText.trim()) {
      setFeedback({
        field: "reportText",
        message: "Write the coach’s report before publishing",
        tone: "error",
      })
      focusReportText()
      return
    }
    if (requiresAdjustmentReview && !window.confirm(adjustmentReviewMessage)) return

    onPendingActionChange("publish")
    try {
      publicationKeyRef.current ??= window.crypto.randomUUID()
      let result = await publishReport({
        confirmAdjustmentReview: requiresAdjustmentReview,
        month,
        playerId: player.member.id,
        publicationKey: publicationKeyRef.current,
        reportText: reportText.trim(),
      })
      if (!result.ok && result.code === "ADJUSTMENT_REVIEW_REQUIRED") {
        if (!window.confirm(adjustmentReviewMessage)) {
          setFeedback({ message: result.message, tone: "error" })
          return
        }
        result = await publishReport({
          confirmAdjustmentReview: true,
          month,
          playerId: player.member.id,
          publicationKey: publicationKeyRef.current,
          reportText: reportText.trim(),
        })
      }
      if (!result.ok) {
        setFeedback({
          field: result.field === "reportText" ? "reportText" : undefined,
          message: result.message,
          tone: "error",
        })
        if (result.field === "reportText") focusReportText()
        return
      }
      publicationKeyRef.current = null
      setReportText(result.report.reportText)
      dirtyRef.current = false
      onDirtyChange(false)
      onResume()
      setFeedback({
        message: isPublished ? "Updated report published" : "Report published",
        tone: "success",
      })
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The report could not be published",
        tone: "error",
      })
    } finally {
      onPendingActionChange(null)
    }
  }

  return (
    <article className="coach-report-editor" aria-labelledby="coach-report-editor-title">
      <div className="coach-report-editor-heading">
        <div>
          <span>{formatReportMonth(month)}</span>
          <h2 ref={headingRef} id="coach-report-editor-title" tabIndex={-1}>{player.member.fullName}</h2>
          <p>{reportCategory(player)}</p>
        </div>
        <div className="coach-report-editor-state">
          <span className={`status-${getCoachReportState(report)}`}>{stateLabels[getCoachReportState(report)]}</span>
          {published ? <small>Published {formatPublishDate(published.updatedAt)}</small> : <small>Not yet published</small>}
        </div>
      </div>

      <dl className="coach-report-attendance-summary">
        <div>
          <dt>Attendance</dt>
          <dd>{attendanceLabel(attendance)}</dd>
        </div>
        <div>
          <dt>Recorded rate</dt>
          <dd>{attendance.percentage === null ? "—" : `${attendance.percentage}%`}</dd>
        </div>
      </dl>

      <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
        <label className="coach-report-field" htmlFor={fieldId}>
          <span>
            <strong>Coach’s report</strong>
            <small>Required to publish. One or two clear paragraphs. Maximum 5,000 characters.</small>
          </span>
          <textarea
            ref={reportTextRef}
            id={fieldId}
            name="reportText"
            rows={10}
            maxLength={REPORT_TEXT_MAX_LENGTH}
            disabled={pendingAction !== null}
            value={reportText}
            aria-invalid={reportTextInvalid || undefined}
            aria-describedby={reportTextInvalid ? feedbackId : undefined}
            placeholder="Write what changed, what became consistent, and what the player should carry into the next month."
            onChange={(event) => updateReportText(event.target.value)}
          />
        </label>

        <div className="coach-report-editor-footer">
          <InlineNotice
            className="coach-report-editor-notice"
            id={feedbackId}
            message={feedback?.message}
            tone={feedback?.tone}
          />
          <div className="coach-report-editor-actions">
            <button className="coach-report-action is-quiet" type="button" disabled={pendingAction !== null} onClick={() => void saveDraft()}>
              <Save aria-hidden="true" /> {pendingAction === "draft" ? "Saving…" : "Save draft"}
            </button>
            <button className="coach-report-action is-quiet" type="button" disabled={pendingAction !== null} onClick={() => setIsPreviewOpen(true)}>
              <Eye aria-hidden="true" /> Preview
            </button>
            <button className="coach-report-action is-primary" type="button" disabled={pendingAction !== null} onClick={() => void publish()}>
              <Send aria-hidden="true" /> {pendingAction === "publish"
                ? isPublished ? "Updating…" : "Publishing…"
                : isPublished ? "Update report" : "Publish report"}
            </button>
          </div>
        </div>
      </form>

      {isPreviewOpen ? (
        <ReportPreview
          attendance={attendance}
          coach={coach}
          month={month}
          onClose={() => setIsPreviewOpen(false)}
          player={player}
          reportText={reportText}
        />
      ) : null}
    </article>
  )
}

export function ReportWritingWorkspace({
  coach,
  initialMonth,
  initialPlayerId,
}: {
  coach: CoachProfile
  initialMonth?: string
  initialPlayerId?: string
}) {
  const { activePlayers: players } = useMemberPortal()
  const {
    attendanceAdjustments,
    attendanceRecords,
  } = useAttendancePortal()
  const { reports } = useReportPortal()
  const {
    sessionAssignments,
    sessionOccurrences,
  } = useSessionPortal()
  const playerById = useMemo(
    () => new Map(players.map((player) => [player.member.id, player])),
    [players],
  )
  const reportByPlayerMonth = useMemo(
    () => new Map(reports.map((report) => [`${report.playerId}:${report.month}`, report])),
    [reports],
  )
  const occurrenceById = useMemo(
    () => new Map(sessionOccurrences.map((occurrence) => [occurrence.id, occurrence])),
    [sessionOccurrences],
  )
  const router = useRouter()
  const { resumePoint, setReportResume } = useReportResume()
  const validInitialMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth ?? "")
    && (initialMonth as string) < getCurrentIndiaMonth()
    ? initialMonth as string
    : getLatestCompletedReportMonth()
  const initialPlayer = (initialPlayerId ? playerById.get(initialPlayerId) : undefined)
    ?? players.find((player) => (
      getCoachReportState(reportByPlayerMonth.get(
        `${player.member.id}:${validInitialMonth}`,
      )) !== "published"
    ))
    ?? players[0]
  const month = validInitialMonth
  const [category, setCategory] = useState(initialPlayer ? reportCategory(initialPlayer) : "Beginner")
  const [selectedPlayerId, setSelectedPlayerId] = useState(initialPlayer?.member.id ?? "")
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorPendingAction, setEditorPendingAction] = useState<"draft" | "publish" | null>(null)
  const [queueOpen, setQueueOpen] = useState(() => !(initialPlayerId || resumePoint))
  const editorHeadingRef = useRef<HTMLHeadingElement>(null)
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty: editorDirty,
    message: "You have unsaved changes. Leave this report without saving?",
    scope: "coach-report-editor",
  })
  const categories = useMemo(() => {
    const populated = new Set(players.map(reportCategory))
    return reportCategories.filter((item) => populated.has(item))
  }, [players])
  const currentMonth = getCurrentIndiaMonth()
  const previewReferenceInstant = useMemo(() => new Date().toISOString(), [])

  const reportStateByPlayer = useMemo(() => new Map(players.map((player) => {
    const report = reportByPlayerMonth.get(`${player.member.id}:${month}`)
    return [player.member.id, { report, state: getCoachReportState(report) }] as const
  })), [month, players, reportByPlayerMonth])

  const queue = useMemo(() => players
    .filter((player) => reportCategory(player) === category)
    .map((player) => {
      const reportState = reportStateByPlayer.get(player.member.id)
      return {
        player,
        report: reportState?.report,
        state: reportState?.state ?? "not-started" as ReportState,
      }
    })
    .sort((a, b) => {
      if (a.player.member.id === resumePoint?.playerId && month === resumePoint.month) return -1
      if (b.player.member.id === resumePoint?.playerId && month === resumePoint.month) return 1
      const stateOrder: Record<ReportState, number> = {
        revision: 0,
        draft: 1,
        "not-started": 2,
        published: 3,
      }
      if (stateOrder[a.state] !== stateOrder[b.state]) return stateOrder[a.state] - stateOrder[b.state]
      return a.player.member.fullName.localeCompare(b.player.member.fullName)
    }), [category, month, players, reportStateByPlayer, resumePoint])

  const unfinishedCount = [...reportStateByPlayer.values()].filter(
    ({ state }) => state !== "published",
  ).length
  const completedCount = players.length - unfinishedCount
  const isComplete = players.length > 0 && completedCount === players.length
  const selectedPlayer = playerById.get(selectedPlayerId) ?? players[0]
  const selectedReport = selectedPlayer
    ? reportStateByPlayer.get(selectedPlayer.member.id)?.report
    : undefined
  const canResumeElsewhere = Boolean(resumePoint
    && (resumePoint.playerId !== selectedPlayer?.member.id || resumePoint.month !== month))
  const attendance = selectedPlayer
    ? getReportAttendance(
        selectedPlayer,
        month,
        attendanceRecords,
        sessionAssignments,
        sessionOccurrences,
        attendanceAdjustments,
        previewReferenceInstant,
      )
    : { eligible: 0, recorded: 0, attended: 0, absent: 0, pending: 0, percentage: null }
  const requiresAdjustmentReview = Boolean(selectedPlayer && attendanceAdjustments.some((adjustment) => {
    if (adjustment.playerId !== selectedPlayer.member.id
      || adjustment.voidedAt !== null
      || adjustment.reviewRequiredAt === null) return false
    const source = occurrenceById.get(adjustment.sourceOccurrenceId)
    return source?.occurrenceDate.startsWith(`${month}-`) ?? false
  }))

  function canLeaveEditor() {
    if (editorPendingAction !== null) return false
    return !editorDirty || confirmDiscard()
  }

  function updateReportUrl(nextMonth: string, playerId: string) {
    const params = new URLSearchParams(window.location.search)
    params.set("month", nextMonth)
    params.set("player", playerId)
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}`,
    )
  }

  function navigateToReportMonth(nextMonth: string, playerId: string) {
    const params = new URLSearchParams(window.location.search)
    params.set("month", nextMonth)
    params.set("player", playerId)
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false })
  }

  function focusEditorOnMobile() {
    setQueueOpen(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!window.matchMedia("(max-width: 720px)").matches) return
        const heading = editorHeadingRef.current
        if (!heading) return
        heading.focus({ preventScroll: true })
        heading.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        })
      })
    })
  }

  function choosePlayer(playerId: string) {
    if (editorPendingAction !== null || (playerId !== selectedPlayerId && !canLeaveEditor())) return
    if (playerId !== selectedPlayerId) {
      setSelectedPlayerId(playerId)
    }
    setEditorDirty(false)
    setReportResume({ month, playerId })
    updateReportUrl(month, playerId)
    focusEditorOnMobile()
  }

  function chooseCategory(nextCategory: ReturnType<typeof reportCategory>) {
    if (nextCategory === category || !canLeaveEditor()) return
    const categoryPlayers = players.filter((player) => reportCategory(player) === nextCategory)
    const firstPlayer = categoryPlayers.find((player) => (
      reportStateByPlayer.get(player.member.id)?.state !== "published"
    )) ?? categoryPlayers[0]
    if (!firstPlayer) return

    setCategory(nextCategory)
    setSelectedPlayerId(firstPlayer.member.id)
    setEditorDirty(false)
    setReportResume({ month, playerId: firstPlayer.member.id })
    updateReportUrl(month, firstPlayer.member.id)
  }

  function chooseMonth(nextMonth: string) {
    if (!canLeaveEditor()) return
    setEditorDirty(false)
    const playerId = selectedPlayerId || players[0]?.member.id
    if (playerId) {
      setReportResume({ month: nextMonth, playerId })
      navigateToReportMonth(nextMonth, playerId)
    }
  }

  function continueFromResume() {
    if (!resumePoint || !canLeaveEditor()) return
    if (resumePoint.month !== month) {
      setEditorDirty(false)
      navigateToReportMonth(resumePoint.month, resumePoint.playerId)
      return
    }
    const resumePlayer = playerById.get(resumePoint.playerId)
    setSelectedPlayerId(resumePoint.playerId)
    if (resumePlayer) setCategory(reportCategory(resumePlayer))
    setEditorDirty(false)
    updateReportUrl(resumePoint.month, resumePoint.playerId)
    focusEditorOnMobile()
  }

  if (!selectedPlayer) {
    return (
      <div className="coach-reports-workspace page-shell">
        <div className="coach-reports-back-row">
          <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
        </div>
        <section className="coach-reports-empty-state">
          <span className="eyebrow">Player development</span>
          <h1>Write reports</h1>
          <p>Players will appear here after they are assigned to a recurring training session.</p>
          <Link href="/coach/schedules">Open Schedules</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="coach-reports-workspace page-shell">
      <div className="coach-reports-back-row">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className="coach-reports-workspace-header">
        <div>
          <span className="eyebrow">Player development</span>
          <h1>Write reports</h1>
        </div>

        <div className="coach-report-month-control" aria-label="Choose report month">
          <button type="button" disabled={editorPendingAction !== null} onClick={() => chooseMonth(shiftReportMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft aria-hidden="true" />
          </button>
          <div>
            <span>Reporting month</span>
            <strong>{formatReportMonth(month)}</strong>
          </div>
          <button
            type="button"
            disabled={editorPendingAction !== null || shiftReportMonth(month, 1) >= currentMonth}
            onClick={() => chooseMonth(shiftReportMonth(month, 1))}
            aria-label="Next month"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="coach-report-workspace-grid">
        <aside className={`coach-report-queue-panel${queueOpen ? "" : " is-collapsed"}`} aria-labelledby="report-queue-title">
          <div className="coach-report-queue-heading">
            <div>
              <span>Monthly checklist</span>
              <div className="coach-report-completion-title">
                <h2 id="report-queue-title">{completedCount}/{players.length} reports done</h2>
                {isComplete ? <Check aria-label="All monthly reports published" /> : null}
              </div>
            </div>
            {canResumeElsewhere ? (
              <button className="coach-report-resume-action" type="button" disabled={editorPendingAction !== null} onClick={continueFromResume}>Continue where I left off</button>
            ) : null}
            <button
              className="coach-report-queue-toggle"
              type="button"
              disabled={editorPendingAction !== null}
              aria-expanded={queueOpen}
              aria-controls="coach-report-player-picker"
              onClick={() => setQueueOpen((current) => !current)}
            >
              {queueOpen ? "Hide checklist" : "Change player"}
              <ChevronDown aria-hidden="true" />
            </button>
          </div>

          <div id="coach-report-player-picker" className="coach-report-queue-options">
            <div className="coach-category-filter" aria-label="Filter players by programme category">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={editorPendingAction !== null}
                  className={item === category ? "is-active" : undefined}
                  aria-pressed={item === category}
                  onClick={() => chooseCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="coach-report-player-list">
              {queue.map(({ player, state }) => (
                <button
                  key={player.member.id}
                  type="button"
                  disabled={editorPendingAction !== null}
                  className={player.member.id === selectedPlayer.member.id ? "is-active" : undefined}
                  aria-current={player.member.id === selectedPlayer.member.id ? "true" : undefined}
                  onClick={() => choosePlayer(player.member.id)}
                >
                  <span className="coach-report-list-avatar" aria-hidden="true">{player.member.initials}</span>
                  <span>
                    <strong>{player.member.fullName}</strong>
                    <small>{reportCategory(player)}</small>
                  </span>
                  <em className={`status-${state}`}>
                    {state === "published" ? <Check aria-hidden="true" /> : null}
                    {stateLabels[state]}
                  </em>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <ReportEditor
          key={`${selectedPlayer.member.id}-${month}`}
          attendance={attendance}
          coach={coach}
          headingRef={editorHeadingRef}
          month={month}
          onResume={() => setReportResume({ month, playerId: selectedPlayer.member.id })}
          onDirtyChange={setEditorDirty}
          onPendingActionChange={setEditorPendingAction}
          pendingAction={editorPendingAction}
          player={selectedPlayer}
          report={selectedReport}
          requiresAdjustmentReview={requiresAdjustmentReview}
        />
      </div>
    </div>
  )
}
