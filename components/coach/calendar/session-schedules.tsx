"use client"

import { ChevronDown } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import { EndSchedulePanel } from "@/components/coach/calendar/end-schedule-panel"
import {
  assignmentKey,
  buildFinishedSchedules,
  buildProgrammeGroups,
  buildSessionScheduleIndex,
  scheduleGroupKey,
  type ScheduleGroupKey,
} from "@/components/coach/calendar/session-schedule-index"
import { termFinishedMembersHref } from "@/components/coach/members/member-directory-query"
import { SessionsShell } from "@/components/coach/sessions/sessions-shell"
import styles from "@/components/coach/sessions/sessions.module.css"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import {
  formatDateKey,
  formatSessionLabel,
  sessionLabelParts,
} from "@/lib/format"
import { distinctAssignmentWeekdays } from "@/lib/sessions/domain"
import { formatTermDate, scheduleTermFinished } from "@/lib/sessions/term"
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

/**
 * "1 Jul", or "1 Jul 2024" when the year is not this one or the next: a term
 * runs a season, so those two are the ones a coach reads without a year.
 */
export function shortDate(dateKey: string, today: string) {
  const year = Number(dateKey.slice(0, 4))
  const thisYear = Number(today.slice(0, 4))
  return formatDateKey(dateKey, {
    month: "short",
    weekday: undefined,
    year: year === thisYear || year === thisYear + 1 ? undefined : "numeric",
  })
}

/** "1 Jul – 31 Mar": a schedule's first and last day. */
export function scheduleDates(series: Pick<TrainingSessionSeries, "endsOn" | "startsOn">, today: string) {
  return series.endsOn
    ? `${shortDate(series.startsOn, today)} – ${shortDate(series.endsOn, today)}`
    : `from ${shortDate(series.startsOn, today)}`
}

