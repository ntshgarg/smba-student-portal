"use client"

import {
  ArrowLeft,
  ArrowUpRight,
  CalendarX2,
  Check,
  ChevronDown,
  MapPin,
  UserPlus,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { useCoachPortal } from "@/components/coach/coach-portal-provider"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { formatSessionLabel } from "@/lib/format"
import { assignmentCoversOccurrence, distinctAssignmentWeekdays } from "@/lib/sessions/domain"
import { occurrenceHasStarted } from "@/lib/sessions/occurrence-time"
import type {
  SessionAssignment,
  TrainingProgramme,
  TrainingSessionSeries,
} from "@/lib/sessions/types"
import {
  academyPlanAssignmentLimit,
  academyPlanLabel,
  academyPlanRequiredWeekdayCount,
} from "@/lib/training/academy-plans"

const programmes: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult"]
const weekdays = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
]

type RosterFeedback = ActionFeedback & {
  field?: string
  seriesId: string
}

type EndingFeedback = ActionFeedback & {
  seriesId: string
}

function earliestAssignmentDate(joinedOn: string, scheduleStartsOn: string) {
  return joinedOn > scheduleStartsOn ? joinedOn : scheduleStartsOn
}

function activeAssignmentForSeries(
  playerId: string,
  seriesId: string,
  assignments: ReturnType<typeof useCoachPortal>["sessionAssignments"],
) {
  return assignments.find((assignment) => (
    assignment.playerId === playerId
    && assignment.seriesId === seriesId
    && !assignment.effectiveTo
  ))
}

function assignmentDayLabel(assignedDays: number[]) {
  return weekdays
    .filter((day) => assignedDays.includes(day.value))
    .map((day) => day.short)
    .join(", ")
}

function activeAssignedWeekdays(playerId: string, assignments: SessionAssignment[]) {
  return distinctAssignmentWeekdays(assignments
    .filter((assignment) => assignment.playerId === playerId && !assignment.effectiveTo)
    .map((assignment) => assignment.weekdays))
}

function seriesLabel(series: TrainingSessionSeries) {
  const slot = series.slots[0]
  return formatSessionLabel({
    programme: series.programme,
    batch: series.batch,
    startTime: slot?.startTime ?? "",
    durationMinutes: slot?.durationMinutes ?? 0,
  })
}

