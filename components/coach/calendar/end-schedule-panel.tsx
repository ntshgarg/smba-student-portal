"use client"

import { useEffect, useState } from "react"

import styles from "@/components/coach/calendar/end-schedule-panel.module.css"
import { useSessionPortal } from "@/components/coach/coach-portal-provider"
import { FormShell } from "@/components/coach/members/directory/form-shell"
import formStyles from "@/components/coach/members/directory/member-training-actions.module.css"
import { InlineNotice } from "@/components/inline-notice"
import { formatDateKey } from "@/lib/format"
import { formatTermDate } from "@/lib/sessions/term"
import type {
  EndSchedulePreview,
  EndScheduleResult,
  EndScheduleRosterPlayer,
} from "@/lib/sessions/service"

export function monthName(dateKey: string) {
  return formatDateKey(`${dateKey.slice(0, 7)}-01`, {
    day: undefined, month: "long", weekday: undefined, year: "numeric",
  })
}

function dayName(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "short", weekday: "short", year: undefined })
}

function players(count: number) {
  return `${count} ${count === 1 ? "player" : "players"}`
}

function names(list: readonly { fullName: string }[]) {
  return list.map((item) => item.fullName).join(", ")
}

function playerNote(player: EndScheduleRosterPlayer) {
  const notes: string[] = []
  if (player.inOnboarding) notes.push("still in Player onboarding")
  if (player.onAnotherSchedule) notes.push("also on another schedule: stays active, fees unchanged")
  else if (player.placeElsewhere) notes.push("still on a schedule whose term has finished: stays Term finished")
  if (player.bookingOntoThis) notes.push("booked change on this schedule: cancelled")
  else if (player.bookingKept) {
    notes.push(player.bookingKept.kind === "end"
      ? `end of training booked for ${dayName(player.bookingKept.effectiveOn)}: kept`
      : `move booked for ${dayName(player.bookingKept.effectiveOn)}: kept`)
  }
  return notes.join(" · ")
}

/**
 * The plain summary shown after End schedule, from the lists the server
 * returned (lib/sessions/service.ts endSessionSeriesRecords).
 */
export function endScheduleSummary(closeout: EndScheduleResult, thisMonth: string) {
  // A repeat press (a lost reply, or a second tab) finds it already ended and
  // changes nothing; its empty lists say nothing about who was on it.
  if (closeout.alreadyEnded) {
    return ["This schedule had already been ended, so nothing more was changed. Each player's record in Members shows what changed."]
  }
  return [
    closeout.takenOff.length
      ? `Taken off: ${names(closeout.takenOff)}`
      : "Nobody was on it",
    closeout.keptActive.length
      ? `Still training on another schedule, fees unchanged: ${names(closeout.keptActive)}`
      : null,
    closeout.bookingKept.length
      ? `Booked change kept as arranged: ${names(closeout.bookingKept)}`
      : null,
    closeout.bookingCancelled.length
      ? `Booking onto this schedule cancelled (their record says so): ${names(closeout.bookingCancelled)}`
      : null,
    closeout.feesStopped.length
      ? `Fees stop after ${thisMonth}: ${names(closeout.feesStopped)}`
      : null,
    closeout.inOnboarding.length
      ? `Still in Player onboarding (finish it to charge the registration fee and the months they trained; anyone who had not had a first training day chooses a first schedule there again): ${names(closeout.inOnboarding)}`
      : null,
  ].filter((line): line is string => Boolean(line))
}

/**
 * The groups the confirm panel counts, classified the way
 * endSessionSeriesRecords writes them: anyone with no place left on another
 * schedule (running or term-finished) is paused, booked change or not; the
 * fee choice applies to everyone not kept as they are.
 */
export function endScheduleGroups(roster: readonly EndScheduleRosterPlayer[]) {
  const keptActive = roster.filter((player) => player.onAnotherSchedule)
  const keptBooking = roster.filter((player) => !player.onAnotherSchedule && player.bookingKept && !player.bookingOntoThis)
  const paused = roster.filter((player) => !player.placeElsewhere)
  const withFeePlans = roster.filter((player) => (
    player.hasFeePlan && !keptActive.includes(player) && !keptBooking.includes(player)
  ))
  return { keptActive, keptBooking, paused, withFeePlans }
}

/*
 * End schedule's confirm panel (head coach, 12 Nov 2026), in place of a
 * browser confirm box. It reads what the server will do for each player
 * before anything changes: who stays active on another schedule, whose booked
 * change is kept or cancelled, who is still in onboarding. It asks about fees
 * with the same choice and words as Members End training.
 */
