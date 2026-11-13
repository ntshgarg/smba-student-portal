import { formatDateKey } from "@/lib/format"

/*
 * When a term runs out. Every schedule has a last day (`endsOn`), and nothing
 * happens by itself when that day passes: no job pauses the players, closes
 * their places or changes their fees (head coach, 12 Nov 2026). The players
 * keep an open place on the schedule until the head coach moves them on in
 * Members, ends their training, or presses End schedule.
 *
 * So "term finished" is worked out when a screen is drawn, from the open
 * places and the academy's today, and this is the one place that decides it.
 * It is shared by the server reads and the client screens, so it must not
 * import anything server-only.
 *
 *   running place   an open place on a schedule that is not ended and whose
 *                   last day is today or later (or that has no last day)
 *   finished place  an open place on a schedule that is not ended and whose
 *                   last day is before today
 *   term finished   at least one finished place and no running place; the
 *                   date is the latest last day among the finished places
 *
 * The last day itself still counts as running: the term finishes the day
 * after it.
 */

export type TermSchedule = {
  endsOn: string | null
  status: "active" | "ended"
}

export type PlayerTrainingStatus = "unassigned" | "active" | "paused" | "finished"

/** A schedule still running on `today`. */
export function scheduleIsRunning(schedule: TermSchedule, today: string) {
  return schedule.status === "active" && (!schedule.endsOn || schedule.endsOn >= today)
}

/** A schedule whose last day has passed but which nobody has ended. */
export function scheduleTermFinished(schedule: TermSchedule, today: string) {
  return schedule.status === "active" && schedule.endsOn !== null && schedule.endsOn < today
}

/**
 * The day a player's term finished, or null while any open place is still
 * running (or there is no finished place at all). `openPlaces` are the
 * schedules of the player's open places, one per place.
 */
export function termFinishedOn(openPlaces: readonly TermSchedule[], today: string) {
  let latest: string | null = null
  for (const place of openPlaces) {
    if (scheduleIsRunning(place, today)) return null
    if (scheduleTermFinished(place, today) && (latest === null || place.endsOn! > latest)) {
      latest = place.endsOn
    }
  }
  return latest
}

/**
 * The training status Members shows. A term-finished player is "finished";
 * any other player with an open place is "active" as before, and a player
 * with no open place keeps the stored paused / unassigned state.
 */
export function playerTrainingStatus({
  enrollmentStatus,
  openPlaces,
  today,
}: {
  enrollmentStatus: string
  openPlaces: readonly TermSchedule[]
  today: string
}): { status: PlayerTrainingStatus; termFinishedOn: string | null } {
  const finishedOn = termFinishedOn(openPlaces, today)
  if (finishedOn) return { status: "finished", termFinishedOn: finishedOn }
  if (openPlaces.length) return { status: "active", termFinishedOn: null }
  return {
    status: enrollmentStatus === "unassigned" ? "unassigned" : "paused",
    termFinishedOn: null,
  }
}

/**
 * Whether a term-finished player is still the head coach's to move. A move or
 * an end of training already booked for them in Members (a scheduled training
 * change) has dealt with them: they stay "Term finished" until it happens on
 * its day, because their place stays open until then, but they leave the
 * dashboard's to-do and the Members list it links to, so both show only who
 * is left. A player still in Player onboarding cannot be moved yet (Members
 * asks for onboarding first), so they are not counted either.
 */
export function termFinishedToMove(
  status: PlayerTrainingStatus,
  hasBookedChange: boolean,
  inOnboarding = false,
) {
  return status === "finished" && !hasBookedChange && !inOnboarding
}

/**
 * Whether a month gets "No fee: term finished" on the fee page: a month after
 * the term's last day, and before the month a move booked in Members starts
 * (`feeResumesOn`, the 1st of that month), which is billed as usual.
 */
export function monthAfterFinishedTerm(
  { feeResumesOn, termFinishedOn: finishedOn }: { feeResumesOn: string | null; termFinishedOn: string | null },
  period: string,
) {
  if (!finishedOn || period <= finishedOn.slice(0, 7)) return false
  return !feeResumesOn || period < feeResumesOn.slice(0, 7)
}

/**
 * Whether a place reaches into the window from `from` up to (not including)
 * `toExclusive`. The place's own dates decide it (its `effectiveTo` is the
 * first day it no longer covers), cut off at its schedule's first and last
 * day: an open place on a schedule that ran out last year does not reach
 * into this one.
 */
export function placeReachesWindow(
  place: { effectiveFrom: string; effectiveTo: string | null },
  schedule: { endsOn: string | null; startsOn?: string } | null | undefined,
  from: string,
  toExclusive: string,
) {
  return place.effectiveFrom < toExclusive
    && (!place.effectiveTo || place.effectiveTo > from)
    && (!schedule?.startsOn || schedule.startsOn < toExclusive)
    && (!schedule?.endsOn || schedule.endsOn >= from)
}

/** "31 October 2026": how a term's last day is written on screen. */
export function formatTermDate(dateKey: string) {
  return formatDateKey(dateKey, { weekday: undefined, year: "numeric" })
}

/** What a family is told once the head coach has booked their next schedule or the end of their training. */
export function bookedStepMessage(nextScheduleStartsOn: string | null = null, trainingEndsOn: string | null = null) {
  if (nextScheduleStartsOn) return `Your next schedule starts on ${formatTermDate(nextScheduleStartsOn)}.`
  if (trainingEndsOn) return `Your training ends on ${formatTermDate(trainingEndsOn)}.`
  return null
}

/**
 * What a family sees in place of their next session once the term is over:
 * what the head coach has already booked, otherwise that the next schedule
 * will appear once confirmed.
 */
export function termFinishedMessage(
  dateKey: string,
  nextScheduleStartsOn: string | null = null,
  trainingEndsOn: string | null = null,
) {
  const booked = bookedStepMessage(nextScheduleStartsOn, trainingEndsOn)
    ?? "Your next schedule will appear here once your coach confirms it."
  return `Your term finished on ${formatTermDate(dateKey)}. ${booked}`
}

/** "Term finished" or the plain status word Members has always shown. */
export function trainingStatusLabel(status: PlayerTrainingStatus) {
  return status === "finished" ? "Term finished" : status
}