export function SessionSchedules({
  guidedFromEvaluation = false,
  initialPlayerId = null,
  initialProgramme = null,
  initialSeriesId = null,
}: {
  guidedFromEvaluation?: boolean
  initialPlayerId?: string | null
  initialProgramme?: TrainingProgramme | null
  initialSeriesId?: string | null
}) {
  const {
    assignSession,
    endSessionAssignment,
    endSessionSeries,
    players,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useCoachPortal()
  const router = useRouter()
  const today = getIndiaDateKey()
  const requestedSeries = initialSeriesId
    ? sessionSeries.find((series) => series.id === initialSeriesId) ?? null
    : null
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(requestedSeries?.id ?? null)
  const [expandedProgramme, setExpandedProgramme] = useState<TrainingProgramme | null>(
    requestedSeries?.programme ?? initialProgramme,
  )
  const [assignPlayerId, setAssignPlayerId] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [assignWeekdays, setAssignWeekdays] = useState<number[]>([])
  const [assignmentTouched, setAssignmentTouched] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [endingAssignmentId, setEndingAssignmentId] = useState<string | null>(null)
  const [endingSeriesId, setEndingSeriesId] = useState<string | null>(null)
  const [rosterFeedback, setRosterFeedback] = useState<RosterFeedback | null>(null)
  const [endingFeedback, setEndingFeedback] = useState<EndingFeedback | null>(null)
  const hasPendingMutation = isAssigning
    || endingAssignmentId !== null
    || endingSeriesId !== null
  const assignmentIsDirty = assignmentTouched
    && Boolean(assignPlayerId || effectiveFrom || assignWeekdays.length)
  const assignmentGuard = useUnsavedWorkGuard({
    isDirty: assignmentIsDirty,
    message: "Leave without saving this player assignment?",
    scope: "coach-schedule-assignment",
  })
  const activeSeries = sessionSeries.filter((series) => series.status === "active")
  const programmeGroups = programmes
    .map((programme) => {
      const series = activeSeries.filter((item) => item.programme === programme)
      const seriesIds = new Set(series.map((item) => item.id))
      const playerCount = new Set(sessionAssignments
        .filter((assignment) => !assignment.effectiveTo && seriesIds.has(assignment.seriesId))
        .map((assignment) => assignment.playerId)).size

      return { playerCount, programme, series }
    })
    .filter((group) => group.series.length)
  const guidedPlayer = useMemo(() => initialPlayerId
    ? players.find((player) => player.member.id === initialPlayerId) ?? null
    : null, [initialPlayerId, players])
  const guidedEligibleSeries = useMemo(() => guidedPlayer ? sessionSeries.filter((series) => (
    series.status === "active"
    && series.programme === guidedPlayer.training.level
    && series.batch === guidedPlayer.training.batch
    && (!series.endsOn || guidedPlayer.member.joinedAt <= series.endsOn)
    && !activeAssignmentForSeries(guidedPlayer.member.id, series.id, sessionAssignments)
  )) : [], [guidedPlayer, sessionAssignments, sessionSeries])
  const guidedActiveAssignments = useMemo(() => guidedPlayer ? sessionAssignments.filter(
    (assignment) => assignment.playerId === guidedPlayer.member.id && !assignment.effectiveTo,
  ) : [], [guidedPlayer, sessionAssignments])
  const guidedAssignedWeekdays = guidedPlayer
    ? activeAssignedWeekdays(guidedPlayer.member.id, sessionAssignments)
    : []
  const guidedRequiredWeekdays = guidedPlayer?.training.academyPlan
    ? academyPlanRequiredWeekdayCount(guidedPlayer.training.academyPlan)
    : null
  const guidedCoverageComplete = guidedRequiredWeekdays === null
    ? Boolean(guidedActiveAssignments.length)
    : guidedAssignedWeekdays.length === guidedRequiredWeekdays
  const guidanceHeadingRef = useRef<HTMLDivElement>(null)
  const handledGuidanceRef = useRef(false)
  const assignmentPlayerRef = useRef<HTMLSelectElement>(null)
  const assignmentDaysRef = useRef<HTMLFieldSetElement>(null)
  const assignmentDateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (handledGuidanceRef.current || !initialPlayerId || !guidedPlayer) return
    if (guidedPlayer.training.level === "Assessment pending"
      || guidedPlayer.training.batch === "Assessment pending") return
    const frame = window.requestAnimationFrame(() => {
      if (handledGuidanceRef.current) return
      handledGuidanceRef.current = true
      setExpandedProgramme(guidedPlayer.training.level as TrainingProgramme)
      const requestedSeries = initialSeriesId
        ? guidedEligibleSeries.find((series) => series.id === initialSeriesId)
        : null
      const seriesToOpen = requestedSeries ?? (guidedEligibleSeries.length === 1
        ? guidedEligibleSeries[0]
        : null)
      if (seriesToOpen) {
        const series = seriesToOpen
        const offeredWeekdays = new Set(series.slots.map((slot) => slot.weekday))
        const activeAssignments = sessionAssignments.filter((assignment) => (
          assignment.playerId === guidedPlayer.member.id && !assignment.effectiveTo
        ))
        const preselectedWeekdays = guidedPlayer.training.academyPlan === "weekday-5-day"
          && !activeAssignments.length
          && [1, 2, 3, 4, 5].every((weekday) => offeredWeekdays.has(weekday))
          ? [1, 2, 3, 4, 5]
          : []

        setExpandedSeriesId(series.id)
        setAssignPlayerId(guidedPlayer.member.id)
        setEffectiveFrom(earliestAssignmentDate(guidedPlayer.member.joinedAt, series.startsOn))
        setAssignWeekdays(preselectedWeekdays)
        setAssignmentTouched(false)
        setRosterFeedback({
          message: guidedFromEvaluation
            ? "Evaluation saved. Confirm the player’s training days"
            : "Choose the player’s training days",
          seriesId: series.id,
          tone: "info",
        })
      } else if (!guidedEligibleSeries.length && guidedActiveAssignments.length) {
        const assignedSeries = sessionSeries.find((series) => (
          series.id === guidedActiveAssignments[0]?.seriesId
        ))
        if (assignedSeries) {
          setExpandedProgramme(assignedSeries.programme)
          setExpandedSeriesId(assignedSeries.id)
        }
      } else if (!guidedEligibleSeries.length) {
        const params = new URLSearchParams({
          programme: guidedPlayer.training.level,
          batch: guidedPlayer.training.batch,
          player: guidedPlayer.member.id,
          from: guidedFromEvaluation ? "evaluation" : "assignment",
        })
        router.replace(`/coach/schedules/new?${params.toString()}`)
        return
      }

      guidanceHeadingRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    guidedEligibleSeries,
    guidedActiveAssignments,
    guidedFromEvaluation,
    guidedPlayer,
    initialPlayerId,
    initialSeriesId,
    router,
    sessionAssignments,
    sessionSeries,
  ])

  useEffect(() => {
    if (rosterFeedback?.tone !== "error" || !rosterFeedback.field) return
    if (rosterFeedback.field === "playerId") assignmentPlayerRef.current?.focus()
    if (rosterFeedback.field === "effectiveFrom") assignmentDateRef.current?.focus()
    if (rosterFeedback.field === "weekdays") {
      assignmentDaysRef.current
        ?.querySelector<HTMLInputElement>("input:not(:disabled)")
        ?.focus()
    }
  }, [rosterFeedback])

  function clearAssignmentDraft() {
    setAssignPlayerId("")
    setEffectiveFrom("")
    setAssignWeekdays([])
    setAssignmentTouched(false)
  }

  function toggleProgramme(programme: TrainingProgramme) {
    if (hasPendingMutation || !assignmentGuard.confirmDiscard()) return
    setExpandedProgramme((current) => current === programme ? null : programme)
    setExpandedSeriesId(null)
    clearAssignmentDraft()
    setRosterFeedback(null)
  }

  function chooseAssignmentPlayer(
    playerId: string,
    series: TrainingSessionSeries,
    {
      confirmCurrentDraft = true,
      markTouched = true,
    }: { confirmCurrentDraft?: boolean; markTouched?: boolean } = {},
  ) {
    if (hasPendingMutation) return
    if (confirmCurrentDraft && playerId !== assignPlayerId && !assignmentGuard.confirmDiscard(
      "Discard this unfinished assignment and choose another player?",
    )) return
    setRosterFeedback(null)
    setAssignPlayerId(playerId)
    setAssignmentTouched(markTouched)
    const player = players.find((item) => item.member.id === playerId)
    if (!player) {
      setAssignWeekdays([])
      return setEffectiveFrom("")
    }
    const offeredWeekdays = new Set(series.slots.map((slot) => slot.weekday))
    const existingWeekdays = activeAssignedWeekdays(playerId, sessionAssignments)
    const preselectedWeekdays = player.training.academyPlan === "weekday-5-day"
      && !existingWeekdays.length
      && [1, 2, 3, 4, 5].every((weekday) => offeredWeekdays.has(weekday))
      ? [1, 2, 3, 4, 5]
      : []
    setAssignWeekdays(preselectedWeekdays)
    setEffectiveFrom(earliestAssignmentDate(player.member.joinedAt, series.startsOn))
  }

  function toggleAssignmentWeekday(
    weekday: number,
    limit: number,
    existingWeekdays: number[],
  ) {
    if (hasPendingMutation) return
    setAssignmentTouched(true)
    setRosterFeedback(null)
    if (assignWeekdays.includes(weekday)) {
      setAssignWeekdays((current) => current.filter((day) => day !== weekday))
      return
    }
    const projectedWeekdays = distinctAssignmentWeekdays([existingWeekdays, assignWeekdays, [weekday]])
    if (projectedWeekdays.length > limit) {
      if (expandedSeriesId) {
        setRosterFeedback({
          message: `This Academy Plan requires ${limit} distinct training days. Remove another day before adding this one`,
          seriesId: expandedSeriesId,
          tone: "info",
        })
      }
      return
    }
    setAssignWeekdays((current) => [...current, weekday].sort((first, second) => first - second))
  }

  async function assignPlayer(series: TrainingSessionSeries) {
    if (hasPendingMutation) return
    const player = players.find((item) => item.member.id === assignPlayerId)
    if (!player || !effectiveFrom || !assignWeekdays.length) return
    const existingWeekdays = activeAssignedWeekdays(player.member.id, sessionAssignments)
    const projectedWeekdays = distinctAssignmentWeekdays([existingWeekdays, assignWeekdays])
    const requiredWeekdays = player.training.academyPlan
      ? academyPlanRequiredWeekdayCount(player.training.academyPlan)
      : null
    if (requiredWeekdays !== null && projectedWeekdays.length !== requiredWeekdays) {
      setRosterFeedback({
        field: "weekdays",
        message: `${academyPlanLabel(player.training.academyPlan)} requires exactly ${requiredWeekdays} distinct weekdays across active schedules. ${projectedWeekdays.length} selected`,
        seriesId: series.id,
        tone: "error",
      })
      return
    }
    const earliestDate = earliestAssignmentDate(player.member.joinedAt, series.startsOn)
    const assignmentDate = effectiveFrom < earliestDate ? earliestDate : effectiveFrom
    const referenceInstant = new Date()
    if (assignmentDate !== effectiveFrom) setEffectiveFrom(assignmentDate)
    const backfillCount = sessionOccurrences.filter((occurrence) => (
      occurrence.status === "scheduled"
      && occurrence.occurrenceDate <= today
      && occurrenceHasStarted(occurrence, referenceInstant)
      && assignmentCoversOccurrence({
        seriesId: series.id,
        effectiveFrom: assignmentDate,
        effectiveTo: null,
        weekdays: assignWeekdays,
      }, occurrence)
    )).length
    const assignedDaysLabel = weekdays
      .filter((day) => assignWeekdays.includes(day.value))
      .map((day) => day.short)
      .join(", ")
    const confirmed = window.confirm(
      backfillCount
        ? `${backfillCount} past ${backfillCount === 1 ? "session" : "sessions"} on ${assignedDaysLabel} will become attendance-eligible for ${player.member.fullName}. Continue?`
        : `Assign ${player.member.fullName} to ${seriesLabel(series)} on ${assignedDaysLabel} from ${assignmentDate}?`,
    )
    if (!confirmed) return
    setIsAssigning(true)
    setRosterFeedback(null)
    try {
      const result = await assignSession({
        playerId: player.member.id,
        seriesId: series.id,
        effectiveFrom: assignmentDate,
        weekdays: assignWeekdays,
      })
      if (!result.ok) {
        setRosterFeedback({
          field: result.field,
          message: result.message,
          seriesId: series.id,
          tone: "error",
        })
        return
      }
      clearAssignmentDraft()
      setRosterFeedback({
        message: `${player.member.fullName} assigned to this schedule`,
        seriesId: series.id,
        tone: "success",
      })
    } catch (error) {
      setRosterFeedback({
        message: error instanceof Error ? error.message : "The player could not be assigned",
        seriesId: series.id,
        tone: "error",
      })
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <div className="coach-calendar page-shell">
      <nav className="coach-calendar-back-row coach-route-nav" aria-label="Schedule navigation">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
        <Link href="/coach/calendar">Calendar <ArrowUpRight aria-hidden="true" /></Link>
      </nav>

      <header className="coach-calendar-header">
        <div>
          <span className="eyebrow">Training configuration</span>
          <h1>Schedules &amp; Rosters</h1>
        </div>
        <Link className="coach-calendar-header-action" href="/coach/schedules/new">
          Create schedule <ArrowUpRight aria-hidden="true" />
        </Link>
      </header>

      {guidedPlayer ? (
        <div
          ref={guidanceHeadingRef}
          className="coach-assignment-guidance"
          tabIndex={-1}
        >
          <span>{guidedFromEvaluation ? "Evaluation complete" : "Player assignment"}</span>
          <strong>Assign sessions for {guidedPlayer.member.fullName}</strong>
          <p>
            {guidedPlayer.training.level} · {guidedPlayer.training.batch} · {academyPlanLabel(guidedPlayer.training.academyPlan)}. {guidedCoverageComplete
              ? `Training week set${guidedAssignedWeekdays.length ? ` for ${assignmentDayLabel(guidedAssignedWeekdays)}` : ""}. Add another time slot only if needed.`
              : guidedEligibleSeries.length
                ? guidedEligibleSeries.length === 1
                  ? "The matching schedule is ready below."
                  : "Choose the matching time slot below."
                : "Create a matching recurring schedule first."}
          </p>
        </div>
      ) : null}

      <section className="coach-series-rosters coach-schedules-rosters" aria-labelledby="series-rosters-title">
        <div className="coach-series-rosters-heading">
          <span>Session assignments</span>
          <h2 id="series-rosters-title">Recurring sessions &amp; rosters</h2>
        </div>
        {activeSeries.length ? programmeGroups.map((group) => {
          const isProgrammeOpen = expandedProgramme === group.programme
          const programmeContentId = `schedule-programme-${group.programme.toLowerCase()}`
          const groupSummary = `${group.series.length} ${group.series.length === 1 ? "schedule" : "schedules"} · ${group.playerCount} ${group.playerCount === 1 ? "player" : "players"}`

          return (
            <section className="coach-schedule-programme-group" key={group.programme}>
              <div className="coach-schedule-programme-heading">
                <h3>{group.programme}</h3>
                <p>{groupSummary}</p>
              </div>
              <h3 className="coach-schedule-programme-toggle-heading">
                <button
                  type="button"
                  disabled={hasPendingMutation}
                  aria-expanded={isProgrammeOpen}
                  aria-controls={programmeContentId}
                  onClick={() => toggleProgramme(group.programme)}
                >
                  <span>
                    <strong>{group.programme}</strong>
                    <small>{groupSummary}</small>
                  </span>
                  <ChevronDown aria-hidden="true" />
                </button>
              </h3>
              <div
                className="coach-schedule-programme-content"
                id={programmeContentId}
                data-expanded={isProgrammeOpen}
              >
                {group.series.map((series) => {
          const isExpanded = expandedSeriesId === series.id
          const roster = players.filter((player) => Boolean(
            activeAssignmentForSeries(player.member.id, series.id, sessionAssignments),
          ))
          const availablePlayers = players.filter((player) => (
            player.training.level === series.programme
            && player.training.batch === series.batch
            && (!series.endsOn || player.member.joinedAt <= series.endsOn)
            && !activeAssignmentForSeries(player.member.id, series.id, sessionAssignments)
          ))
          const selectedAssignmentPlayer = availablePlayers.find((player) => (
            player.member.id === assignPlayerId
          ))
          const assignmentDayLimit = selectedAssignmentPlayer?.training.academyPlan
            ? academyPlanAssignmentLimit(selectedAssignmentPlayer.training.academyPlan)
            : 0
          const requiredWeekdays = selectedAssignmentPlayer?.training.academyPlan
            ? academyPlanRequiredWeekdayCount(selectedAssignmentPlayer.training.academyPlan)
            : null
          const existingAssignedWeekdays = selectedAssignmentPlayer
            ? activeAssignedWeekdays(selectedAssignmentPlayer.member.id, sessionAssignments)
            : []
          const projectedAssignedWeekdays = distinctAssignmentWeekdays([
            existingAssignedWeekdays,
            assignWeekdays,
          ])
          const assignmentCoverageComplete = requiredWeekdays === null
            ? Boolean(assignWeekdays.length && projectedAssignedWeekdays.length <= assignmentDayLimit)
            : projectedAssignedWeekdays.length === requiredWeekdays
          const seriesWeekdays = weekdays.filter((day) => (
            series.slots.some((slot) => slot.weekday === day.value)
          ))
          const assignmentFeedbackId = `assignment-feedback-${series.id}`
          return (
            <article className="coach-series-roster-card" key={series.id}>
              <button type="button" disabled={hasPendingMutation} aria-expanded={isExpanded} onClick={() => {
                if (!assignmentGuard.confirmDiscard()) return
                const opening = !isExpanded
                setExpandedProgramme(series.programme)
                setExpandedSeriesId(opening ? series.id : null)
                clearAssignmentDraft()
                setRosterFeedback(null)
                if (opening && guidedPlayer && availablePlayers.some((player) => (
                  player.member.id === guidedPlayer.member.id
                ))) {
                  chooseAssignmentPlayer(guidedPlayer.member.id, series, {
                    confirmCurrentDraft: false,
                    markTouched: false,
                  })
                }
              }}>
                <span>
                  <strong>{seriesLabel(series)}</strong>
                </span>
                <span><Users aria-hidden="true" /> {roster.length} {roster.length === 1 ? "player" : "players"} <ChevronDown aria-hidden="true" /></span>
              </button>
              {isExpanded ? (
                <div className="coach-series-roster-detail">
                  <div className="coach-series-rhythm">
                    {series.slots.map((slot) => (
                      <span key={slot.id}>{weekdays.find((day) => day.value === slot.weekday)?.short} · {slot.startTime}</span>
                    ))}
                    <span><MapPin aria-hidden="true" /> {series.venue}</span>
                  </div>
                  <div className="coach-roster-list">
                    {roster.length ? roster.map((player) => {
                      const assignment = activeAssignmentForSeries(
                        player.member.id,
                        series.id,
                        sessionAssignments,
                      )
                      return (
                        <div key={player.member.id}>
                          <span className="coach-roster-initials">{player.member.initials}</span>
                          <span>
                            <strong>{player.member.fullName}</strong>
                            <small>From {assignment?.effectiveFrom} · {assignmentDayLabel(assignment?.weekdays ?? [])}</small>
                          </span>
                          <button type="button" onClick={async () => {
                            if (hasPendingMutation || !assignment || !window.confirm(`End ${player.member.fullName}’s assignment to ${seriesLabel(series)} from today?`)) return
                            setEndingAssignmentId(assignment.id)
                            setEndingFeedback(null)
                            setRosterFeedback(null)
                            try {
                              const result = await endSessionAssignment({
                                assignmentId: assignment.id,
                                effectiveTo: today,
                              })
                              if (!result.ok) {
                                setEndingFeedback({
                                  message: result.message,
                                  seriesId: series.id,
                                  tone: "error",
                                })
                                return
                              }
                              setEndingFeedback({
                                message: `${player.member.fullName} removed from this schedule`,
                                seriesId: series.id,
                                tone: "success",
                              })
                            } catch (error) {
                              setEndingFeedback({
                                message: error instanceof Error ? error.message : "Assignment could not be ended",
                                seriesId: series.id,
                                tone: "error",
                              })
                            } finally {
                              setEndingAssignmentId(null)
                            }
                          }} disabled={hasPendingMutation}>
                            {endingAssignmentId === assignment?.id ? "Ending…" : "End"}
                          </button>
                        </div>
                      )
                    }) : <p>No players assigned yet.</p>}
                  </div>
                  <InlineNotice
                    className="coach-roster-end-notice"
                    message={endingFeedback?.seriesId === series.id ? endingFeedback.message : null}
                    tone={endingFeedback?.seriesId === series.id ? endingFeedback.tone : "info"}
                  />
                  <div className="coach-roster-assign">
                    <div><UserPlus aria-hidden="true" /><span><strong>Add an eligible player</strong><small>Showing only {series.programme} · {series.batch} players.</small></span></div>
                    <label>
                      <span>Player</span>
                      <select ref={assignmentPlayerRef} disabled={hasPendingMutation} value={assignPlayerId} aria-invalid={rosterFeedback?.seriesId === series.id && rosterFeedback.field === "playerId" || undefined} aria-describedby={rosterFeedback?.seriesId === series.id && rosterFeedback.field === "playerId" ? assignmentFeedbackId : undefined} onChange={(event) => chooseAssignmentPlayer(event.target.value, series)}>
                        <option value="">Choose eligible player</option>
                        {availablePlayers.map((player) => <option key={player.member.id} value={player.member.id}>{player.member.fullName}</option>)}
                      </select>
                    </label>
                    {assignPlayerId ? (
                      <fieldset
                        ref={assignmentDaysRef}
                        className="coach-assignment-days"
                        aria-invalid={rosterFeedback?.seriesId === series.id && rosterFeedback.field === "weekdays" || undefined}
                        aria-describedby={[
                          `assignment-limit-${series.id}`,
                          rosterFeedback?.seriesId === series.id ? assignmentFeedbackId : null,
                        ].filter(Boolean).join(" ")}
                      >
                        <legend>Which days will this player attend?</legend>
                        <p id={`assignment-limit-${series.id}`}>
                          {selectedAssignmentPlayer?.training.academyPlan
                            ? requiredWeekdays === null
                              ? `${academyPlanLabel(selectedAssignmentPlayer.training.academyPlan)} · choose one or two session days`
                              : `${academyPlanLabel(selectedAssignmentPlayer.training.academyPlan)} · ${projectedAssignedWeekdays.length} of ${requiredWeekdays} distinct weekdays covered across active schedules`
                            : <>Complete this player’s Training plan in{" "}
                                <Link href={`/coach/onboarding?player=${encodeURIComponent(assignPlayerId)}`}>
                                  Player Onboarding
                                </Link> before assigning days.</>}
                        </p>
                        <div>
                          {seriesWeekdays.map((day) => {
                            const selected = assignWeekdays.includes(day.value)
                            const addsDistinctWeekday = !selected
                              && !existingAssignedWeekdays.includes(day.value)
                            const atLimit = projectedAssignedWeekdays.length >= assignmentDayLimit
                            return (
                              <label key={day.value} className={selected ? "is-selected" : undefined}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={hasPendingMutation
                                    || !assignmentDayLimit
                                    || (addsDistinctWeekday && atLimit)}
                                  onChange={() => toggleAssignmentWeekday(
                                    day.value,
                                    assignmentDayLimit,
                                    existingAssignedWeekdays,
                                  )}
                                />
                                <span>{day.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>
                    ) : null}
                    <label>
                      <span>Effective from</span>
                      <input
                        ref={assignmentDateRef}
                        type="date"
                        disabled={!assignPlayerId || hasPendingMutation}
                        min={assignPlayerId
                          ? earliestAssignmentDate(
                              players.find((player) => player.member.id === assignPlayerId)?.member.joinedAt ?? series.startsOn,
                              series.startsOn,
                            )
                          : undefined}
                        max={series.endsOn ?? undefined}
                        value={effectiveFrom}
                        aria-invalid={rosterFeedback?.seriesId === series.id && rosterFeedback.field === "effectiveFrom" || undefined}
                        aria-describedby={rosterFeedback?.seriesId === series.id && rosterFeedback.field === "effectiveFrom" ? assignmentFeedbackId : undefined}
                        onChange={(event) => {
                          const player = players.find((item) => item.member.id === assignPlayerId)
                          const minimum = earliestAssignmentDate(player?.member.joinedAt ?? series.startsOn, series.startsOn)
                          setAssignmentTouched(true)
                          setEffectiveFrom(event.target.value < minimum ? minimum : event.target.value)
                        }}
                      />
                    </label>
                    <button type="button" disabled={!assignPlayerId
                      || !effectiveFrom
                      || !assignWeekdays.length
                      || !assignmentCoverageComplete
                      || hasPendingMutation} onClick={() => assignPlayer(series)}>
                      <Check aria-hidden="true" /> {isAssigning ? "Assigning…" : "Confirm assignment"}
                    </button>
                    {!availablePlayers.length ? <p className="coach-roster-eligibility-note">No additional players currently match this level and batch.</p> : null}
                  </div>
                  <InlineNotice
                    className="coach-roster-inline-notice"
                    id={assignmentFeedbackId}
                    message={rosterFeedback?.seriesId === series.id ? rosterFeedback.message : null}
                    tone={rosterFeedback?.seriesId === series.id ? rosterFeedback.tone : "info"}
                  />
                  <button
                    className="coach-series-end-action"
                    type="button"
                    disabled={hasPendingMutation}
                    onClick={async () => {
                      if (hasPendingMutation || !window.confirm(
                        `End ${seriesLabel(series)} now? Upcoming sessions will be cancelled and every player will be removed from this schedule. This cannot be undone.`,
                      )) return
                      setEndingSeriesId(series.id)
                      setEndingFeedback(null)
                      setRosterFeedback(null)
                      try {
                        const result = await endSessionSeries(series.id)
                        if (!result.ok) {
                          setEndingFeedback({
                            message: result.message,
                            seriesId: series.id,
                            tone: "error",
                          })
                        }
                      } catch (error) {
                        setEndingFeedback({
                          message: error instanceof Error ? error.message : "Schedule could not be ended",
                          seriesId: series.id,
                          tone: "error",
                        })
                      } finally {
                        setEndingSeriesId(null)
                      }
                    }}
                  >
                    <CalendarX2 aria-hidden="true" /> {endingSeriesId === series.id ? "Ending schedule…" : "End schedule"}
                  </button>
                </div>
              ) : null}
            </article>
          )
                })}
              </div>
            </section>
          )
        }) : (
          <div className="coach-series-rosters-empty">
            <p>Create the first recurring schedule before assigning players.</p>
            <Link href="/coach/schedules/new">Create schedule</Link>
          </div>
        )}
      </section>
    </div>
  )
}