/** "Mon–Fri" for a run of days, "Mon · Wed · Fri" otherwise. */
function scheduleDays(series: TrainingSessionSeries) {
  const days = weekdays.filter((day) => series.slots.some((slot) => slot.weekday === day.value))
  if (days.length > 2) {
    const first = weekdays.indexOf(days[0])
    if (days.every((day, index) => weekdays.indexOf(day) === first + index)) {
      return `${days[0].short}–${days[days.length - 1].short}`
    }
  }
  return days.map((day) => day.short).join(" · ")
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
 * Schedules shows who is on each schedule, and lets the head coach
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
  // The schedule whose End schedule panel is open.
  const [confirmingSeriesId, setConfirmingSeriesId] = useState<string | null>(null)
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
    // `null`, not the current state: Next treats a call carrying its own state as
    // internal and would not take the new address, so a refresh put the old one back.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    )
  }

  // A level tile filters the list to that level; All (null) shows every group.
  function chooseGroup(programme: ScheduleGroupKey | null) {
    if (hasPendingMutation) return
    setExpandedProgramme(programme)
    setExpandedSeriesId(null)
    replaceExpandedScheduleUrl(programme, null)
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
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "The schedule is still active",
        unconfirmed: "Check the connection, then reload the page to see whether the schedule ended",
        subject: "The schedule ending",
      })
      setEndingFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        seriesId: series.id,
        tone: "error",
      })
    } finally {
      setEndingSeriesId(null)
    }
  }

  function renderSeriesRow(series: TrainingSessionSeries, finished: boolean) {
    const isExpanded = expandedSeriesId === series.id
    const roster = (assignmentIndex.activeBySeries.get(series.id) ?? []).flatMap(
      (assignment) => playerById.get(assignment.playerId) ?? [],
    )
    const seriesEndingFeedback = endingFeedback?.seriesId === series.id && endingFeedback.offerRetry
      ? endingFeedback
      : null
    const endingRetryIsSeries = Boolean(seriesEndingFeedback)
    const { range } = sessionLabelParts(seriesLabel(series))
    const playersLabel = finished
      ? `${roster.length} still on it`
      : countLabel(roster.length, "player", "players")
    return (
      <li className={isExpanded ? styles.open : undefined} key={series.id}>
        <button
          className={styles.rowHead}
          type="button"
          disabled={hasPendingMutation}
          aria-expanded={isExpanded}
          onClick={() => {
            const opening = !isExpanded
            setExpandedSeriesId(opening ? series.id : null)
            replaceExpandedScheduleUrl(expandedProgramme, opening ? series.id : null)
          }}
        >
          <span className={styles.time}>{range}</span>
          <span className={styles.copy}>
            <strong>{series.programme} ·&nbsp;{series.batch}</strong>
            <small>{scheduleDays(series)} · {series.venue} · {scheduleDates(series, today)}</small>
          </span>
          <span className={styles.tag} data-tone={finished ? "finished" : undefined}>{playersLabel}</span>
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </button>
        {finished && series.endsOn ? (
          <p className={styles.notice}>
            <span>
              Term finished on {formatTermDate(series.endsOn)}. Move each player on
              in <Link href={termFinishedMembersHref}>Members</Link>, or press End schedule.
            </span>
          </p>
        ) : null}
        {isExpanded ? (
          <div className={styles.detail}>
            {roster.length ? (
              <ul className={styles.cards} aria-label="Players on this schedule">
                {roster.map((player) => {
                  const assignment = assignmentIndex.activeByPlayerSeries.get(
                    assignmentKey(player.member.id, series.id),
                  )
                  return (
                    <li key={player.member.id}>
                      <span className={styles.initials} aria-hidden="true">{player.member.initials}</span>
                      <span>
                        <strong>{player.member.fullName}</strong>
                        <small>{assignmentDayLabel(assignment?.weekdays ?? [])}{assignment ? ` · since ${shortDate(assignment.effectiveFrom, today)}` : ""}</small>
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : <p className={styles.help}>{finished
              ? "No players are left on this schedule."
              : "No players on this schedule. Players are added in Player onboarding."}</p>}
            <InlineNotice
              action={endingFeedback?.seriesId === series.id ? endingFeedback.action : undefined}
              message={endingFeedback?.seriesId === series.id ? endingFeedback.message : null}
              reserveSpace={false}
              tone={endingFeedback?.seriesId === series.id ? endingFeedback.tone : "info"}
            />
            {confirmingSeriesId === series.id ? (
              <EndSchedulePanel
                busy={endingSeriesId === series.id}
                finished={finished}
                label={seriesLabel(series)}
                onCancel={() => setConfirmingSeriesId(null)}
                onConfirm={(stopFees) => void endSchedule(series, stopFees)}
                retry={endingRetryIsSeries}
                seriesId={series.id}
                today={today}
              />
            ) : (
              <div className={styles.occurrenceActions}>
                <Link className={styles.button} href="/coach/calendar">See in calendar</Link>
                <button
                  className={styles.danger}
                  type="button"
                  disabled={hasPendingMutation}
                  onClick={() => {
                    setEndingFeedback(null)
                    setConfirmingSeriesId(series.id)
                  }}
                >
                  {endingRetryIsSeries ? "End schedule again" : "End schedule"}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </li>
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
    return (
      <section key={groupKey} aria-label={title}>
        <h2 className={styles.group}>{title}<span>{summary}</span></h2>
        <ul className={styles.rows}>
          {series.map((item) => renderSeriesRow(item, finished))}
        </ul>
      </section>
    )
  }

  const groups = [
    ...programmeGroups.map((group) => ({
      groupKey: group.programme as ScheduleGroupKey,
      series: group.series,
      summary: `${countLabel(group.series.length, "schedule", "schedules")} ·\u00a0${countLabel(group.playerCount, "player", "players")}`,
      title: group.programme,
    })),
    ...finishedGroup.series.length ? [{
      groupKey: "finished" as ScheduleGroupKey,
      series: finishedGroup.series,
      // Players still holding a place on these schedules, as each row
      // counts them. Not "to move": a player with a place on a running
      // schedule as well is still training, so the to-do and Members'
      // "Term finished" leave them out.
      summary: `${countLabel(finishedGroup.series.length, "schedule", "schedules")} ·\u00a0${countLabel(finishedGroup.playerCount, "player", "players")} still on ${finishedGroup.series.length === 1 ? "it" : "them"}`,
      title: "Finished",
    }] : [],
  ]
  const tileKeys: ScheduleGroupKey[] = ["Beginner", "Intermediate", "Advanced", "Adult", "Elite", "finished"]
  const runningCount = programmeGroups.reduce((total, group) => total + group.series.length, 0)
  const tileCount = (key: ScheduleGroupKey) => key === "finished"
    ? finishedGroup.series.length
    : programmeGroups.find((group) => group.programme === key)?.series.length ?? 0
  const shownGroups = expandedProgramme
    ? groups.filter((group) => group.groupKey === expandedProgramme)
    : groups

  return (
    <SessionsShell
      action={<Link className={styles.primary} href="/coach/schedules/new">Create schedule</Link>}
      activeTab="schedules"
    >
      {guidedPlayer ? (
        <div
          ref={guidanceHeadingRef}
          className={styles.guide}
          tabIndex={-1}
        >
          <strong>{guidedPlayer.member.fullName}</strong> · {guidedPlayer.training.level} · {guidedPlayer.training.batch} · {academyPlanLabel(guidedPlayer.training.academyPlan)}. {guidanceNote()}
        </div>
      ) : null}

      <nav className={styles.tiles} aria-label="Schedules by level">
        {[null, ...tileKeys].map((key) => {
          const count = key === null ? runningCount + finishedGroup.series.length : tileCount(key)
          return (
            <button
              key={key ?? "all"}
              type="button"
              aria-pressed={expandedProgramme === key}
              data-zero={count === 0 ? "" : undefined}
              disabled={hasPendingMutation}
              onClick={() => chooseGroup(key)}
            >
              <b>{count}</b>
              <span>{key === null ? "All" : key === "finished" ? "Finished" : key}</span>
            </button>
          )
        })}
      </nav>

      <section className={styles.panel} aria-label="Schedules">
        {!programmeGroups.length && finishedGroup.series.length && expandedProgramme === null ? (
          <div className={styles.empty}>
            <p>No schedules are running now. Create the next one, then move each player onto it in Members.</p>
          </div>
        ) : null}
        {shownGroups.length ? shownGroups.map(renderGroup) : groups.length ? (
          <div className={styles.empty}>
            <p>No schedules at this level.</p>
          </div>
        ) : (
          <div className={styles.empty}>
            <p>No schedules yet. Create the first recurring schedule, then add players to it in Player onboarding.</p>
          </div>
        )}
      </section>
    </SessionsShell>
  )
}