export function EndSchedulePanel({
  busy,
  finished,
  label,
  lastDay,
  onCancel,
  onConfirm,
  retry = false,
  seriesId,
  today,
}: {
  busy: boolean
  /** The schedule's last day has passed: there are no sessions left to cancel. */
  finished: boolean
  label: string
  lastDay: string | null
  onCancel: () => void
  onConfirm: (stopFees: boolean) => void
  /** The last try did not reach the server; the button says to try again. */
  retry?: boolean
  seriesId: string
  today: string
}) {
  const { previewEndSessionSeries } = useSessionPortal()
  const [preview, setPreview] = useState<EndSchedulePreview | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [stopFees, setStopFees] = useState(true)
  const thisMonth = monthName(today)

  useEffect(() => {
    let live = true
    previewEndSessionSeries(seriesId).then((result) => {
      if (!live) return
      if (result.ok) setPreview(result.data)
      else setFailure(result.message)
    }).catch(() => {
      if (live) setFailure("Could not check who is on this schedule. Check your connection and try again.")
    })
    return () => {
      live = false
    }
  }, [previewEndSessionSeries, seriesId])

  const roster = preview?.players ?? []
  const { keptActive, keptBooking, paused, withFeePlans } = endScheduleGroups(roster)
  const cancelled = [...roster.filter((player) => player.bookingOntoThis), ...(preview?.bookedOnto ?? [])]
  const askFees = Boolean(preview?.financeActive) && withFeePlans.length > 0
  const inOnboarding = roster.filter((player) => player.inOnboarding)

  const summary = preview ? [
    finished
      ? "Its last day has passed, so there are no sessions left to cancel"
      : preview.upcomingSessions
        ? `Cancel ${preview.upcomingSessions} upcoming ${preview.upcomingSessions === 1 ? "session" : "sessions"}`
        : "Cancel its upcoming sessions (none are left)",
    roster.length
      ? finished && lastDay
        ? `Take ${players(roster.length)} off it after its last day, ${formatTermDate(lastDay)}`
        : `Take ${players(roster.length)} off it today`
      : "Close it: nobody is on it",
    ...(keptActive.length ? [`Keep ${players(keptActive.length)} training on their other schedule`] : []),
    ...(keptBooking.length ? [`Leave the booked change of ${players(keptBooking.length)} as arranged`] : []),
    ...(cancelled.length ? [`Cancel ${cancelled.length === 1 ? "1 booking" : `${cancelled.length} bookings`} onto this schedule, with a note on each record`] : []),
    ...(paused.length ? [`Pause ${players(paused.length)}`] : []),
    ...(askFees
      ? [stopFees
        ? `Stop fees after ${thisMonth} for ${players(withFeePlans.length)}`
        : `Keep the fee plan for ${players(withFeePlans.length)}`]
      : []),
    "This cannot be undone",
  ] : []

  return (
    <div className={styles.panel}>
      <FormShell
        busy={busy}
        confirmLabel={retry ? "End schedule again" : "End schedule"}
        danger
        disabled={!preview}
        eyebrow="End schedule"
        onCancel={onCancel}
        // The choice is sent even when the question is hidden: the server
        // works the groups out again, and a player whose booking or other
        // place went away since this panel opened gets the stated default
        // (Stop fees), not Keep. It has no effect on anyone kept as they are.
        onConfirm={() => onConfirm(stopFees)}
        summary={summary}
        title={`End ${label}`}
      >
        {failure ? (
          <InlineNotice message={failure} reserveSpace={false} tone="error" />
        ) : !preview ? (
          <p className={formStyles.help}>Checking who is on this schedule…</p>
        ) : (
          <>
            <div className={formStyles.field}>
              <span className={formStyles.label}>On this schedule</span>
              {roster.length ? (
                <ul className={styles.players}>
                  {roster.map((player) => (
                    <li key={player.playerId}>
                      <span>{player.fullName}</span>
                      {playerNote(player) ? (
                        <small className={player.inOnboarding || player.bookingOntoThis ? styles.warn : undefined}>
                          {playerNote(player)}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className={formStyles.help}>No players are left on this schedule.</p>}
              {inOnboarding.length ? (
                <p className={formStyles.help}>
                  {names(inOnboarding)} {inOnboarding.length === 1 ? "has" : "have"} not finished Player onboarding. Ending the schedule takes them off it too; finish their onboarding afterwards to charge the registration fee and the months they trained. Anyone whose first training day has not come yet has nothing to charge: they choose a first schedule again in Player onboarding, or are archived if they are not joining.
                </p>
              ) : null}
            </div>
            {preview.bookedOnto.length ? (
              <div className={formStyles.field}>
                <span className={formStyles.label}>Booked to move onto it</span>
                <ul className={styles.players}>
                  {preview.bookedOnto.map((player) => (
                    <li key={player.playerId}>
                      <span>{player.fullName}</span>
                      <small className={styles.warn}>move booked for {dayName(player.effectiveOn)}: cancelled</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {askFees ? (
              <fieldset className={formStyles.field}>
                <legend className={formStyles.label}>Fees</legend>
                <label className={`${formStyles.option} ${stopFees ? formStyles.optionOn : ""}`}>
                  <input name={`end-fees-${seriesId}`} type="radio" checked={stopFees} onChange={() => setStopFees(true)} />
                  <span><strong>Stop fees after {thisMonth}</strong><small>{thisMonth}&apos;s fee stays as it is.</small></span>
                </label>
                <label className={`${formStyles.option} ${!stopFees ? formStyles.optionOn : ""}`}>
                  <input name={`end-fees-${seriesId}`} type="radio" checked={!stopFees} onChange={() => setStopFees(false)} />
                  <span><strong>Keep the fee plan</strong><small>For a break. No fee is issued while they are on no schedule.</small></span>
                </label>
                {keptActive.length || keptBooking.length ? (
                  <p className={formStyles.help}>
                    Players still on another schedule, or with a change already booked, keep their fees as they are.
                  </p>
                ) : null}
              </fieldset>
            ) : null}
          </>
        )}
      </FormShell>
    </div>
  )
}
