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
  EndSchedulePanel,
  endScheduleSummary,
  monthName,
} from "@/components/coach/calendar/end-schedule-panel"
import {
  assignmentKey,
  buildFinishedSchedules,
  buildProgrammeGroups,
  buildSessionScheduleIndex,
  scheduleGroupKey,
  type ScheduleGroupKey,
} from "@/components/coach/calendar/session-schedule-index"
import { termFinishedMembersHref } from "@/components/coach/members/member-directory-query"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import {
  SESSION_LABEL_SEPARATOR,
  formatDateKey,
  formatSessionLabel,
  sessionLabelParts,
} from "@/lib/format"
import { distinctAssignmentWeekdays } from "@/lib/sessions/domain"
import { formatTermDate, scheduleTermFinished } from "@/lib/sessions/term"
import type { EndScheduleResult } from "@/lib/sessions/service"
import type {
  SessionAssignment,
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

function shortDate(dateKey: string) {
  return formatDateKey(dateKey, { month: "short", weekday: undefined, year: "numeric" })
}

/** "1 Apr 2026 – 31 Oct 2026": a schedule's first and last day. */
function scheduleDates(series: TrainingSessionSeries) {
  return series.endsOn
    ? `${shortDate(series.startsOn)} – ${shortDate(series.endsOn)}`
    : `From ${shortDate(series.startsOn)}`
}

function countLabel(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
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
 *
 * A schedule whose last day has passed keeps its players until the head coach
 * moves them on (head coach, 12 Nov 2026), so it moves to a "Finished" group
 * below the running ones rather than looking like one. `today` is the
 * academy's today from the server.
 */
export function SessionSchedules({
  initialPlayerId = null,
  initialPlayerInOnboarding = false,
  initialProgramme = null,
  initialSeriesId = null,
  today,
}: {
  initialPlayerId?: string | null
  initialPlayerInOnboarding?: boolean
  initialProgramme?: ScheduleGroupKey | null
  initialSeriesId?: string | null
  today: string
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
  const [expandedProgramme, setExpandedProgramme] = useState<ScheduleGroupKey | null>(
    requestedSeries ? scheduleGroupKey(requestedSeries, today) : initialProgramme,
  )
  const [endingSeriesId, setEndingSeriesId] = useState<string | null>(null)
  const [endingFeedback, setEndingFeedback] = useState<EndingFeedback | null>(null)
  // The schedule whose End schedule panel is open, and what the last End
  // schedule did, shown above the rosters because the ended schedule leaves
  // them.
  const [confirmingSeriesId, setConfirmingSeriesId] = useState<string | null>(null)
  const [endedSummary, setEndedSummary] = useState<{ closeout: EndScheduleResult; label: string } | null>(null)
  const hasPendingMutation = endingSeriesId !== null
  const programmeGroups = useMemo(
    () => buildProgrammeGroups(sessionSeries, assignmentIndex.activeBySeries, today),
    [assignmentIndex.activeBySeries, sessionSeries, today],
  )
  const finishedGroup = useMemo(
    () => buildFinishedSchedules(sessionSeries, assignmentIndex.activeBySeries, today),
    [assignmentIndex.activeBySeries, sessionSeries, today],
  )
  const guidedPlayer = useMemo(() => initialPlayerId
    ? playerById.get(initialPlayerId) ?? null
    : null, [initialPlayerId, playerById])
  const guidedActiveAssignments = useMemo(() => guidedPlayer
    ? assignmentIndex.activeByPlayer.get(guidedPlayer.member.id) ?? []
    : [], [assignmentIndex.activeByPlayer, guidedPlayer])
  // A place on a schedule that has run out is still open, but the player is
  // not training on it, so the note counts only the others as their schedules.
  const guidedFinishedAssignments = useMemo(() => guidedActiveAssignments.filter((assignment) => {
    const series = seriesById.get(assignment.seriesId)
    return series ? scheduleTermFinished(series, today) : false
  }), [guidedActiveAssignments, seriesById, today])
  const guidedCurrentAssignments = useMemo(() => guidedActiveAssignments.filter((assignment) => (
    !guidedFinishedAssignments.includes(assignment)
  )), [guidedActiveAssignments, guidedFinishedAssignments])
  const guidedAssignedWeekdays = guidedPlayer
    ? activeAssignedWeekdays(guidedCurrentAssignments)
    : []
  const guidedTermFinishedOn = guidedFinishedAssignments.reduce<string | null>((latest, assignment) => {
    const endsOn = seriesById.get(assignment.seriesId)?.endsOn ?? null
    return endsOn && (!latest || endsOn > latest) ? endsOn : latest
  }, null)
  const guidanceHeadingRef = useRef<HTMLDivElement>(null)
  const handledGuidanceRef = useRef(false)

  useEffect(() => {
    if (handledGuidanceRef.current || !guidedPlayer) return
    const frame = window.requestAnimationFrame(() => {
      if (handledGuidanceRef.current) return
      handledGuidanceRef.current = true
      const assignment = guidedCurrentAssignments[0] ?? guidedFinishedAssignments[0]
      const assignedSeries = seriesById.get(assignment?.seriesId ?? "")
      if (assignedSeries) {
        setExpandedProgramme(scheduleGroupKey(assignedSeries, today))
        setExpandedSeriesId(assignedSeries.id)
      }
      guidanceHeadingRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [guidedCurrentAssignments, guidedFinishedAssignments, guidedPlayer, seriesById, today])

  function replaceExpandedScheduleUrl(
    programme: ScheduleGroupKey | null,
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

  function toggleProgramme(programme: ScheduleGroupKey) {
    if (hasPendingMutation) return
    const nextProgramme = expandedProgramme === programme ? null : programme
    setExpandedProgramme(nextProgramme)
    setExpandedSeriesId(null)
    replaceExpandedScheduleUrl(nextProgramme, null)
  }

  function guidanceNote() {
    const changesMadeIn = initialPlayerInOnboarding
      ? "This player has not finished Player onboarding: finish it there first, then make schedule changes from Members."
      : "Schedule changes for a player are made from Members."
    if (guidedCurrentAssignments.length) {
      const count = guidedCurrentAssignments.length
      const finished = guidedFinishedAssignments.length
      return `On ${count === 1 ? "one schedule" : `${count} schedules`}${guidedAssignedWeekdays.length ? ` for ${assignmentDayLabel(guidedAssignedWeekdays)}` : ""}.${finished
        ? ` Still on ${finished === 1 ? "a schedule" : `${finished} schedules`} whose term has finished.`
        : ""} ${changesMadeIn}`
    }
    if (guidedTermFinishedOn) {
      return `Term finished on ${formatTermDate(guidedTermFinishedOn)}. ${changesMadeIn}`
    }
    return initialPlayerInOnboarding
      ? "Not on any schedule. A first schedule is set in Player onboarding."
      : "Not on any schedule. Start their training again from Members."
  }

  async function endSchedule(series: TrainingSessionSeries, stopFees: boolean) {
    if (hasPendingMutation) return
    setEndingSeriesId(series.id)
    setEndingFeedback(null)
    try {
      const result = await endSessionSeries({ seriesId: series.id, stopFees })
      if (!result.ok) {
        setEndingFeedback({
          message: result.message,
          seriesId: series.id,
          tone: "error",
        })
        return
      }
      setConfirmingSeriesId(null)
      setEndedSummary({ closeout: result.data.closeout, label: seriesLabel(series) })
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
  }

  function renderSeriesCard(series: TrainingSessionSeries, finished: boolean) {
    const isExpanded = expandedSeriesId === series.id
    const groupKey: ScheduleGroupKey = finished ? "finished" : series.programme
    const roster = (assignmentIndex.activeBySeries.get(series.id) ?? []).flatMap(
      (assignment) => playerById.get(assignment.playerId) ?? [],
    )
    const seriesEndingFeedback = endingFeedback?.seriesId === series.id && endingFeedback.offerRetry
      ? endingFeedback
      : null
    const endingRetryIsSeries = Boolean(seriesEndingFeedback)
    return (
      <article className="coach-series-roster-card" data-finished={finished || undefined} key={series.id}>
        <button type="button" disabled={hasPendingMutation} aria-expanded={isExpanded} onClick={() => {
          const opening = !isExpanded
          setExpandedProgramme(groupKey)
          setExpandedSeriesId(opening ? series.id : null)
          replaceExpandedScheduleUrl(groupKey, opening ? series.id : null)
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
            <small className="coach-series-dates">
              {finished ? "Term finished · " : ""}{scheduleDates(series)}
            </small>
          </span>
          <span>
            <Users aria-hidden="true" /> {finished
              ? `${roster.length} still on it`
              : countLabel(roster.length, "player", "players")} <ChevronDown aria-hidden="true" />
          </span>
        </button>
        {finished && series.endsOn ? (
          <p className="coach-series-term-note">
            Term finished on {formatTermDate(series.endsOn)}. Move each player on
            in <Link href={termFinishedMembersHref}>Members</Link>, or press End schedule.
          </p>
        ) : null}
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
              }) : <p>{finished
                ? "No players are left on this schedule."
                : "No players on this schedule. Players are added in Player onboarding."}</p>}
            </div>
            <InlineNotice
              className="coach-roster-end-notice"
              message={endingFeedback?.seriesId === series.id ? endingFeedback.message : null}
              reserveSpace={false}
              tone={endingFeedback?.seriesId === series.id ? endingFeedback.tone : "info"}
            />
            {confirmingSeriesId === series.id ? (
              <EndSchedulePanel
                busy={endingSeriesId === series.id}
                finished={finished}
                label={seriesLabel(series)}
                lastDay={series.endsOn}
                onCancel={() => setConfirmingSeriesId(null)}
                onConfirm={(stopFees) => void endSchedule(series, stopFees)}
                retry={endingRetryIsSeries}
                seriesId={series.id}
                today={today}
              />
            ) : (
              <button
                className="coach-series-end-action"
                type="button"
                disabled={hasPendingMutation}
                onClick={() => {
                  setEndingFeedback(null)
                  setEndedSummary(null)
                  setConfirmingSeriesId(series.id)
                }}
              >
                <CalendarX2 aria-hidden="true" /> {endingRetryIsSeries ? "End schedule again" : "End schedule"}
              </button>
            )}
          </div>
        ) : null}
      </article>
    )
  }

  function renderGroup({
    groupKey,
    series,
    summary,
    title,
  }: {
    groupKey: ScheduleGroupKey
    series: TrainingSessionSeries[]
    summary: string
    title: string
  }) {
    const finished = groupKey === "finished"
    const isProgrammeOpen = expandedProgramme === groupKey
    const programmeContentId = `schedule-programme-${groupKey.toLowerCase()}`

    return (
      <section
        className="coach-schedule-programme-group"
        data-finished={finished || undefined}
        key={groupKey}
      >
        <div className="coach-schedule-programme-heading">
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
        <h3 className="coach-schedule-programme-toggle-heading">
          <button
            type="button"
            disabled={hasPendingMutation}
            aria-expanded={isProgrammeOpen}
            aria-controls={programmeContentId}
            onClick={() => toggleProgramme(groupKey)}
          >
            <span>
              <strong>{title}</strong>
              <small>{summary}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </button>
        </h3>
        <div
          className="coach-schedule-programme-content"
          id={programmeContentId}
          data-expanded={isProgrammeOpen}
        >
          {series.map((item) => renderSeriesCard(item, finished))}
        </div>
      </section>
    )
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
            {guidedPlayer.training.level} · {guidedPlayer.training.batch} · {academyPlanLabel(guidedPlayer.training.academyPlan)}. {guidanceNote()}
          </p>
        </div>
      ) : null}

      <section className="coach-series-rosters coach-schedules-rosters" aria-labelledby="series-rosters-title">
        <div className="coach-series-rosters-heading">
          <span>Session assignments</span>
          <h2 id="series-rosters-title">Recurring sessions &amp; rosters</h2>
        </div>
        <div className="coach-series-ended-summary" role="status" aria-live="polite">
          {endedSummary ? (
            <>
              <strong>{endedSummary.label} ended</strong>
              <ul>
                {endScheduleSummary(endedSummary.closeout, monthName(today)).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <button type="button" onClick={() => setEndedSummary(null)}>Close</button>
            </>
          ) : null}
        </div>
        {programmeGroups.length ? programmeGroups.map((group) => renderGroup({
          groupKey: group.programme,
          series: group.series,
          summary: `${countLabel(group.series.length, "schedule", "schedules")} · ${countLabel(group.playerCount, "player", "players")}`,
          title: group.programme,
        })) : finishedGroup.series.length ? (
          <div className="coach-series-rosters-empty">
            <p>No schedules are running now. Create the next one, then move each player onto it in Members.</p>
            <Link href="/coach/schedules/new">Create schedule</Link>
          </div>
        ) : (
          <div className="coach-series-rosters-empty">
            <p>No schedules yet. Create the first recurring schedule, then add players to it in Player onboarding.</p>
            <Link href="/coach/schedules/new">Create schedule</Link>
          </div>
        )}
        {finishedGroup.series.length ? renderGroup({
          groupKey: "finished",
          series: finishedGroup.series,
          // Players still holding a place on these schedules, as each card
          // counts them. Not "to move": a player with a place on a running
          // schedule as well is still training, so the to-do and Members'
          // "Term finished" leave them out.
          summary: `${countLabel(finishedGroup.series.length, "schedule", "schedules")} · ${countLabel(finishedGroup.playerCount, "player", "players")} still on ${finishedGroup.series.length === 1 ? "it" : "them"}`,
          title: "Finished",
        }) : null}
      </section>
    </div>
  )
}
