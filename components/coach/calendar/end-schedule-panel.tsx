"use client"

import { useEffect, useState } from "react"

import { useSessionPortal } from "@/components/coach/coach-portal-provider"
import { FormShell } from "@/components/coach/members/directory/form-shell"
import styles from "@/components/coach/sessions/sessions.module.css"
import formStyles from "@/components/coach/members/directory/member-training-actions.module.css"
import { InlineNotice } from "@/components/inline-notice"
import { isSessionExpiry, signInInNewTab } from "@/lib/client/network-failure"
import { formatDateKey } from "@/lib/format"
import type {
  EndSchedulePreview,
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

/** What ending the schedule does to one player, in plain sentences (head coach, 16 Nov 2026). */
export function playerOutcome(player: EndScheduleRosterPlayer) {
  const sentences = [
    player.onAnotherSchedule
      ? "Keeps training on their other schedule."
      : player.placeElsewhere
        ? "Stays Term finished on their other schedule."
        : "Stops training (this was their only schedule).",
  ]
  if (player.bookingOntoThis) sentences.push("Their booked change onto this schedule is cancelled.")
  else if (player.bookingKept) {
    sentences.push(player.bookingKept.kind === "end"
      ? `Their end of training booked for ${dayName(player.bookingKept.effectiveOn)} is kept.`
      : `Their move booked for ${dayName(player.bookingKept.effectiveOn)} is kept.`)
  }
  if (player.inOnboarding) sentences.push("Still in Player onboarding.")
  return sentences.join(" ")
}

/**
 * The groups the confirm panel counts, classified the way
 * endSessionSeriesRecords writes them: the fee choice applies to everyone not
 * kept as they are. Who is paused is said per player, by playerOutcome.
 */
export function endScheduleGroups(roster: readonly EndScheduleRosterPlayer[]) {
  const keptActive = roster.filter((player) => player.onAnotherSchedule)
  const keptBooking = roster.filter((player) => !player.onAnotherSchedule && player.bookingKept && !player.bookingOntoThis)
  const withFeePlans = roster.filter((player) => (
    player.hasFeePlan && !keptActive.includes(player) && !keptBooking.includes(player)
  ))
  return { keptActive, keptBooking, withFeePlans }
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
  onCancel: () => void
  onConfirm: (stopFees: boolean) => void
  /** The last try did not reach the server; the button says to try again. */
  retry?: boolean
  seriesId: string
  today: string
}) {
  const { previewEndSessionSeries } = useSessionPortal()
  const [preview, setPreview] = useState<EndSchedulePreview | null>(null)
  const [failure, setFailure] = useState<{ expired: boolean; message: string } | null>(null)
  const [stopFees, setStopFees] = useState(true)
  const thisMonth = monthName(today)

  useEffect(() => {
    let live = true
    previewEndSessionSeries(seriesId).then((result) => {
      if (!live) return
      if (result.ok) setPreview(result.data)
      else setFailure({ expired: false, message: result.message })
    }).catch((error: unknown) => {
      if (!live) return
      // Looking changes nothing, so an expired sign-in is the only cause with a
      // fix off this screen; a new tab renews it without closing the panel.
      setFailure(isSessionExpiry(error)
        ? {
          expired: true,
          message: "Could not check who is on this schedule because your sign-in has expired."
            + " Sign in again in a new tab, then close this panel and open it again.",
        }
        : {
          expired: false,
          message: "Could not check who is on this schedule. Check your connection and try again.",
        })
    })
    return () => {
      live = false
    }
  }, [previewEndSessionSeries, seriesId])

  const roster = preview?.players ?? []
  const { keptActive, keptBooking, withFeePlans } = endScheduleGroups(roster)
  const cancelled = [...roster.filter((player) => player.bookingOntoThis), ...(preview?.bookedOnto ?? [])]
  const askFees = Boolean(preview?.financeActive) && withFeePlans.length > 0
  const inOnboarding = roster.filter((player) => player.inOnboarding)

  // What happens to each player is said on their own line, so this keeps only the rest.
  const summary = preview ? [
    finished
      ? "Its last day has passed, so there are no sessions left to cancel"
      : preview.upcomingSessions
        ? `Cancel ${preview.upcomingSessions} upcoming ${preview.upcomingSessions === 1 ? "session" : "sessions"}`
        : "Cancel its upcoming sessions (none are left)",
    ...(roster.length ? [] : ["Close it: nobody is on it"]),
    ...(cancelled.length ? [`Cancel ${cancelled.length === 1 ? "1 booking" : `${cancelled.length} bookings`} onto this schedule, with a note on each record`] : []),
    ...(askFees
      ? [stopFees
        ? `Stop fees after ${thisMonth} for ${players(withFeePlans.length)}`
        : `Keep the fee plan for ${players(withFeePlans.length)}`]
      : []),
    "This cannot be undone",
  ] : []

  return (
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
        <InlineNotice
          action={failure.expired ? signInInNewTab : undefined}
          message={failure.message}
          reserveSpace={false}
          tone="error"
        />
      ) : !preview ? (
        <p className={formStyles.help}>Checking who is on this schedule…</p>
      ) : (
        <>
          <div className={formStyles.field}>
            <span className={formStyles.label}>What happens to its {players(roster.length)}</span>
            {roster.length ? (
              <ul className={styles.outcomes}>
                {roster.map((player) => (
                  <li key={player.playerId}>
                    <strong>{player.fullName}</strong>
                    <span className={player.inOnboarding || player.bookingOntoThis ? styles.warn : undefined}>
                      {playerOutcome(player)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className={formStyles.help}>No players are left on this schedule.</p>}
            {inOnboarding.length ? (
              <p className={formStyles.help}>
                {names(inOnboarding)} {inOnboarding.length === 1 ? "has" : "have"} not finished Player onboarding. Ending the schedule takes them off it too; finish their onboarding afterwards.
              </p>
            ) : null}
          </div>
          {preview.bookedOnto.length ? (
            <div className={formStyles.field}>
              <span className={formStyles.label}>Booked to move onto it</span>
              <ul className={styles.outcomes}>
                {preview.bookedOnto.map((player) => (
                  <li key={player.playerId}>
                    <strong>{player.fullName}</strong>
                    <span className={styles.warn}>Their move booked for {dayName(player.effectiveOn)} is cancelled.</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {askFees ? (
            <fieldset className={formStyles.field}>
              <legend className={formStyles.label}>
                {withFeePlans.length === 1 ? `${withFeePlans[0].fullName}’s fees` : `Fees for the ${players(withFeePlans.length)} coming off this schedule`}
              </legend>
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
  )
}
