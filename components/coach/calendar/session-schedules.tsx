"use client"

import {
  ArrowLeft,
  ArrowUpRight,
  CalendarX2,
  ChevronDown,
  MapPin,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  assignmentKey,
  buildProgrammeGroups,
  buildSessionScheduleIndex,
} from "@/components/coach/calendar/session-schedule-index"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import {
  SESSION_LABEL_SEPARATOR,
  formatSessionLabel,
  sessionLabelParts,
} from "@/lib/format"
import { distinctAssignmentWeekdays } from "@/lib/sessions/domain"
import type {
  SessionAssignment,
  TrainingProgramme,
  TrainingSessionSeries,
} from "@/lib/sessions/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

const weekdays = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
]

type EndingFeedback = ActionFeedback & {
  offerRetry?: boolean
  seriesId: string
}

function assignmentDayLabel(assignedDays: number[]) {
  return weekdays
    .filter((day) => assignedDays.includes(day.value))
    .map((day) => day.short)
    .join(", ")
}

function activeAssignedWeekdays(assignments: SessionAssignment[]) {
  return distinctAssignmentWeekdays(assignments
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

/*
 * Schedules & rosters shows who is on each schedule, and lets the head coach
 * end a whole schedule. It no longer adds or removes single players: a
 * player's first schedule is chosen in onboarding's Session step, and later
 * changes move to the player's row in Members (head coach, 5 Oct 2026), so
 * each job has one place and a second way in cannot quietly backdate a start.
 * `?player=` still opens that player's schedules.
 */
export function SessionSchedules({
  initialPlayerId = null,
  initialProgramme = null,
  initialSeriesId = null,
}: {
  initialPlayerId?: string | null
  initialProgramme?: TrainingProgramme | null
  initialSeriesId?: string | null
}) {
  const { players } = useMemberPortal()
  const {
    endSessionSeries,
    sessionAssignments,
    sessionSeries,
  } = useSessionPortal()
  const playerById = useMemo(
    () => new Map(players.map((player) => [player.member.id, player])),
    [players],
  )
  const seriesById = useMemo(
    () => new Map(sessionSeries.map((series) => [series.id, series])),
    [sessionSeries],
  )
  const assignmentIndex = useMemo(
    () => buildSessionScheduleIndex(sessionAssignments),
    [sessionAssignments],
  )
  const requestedSeries = initialSeriesId
    ? seriesById.get(initialSeriesId) ?? null
    : null
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(requestedSeries?.id ?? null)
  const [expandedProgramme, setExpandedProgramme] = useState<TrainingProgramme | null>(
    requestedSeries?.programme ?? initialProgramme,
  )
  const [endingSeriesId, setEndingSeriesId] = useState<string | null>(null)
  const [endingFeedback, setEndingFeedback] = useState<EndingFeedback | null>(null)
  const hasPendingMutation = endingSeriesId !== null
  const programmeGroups = useMemo(
    () => buildProgrammeGroups(sessionSeries, assignmentIndex.activeBySeries),
    [assignmentIndex.activeBySeries, sessionSeries],
  )
  const guidedPlayer = useMemo(() => initialPlayerId
    ? playerById.get(initialPlayerId) ?? null
    : null, [initialPlayerId, playerById])
  const guidedActiveAssignments = useMemo(() => guidedPlayer
    ? assignmentIndex.activeByPlayer.get(guidedPlayer.member.id) ?? []
    : [], [assignmentIndex.activeByPlayer, guidedPlayer])
  const guidedAssignedWeekdays = guidedPlayer
    ? activeAssignedWeekdays(guidedActiveAssignments)
    : []
  const guidanceHeadingRef = useRef<HTMLDivElement>(null)
  const handledGuidanceRef = useRef(false)

  useEffect(() => {
    if (handledGuidanceRef.current || !guidedPlayer) return
    const frame = window.requestAnimationFrame(() => {
      if (handledGuidanceRef.current) return
      handledGuidanceRef.current = true
      const assignedSeries = seriesById.get(guidedActiveAssignments[0]?.seriesId ?? "")
      if (assignedSeries) {
        setExpandedProgramme(assignedSeries.programme)
        setExpandedSeriesId(assignedSeries.id)
      }
      guidanceHeadingRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [guidedActiveAssignments, guidedPlayer, seriesById])

  function replaceExpandedScheduleUrl(
    programme: TrainingProgramme | null,
    seriesId: string | null,
  ) {
    const params = new URLSearchParams(window.location.search)
    if (programme) params.set("programme", programme)
    else params.delete("programme")
    if (seriesId) params.set("series", seriesId)
    else params.delete("series")
    const query = params.toString()
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    )
  }

  function toggleProgramme(programme: TrainingProgramme) {
    if (hasPendingMutation) return
    const nextProgramme = expandedProgramme === programme ? null : programme
    setExpandedProgramme(nextProgramme)
    setExpandedSeriesId(null)
    replaceExpandedScheduleUrl(nextProgramme, null)
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
          <span>Player schedules</span>
          <strong>{guidedPlayer.member.fullName}</strong>
          <p>
            {guidedPlayer.training.level} · {guidedPlayer.training.batch} · {academyPlanLabel(guidedPlayer.training.academyPlan)}. {guidedActiveAssignments.length
              ? `On ${guidedActiveAssignments.length === 1 ? "one schedule" : `${guidedActiveAssignments.length} schedules`}${guidedAssignedWeekdays.length ? ` for ${assignmentDayLabel(guidedAssignedWeekdays)}` : ""}. Schedule changes for a player are made from Members.`
              : "Not on any schedule. A first schedule is set in Player onboarding."}
          </p>
        </div>
      ) : null}

      <section className="coach-series-rosters coach-schedules-rosters" aria-labelledby="series-rosters-title">
        <div className="coach-series-rosters-heading">
          <span>Session assignments</span>
          <h2 id="series-rosters-title">Recurring sessions &amp; rosters</h2>
        </div>
        {programmeGroups.length ? programmeGroups.map((group) => {
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
          const roster = (assignmentIndex.activeBySeries.get(series.id) ?? []).flatMap(
            (assignment) => playerById.get(assignment.playerId) ?? [],
          )
          const seriesEndingFeedback = endingFeedback?.seriesId === series.id && endingFeedback.offerRetry
            ? endingFeedback
            : null
          const endingRetryIsSeries = Boolean(seriesEndingFeedback)
          return (
            <article className="coach-series-roster-card" key={series.id}>
              <button type="button" disabled={hasPendingMutation} aria-expanded={isExpanded} onClick={() => {
                const opening = !isExpanded
                setExpandedProgramme(series.programme)
                setExpandedSeriesId(opening ? series.id : null)
                replaceExpandedScheduleUrl(series.programme, opening ? series.id : null)
              }}>
                <span>
                  <strong>{(() => {
                    /* Same split the coach hero uses. The label ends in a clock
                       range and the browser will break inside it -- at 320 this
                       row read "Adult · Weekend · 10-" over "11 am", and four
                       more orphaned a two-character meridiem onto a second line
                       while up to 12px of the first sat empty. */
                    const { context, range } = sessionLabelParts(seriesLabel(series))
                    return range ? (
                      <>
                        {context}
                        {SESSION_LABEL_SEPARATOR}
                        <span className="session-label-range">{range}</span>
                      </>
                    ) : seriesLabel(series)
                  })()}</strong>
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
                      const assignment = assignmentIndex.activeByPlayerSeries.get(
                        assignmentKey(player.member.id, series.id),
                      )
                      return (
                        <div key={player.member.id}>
                          <span className="coach-roster-initials">{player.member.initials}</span>
                          <span>
                            <strong>{player.member.fullName}</strong>
                            <small>From {assignment?.effectiveFrom} · {assignmentDayLabel(assignment?.weekdays ?? [])}</small>
                          </span>
                        </div>
                      )
                    }) : <p>No players on this schedule. Players are added in Player onboarding.</p>}
                  </div>
                  <InlineNotice
                    className="coach-roster-end-notice"
                    message={endingFeedback?.seriesId === series.id ? endingFeedback.message : null}
                    reserveSpace={false}
                    tone={endingFeedback?.seriesId === series.id ? endingFeedback.tone : "info"}
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
                        const failure = describeSaveFailure({
                          error,
                          fallbackMessage: "Schedule could not be ended",
                          retained: "The schedule is still active",
                          subject: "The schedule ending",
                        })
                        setEndingFeedback({
                          message: failure.message,
                          offerRetry: failure.offerRetry,
                          seriesId: series.id,
                          tone: "error",
                        })
                      } finally {
                        setEndingSeriesId(null)
                      }
                    }}
                  >
                    <CalendarX2 aria-hidden="true" /> {endingSeriesId === series.id
                      ? "Ending schedule…"
                      : endingRetryIsSeries ? "End schedule again" : "End schedule"}
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
            <p>No schedules yet. Create the first recurring schedule, then add players to it in Player onboarding.</p>
            <Link href="/coach/schedules/new">Create schedule</Link>
          </div>
        )}
      </section>
    </div>
  )
}
