import { randomUUID } from "node:crypto"

import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm"

import { operationalActionError } from "@/lib/actions/operational-result"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { isValidDateKey } from "@/lib/date-keys"
import type { SmbaDatabase, SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  academyHolidays,
  attendanceAdjustments,
  sessionAssignments,
  sessionAttendanceRecords,
  sessionOccurrences,
  sessionSeries,
} from "@/lib/db/schema"
import { formatDateKey } from "@/lib/format"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"

export const MAX_HOLIDAY_DATES_PER_REQUEST = 31
export const MAX_HOLIDAY_LABEL_LENGTH = 60

export type AcademyHoliday = {
  id: string
  dateKey: string
  label: string
  declaredByAccountId: string
  createdAt: Date
}

export type HolidayDateImpact = {
  dateKey: string
  /** Non-null when this date is already closed; marking again would be a no-op. */
  existingHolidayLabel: string | null
  scheduledSessions: number
  alreadyCancelledSessions: number
  /**
   * Sessions on this date that have already begun. Non-zero only for a past or
   * same-day closure, and the reason attendance can exist at all -- see
   * `attendanceMarks`.
   */
  startedSessions: number
  attendanceMarks: number
  attendancePlayers: number
  /** Make-up sessions a player completed on this date. */
  makeUpCompletions: number
}

export type HolidayImpact = {
  dates: HolidayDateImpact[]
  totals: {
    datesToClose: number
    datesAlreadyClosed: number
    scheduledSessions: number
    attendanceMarks: number
    attendancePlayers: number
    makeUpCompletions: number
  }
}

function assertDateKeys(dateKeys: readonly string[]) {
  if (!dateKeys.length) {
    operationalActionError("BUSINESS_RULE", "Choose at least one date to close.", "dates")
  }
  if (dateKeys.length > MAX_HOLIDAY_DATES_PER_REQUEST) {
    operationalActionError(
      "BUSINESS_RULE",
      `Close at most ${MAX_HOLIDAY_DATES_PER_REQUEST} days at a time.`,
      "dates",
    )
  }
  if (dateKeys.some((dateKey) => !isValidDateKey(dateKey))) {
    operationalActionError("BUSINESS_RULE", "One of the selected dates is not a real date.", "dates")
  }
  if (new Set(dateKeys).size !== dateKeys.length) {
    operationalActionError("BUSINESS_RULE", "The same date was selected twice.", "dates")
  }
}

function normaliseLabel(label: string) {
  const trimmed = label.trim().replace(/\s+/gu, " ")
  if (!trimmed) {
    operationalActionError("BUSINESS_RULE", "Name the holiday so the register can show it.", "label")
  }
  if (trimmed.length > MAX_HOLIDAY_LABEL_LENGTH) {
    operationalActionError(
      "BUSINESS_RULE",
      `Keep the holiday name under ${MAX_HOLIDAY_LABEL_LENGTH} characters.`,
      "label",
    )
  }
  return trimmed
}

/**
 * The closures on any of these dates, keyed by date. Every path that puts a
 * session on a day -- a new schedule, a moved session, the backfill -- reads
 * this inside its own write transaction, so a day closed first can never end up
 * holding a live session that the calendar draws as closed.
 */
export function academyHolidaysOnDates(
  database: SmbaDatabaseExecutor,
  dateKeys: readonly string[],
): Map<string, { id: string; label: string }> {
  const dates = [...new Set(dateKeys)]
  if (!dates.length) return new Map()
  return new Map(database.select({
    dateKey: academyHolidays.dateKey,
    id: academyHolidays.id,
    label: academyHolidays.label,
  }).from(academyHolidays).where(inArray(academyHolidays.dateKey, dates)).all()
    .map((holiday) => [holiday.dateKey, { id: holiday.id, label: holiday.label }]))
}

/** Refuses a session being put on a day the academy has closed. */
export function assertAcademyOpenOn(
  database: SmbaDatabaseExecutor,
  dateKey: string,
  field = "dateKey",
) {
  const holiday = academyHolidaysOnDates(database, [dateKey]).get(dateKey)
  if (holiday) {
    operationalActionError(
      "BUSINESS_RULE",
      `The academy is closed on ${formatDateKey(dateKey)} for ${holiday.label}. Choose another day, or remove the holiday first.`,
      field,
    )
  }
}

export function listAcademyHolidays({
  database,
}: {
  database: SmbaDatabase
}): AcademyHoliday[] {
  return database.select().from(academyHolidays).all()
    .sort((first, second) => first.dateKey.localeCompare(second.dateKey))
}

/**
 * What closing these dates would do, computed without writing anything.
 *
 * The counts that matter are the ones a forward-only closure could never
 * produce. Cancellation used to be refused for any session that had started,
 * and marking attendance is refused for any session that has not
 * (`lib/sessions/service.ts` -- the two windows are exact complements), so
 * until holidays existed no cancelled session could carry an attendance mark.
 * Closing a past date breaks that for the first time, which is why
 * `attendanceMarks` and `makeUpCompletions` are surfaced for confirmation
 * rather than silently absorbed.
 */
export function previewAcademyHolidays({
  database,
  dateKeys,
  now,
}: {
  database: SmbaDatabase
  dateKeys: readonly string[]
  now: Date
}): HolidayImpact {
  assertDateKeys(dateKeys)
  const dates = [...dateKeys].sort((first, second) => first.localeCompare(second))

  const existingHolidays = new Map(
    database.select().from(academyHolidays)
      .where(inArray(academyHolidays.dateKey, dates)).all()
      .map((holiday) => [holiday.dateKey, holiday.label]),
  )

  const occurrences = database.select({
    id: sessionOccurrences.id,
    occurrenceDate: sessionOccurrences.occurrenceDate,
    startsAt: sessionOccurrences.startsAt,
    status: sessionOccurrences.status,
  }).from(sessionOccurrences)
    .where(inArray(sessionOccurrences.occurrenceDate, dates)).all()

  const scheduledIds = occurrences
    .filter((occurrence) => occurrence.status === "scheduled")
    .map((occurrence) => occurrence.id)

  // Attendance can only sit on a session that has started, so this is empty for
  // every future date and the confirm step stays quiet in the ordinary case.
  const marks = scheduledIds.length
    ? database.select({
      accountId: sessionAttendanceRecords.accountId,
      occurrenceId: sessionAttendanceRecords.occurrenceId,
    }).from(sessionAttendanceRecords).where(and(
      inArray(sessionAttendanceRecords.occurrenceId, scheduledIds),
      // A cleared mark is the coach explicitly un-marking someone; it carries no
      // attendance meaning and should not make a holiday look destructive.
      sql`${sessionAttendanceRecords.choice} in ('present', 'absent')`,
    )).all()
    : []
  const marksByOccurrence = marks.reduce<Map<string, { count: number; players: Set<string> }>>(
    (map, mark) => {
      const current = map.get(mark.occurrenceId) ?? { count: 0, players: new Set<string>() }
      current.count += 1
      current.players.add(mark.accountId)
      map.set(mark.occurrenceId, current)
      return map
    },
    new Map(),
  )

  /*
   * Make-ups are credited by SOURCE occurrence -- `lib/attendance/domain.ts`
   * turns an absent into an attended when an adjustment names it -- and the
   * completion date is never re-checked. So closing the day a make-up was
   * completed leaves the player credited present for a session the academy has
   * just declared never happened. Counted here so the coach is told, and
   * flagged for review in `markAcademyHolidays`.
   */
  const completions = database.select({
    id: attendanceAdjustments.id,
    completedOn: attendanceAdjustments.completedOn,
  }).from(attendanceAdjustments).where(and(
    inArray(attendanceAdjustments.completedOn, dates),
    isNull(attendanceAdjustments.voidedAt),
  )).all()
  const completionsByDate = completions.reduce<Map<string, number>>((map, adjustment) => {
    map.set(adjustment.completedOn, (map.get(adjustment.completedOn) ?? 0) + 1)
    return map
  }, new Map())

  const dateImpacts = dates.map((dateKey) => {
    const forDate = occurrences.filter((occurrence) => occurrence.occurrenceDate === dateKey)
    const scheduled = forDate.filter((occurrence) => occurrence.status === "scheduled")
    const dateMarks = scheduled.reduce(
      (total, occurrence) => total + (marksByOccurrence.get(occurrence.id)?.count ?? 0),
      0,
    )
    const datePlayers = new Set(
      scheduled.flatMap((occurrence) => [
        ...(marksByOccurrence.get(occurrence.id)?.players ?? []),
      ]),
    )
    return {
      dateKey,
      existingHolidayLabel: existingHolidays.get(dateKey) ?? null,
      scheduledSessions: scheduled.length,
      alreadyCancelledSessions: forDate.length - scheduled.length,
      startedSessions: scheduled.filter(
        (occurrence) => !occurrenceIsUpcoming(occurrence, now),
      ).length,
      attendanceMarks: dateMarks,
      attendancePlayers: datePlayers.size,
      makeUpCompletions: completionsByDate.get(dateKey) ?? 0,
    }
  })

  const openDates = dateImpacts.filter((impact) => !impact.existingHolidayLabel)
  /*
   * Distinct across the whole range, not the sum of the per-date counts: a
   * player marked on three days of a Diwali block is one player affected, and
   * summing would tell the coach three.
   */
  const openDateKeys = new Set(openDates.map((impact) => impact.dateKey))
  const affectedPlayers = new Set(
    marks.filter((mark) => {
      const occurrence = occurrences.find((candidate) => candidate.id === mark.occurrenceId)
      return occurrence ? openDateKeys.has(occurrence.occurrenceDate) : false
    }).map((mark) => mark.accountId),
  )

  return {
    dates: dateImpacts,
    totals: {
      datesToClose: openDates.length,
      datesAlreadyClosed: dateImpacts.length - openDates.length,
      scheduledSessions: openDates.reduce((total, impact) => total + impact.scheduledSessions, 0),
      attendanceMarks: openDates.reduce((total, impact) => total + impact.attendanceMarks, 0),
      attendancePlayers: affectedPlayers.size,
      makeUpCompletions: openDates.reduce((total, impact) => total + impact.makeUpCompletions, 0),
    },
  }
}

export type MarkAcademyHolidaysResult = {
  closedDates: string[]
  skippedDates: string[]
  cancelledSessions: number
  adjustmentsFlaggedForReview: number
}

/**
 * Close one or more dates and cancel every session still standing on them.
 *
 * Deliberately not subject to the future-only guard that governs cancelling a
 * single session. A holiday is often known only after the fact -- a bandh, a
 * civic closure -- and the head coach asked to be able to record one. The guard
 * is replaced by disclosure: `previewAcademyHolidays` reports what a past
 * closure would touch and the caller confirms it.
 */
export function markAcademyHolidays({
  coachId,
  database,
  dateKeys,
  label,
  now,
}: {
  coachId: string
  database: SmbaDatabase
  dateKeys: readonly string[]
  label: string
  now: Date
}): MarkAcademyHolidaysResult {
  requireHeadAdminAccess(coachId, { database })
  assertDateKeys(dateKeys)
  const holidayLabel = normaliseLabel(label)
  const dates = [...dateKeys].sort((first, second) => first.localeCompare(second))

  return database.transaction((tx) => {
    const alreadyClosed = new Set(
      tx.select({ dateKey: academyHolidays.dateKey }).from(academyHolidays)
        .where(inArray(academyHolidays.dateKey, dates)).all()
        .map((holiday) => holiday.dateKey),
    )
    const openDates = dates.filter((dateKey) => !alreadyClosed.has(dateKey))
    if (!openDates.length) {
      return {
        closedDates: [],
        skippedDates: dates,
        cancelledSessions: 0,
        adjustmentsFlaggedForReview: 0,
      }
    }

    let cancelledSessions = 0
    openDates.forEach((dateKey) => {
      const holidayId = randomUUID()
      tx.insert(academyHolidays).values({
        id: holidayId,
        dateKey,
        label: holidayLabel,
        declaredByAccountId: coachId,
        createdAt: now,
      }).run()
      /*
       * Set-based rather than a loop over `cancelSessionOccurrence`. That path
       * aborts the whole call when a session on the date has been replaced
       * elsewhere, which would make an ordinary holiday unmarkable with a
       * message that reads as a bug. Filtering on `status = 'scheduled'` skips
       * tombstones for free and makes a repeat call a no-op.
       */
      cancelledSessions += tx.update(sessionOccurrences)
        .set({ holidayId, status: "cancelled" })
        .where(and(
          eq(sessionOccurrences.occurrenceDate, dateKey),
          eq(sessionOccurrences.status, "scheduled"),
        )).run().changes
    })

    /*
     * A make-up completed on a day now declared closed still credits its source
     * absence, because that credit is keyed to the source occurrence alone.
     * Rather than silently revoking it -- the player may well have trained --
     * put it in front of the coach on the adjustments screen.
     */
    const affectedAdjustmentIds = tx.select({ id: attendanceAdjustments.id })
      .from(attendanceAdjustments).where(and(
        inArray(attendanceAdjustments.completedOn, openDates),
        isNull(attendanceAdjustments.voidedAt),
        isNull(attendanceAdjustments.reviewRequiredAt),
      )).all().map((adjustment) => adjustment.id)
    const adjustmentsFlaggedForReview = affectedAdjustmentIds.length
      ? tx.update(attendanceAdjustments).set({ reviewRequiredAt: now })
        .where(inArray(attendanceAdjustments.id, affectedAdjustmentIds)).run().changes
      : 0

    return {
      closedDates: openDates,
      skippedDates: dates.filter((dateKey) => alreadyClosed.has(dateKey)),
      cancelledSessions,
      adjustmentsFlaggedForReview,
    }
  }, { behavior: "immediate" })
}

export type RetractAcademyHolidayResult = {
  dateKey: string
  restoredSessions: number
  /**
   * Sessions the closure had cancelled that stay off: their schedule has since
   * been ended, or the schedule already has a session on this day because one
   * was moved onto it.
   */
  keptCancelledSessions: number
  /** Make-ups the closure had flagged for review, now back as they were. */
  reviewFlagsCleared: number
}

/**
 * Remove a closure and put back the sessions it cancelled.
 *
 * Restoring only rows carrying this holiday's id is what keeps the operation
 * honest: a session the coach had cancelled individually before the holiday was
 * declared has a null `holiday_id` and stays cancelled.
 *
 * Two kinds of suspended session stay off rather than come back:
 *
 * - One of a schedule that has been ended, on a day that came after it ended.
 *   Ending a schedule cancels its future sessions and closes every player's
 *   place, so reviving one would put a session with nobody on it back on the
 *   calendar. `endSessionSeriesRecords` now detaches these itself when the
 *   schedule is ended; this covers schedules ended before it did. Nothing
 *   records when a schedule was ended, but ending it closes every place on the
 *   day it ends, so a day that no place on the schedule covers is a day after
 *   the end (or one nobody was ever on). That holds whether the day is still
 *   ahead or has already passed by the time the holiday is removed.
 * - One whose schedule already has a session on this day, because a session was
 *   moved onto it while the day was closed (possible before moves onto a closed
 *   day were refused). That moved session stands for the schedule on this day.
 *   This used to refuse the whole removal, and once the day had passed nothing
 *   could clear the way, so the holiday could never be removed. If the moved
 *   session was itself cancelled by this holiday (the one-off repair in
 *   drizzle/0038 does that), it is the one that comes back.
 *
 * Either way the row is detached from the holiday and left as an ordinary
 * cancellation, exactly as if it had been cancelled on its own.
 */
export function retractAcademyHoliday({
  coachId,
  database,
  dateKey,
  now = new Date(),
}: {
  coachId: string
  database: SmbaDatabase
  dateKey: string
  now?: Date
}): RetractAcademyHolidayResult {
  requireHeadAdminAccess(coachId, { database })
  if (!isValidDateKey(dateKey)) {
    operationalActionError("BUSINESS_RULE", "That is not a real date.", "dateKey")
  }

  return database.transaction((tx) => {
    const holiday = tx.select().from(academyHolidays)
      .where(eq(academyHolidays.dateKey, dateKey)).get()
    if (!holiday) {
      operationalActionError("NOT_FOUND", "That date is not marked as a holiday.", "dateKey")
    }

    const suspended = tx.select({
      id: sessionOccurrences.id,
      replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
      seriesId: sessionOccurrences.seriesId,
      startsAt: sessionOccurrences.startsAt,
    }).from(sessionOccurrences)
      .where(eq(sessionOccurrences.holidayId, holiday.id)).all()

    const seriesIds = [...new Set(suspended.map((occurrence) => occurrence.seriesId))]
    const endedSeries = new Set(seriesIds.length
      ? tx.select({ id: sessionSeries.id }).from(sessionSeries).where(and(
        inArray(sessionSeries.id, seriesIds),
        eq(sessionSeries.status, "ended"),
      )).all().map((series) => series.id)
      : [])
    // Ended schedules with a place that still covered this day: the day came
    // before the schedule ended, so its session is part of the record.
    const endedSeriesOpenThatDay = new Set(endedSeries.size
      ? tx.select({ seriesId: sessionAssignments.seriesId }).from(sessionAssignments).where(and(
        inArray(sessionAssignments.seriesId, [...endedSeries]),
        lte(sessionAssignments.effectiveFrom, dateKey),
        or(isNull(sessionAssignments.effectiveTo), gt(sessionAssignments.effectiveTo, dateKey)),
      )).all().map((place) => place.seriesId)
      : [])
    // `session_occurrences_series_date_idx` is unique on (series, date) over
    // scheduled rows, so reviving into an occupied slot would also fail outright.
    const occupiedSeries = new Set(suspended.length
      ? tx.select({ seriesId: sessionOccurrences.seriesId }).from(sessionOccurrences).where(and(
        eq(sessionOccurrences.occurrenceDate, dateKey),
        eq(sessionOccurrences.status, "scheduled"),
      )).all().map((row) => row.seriesId)
      : [])
    // `session_occurrences_active_replacement_idx` likewise allows one live
    // replacement per original session.
    const movedOriginals = [...new Set(suspended
      .map((occurrence) => occurrence.replacementForOccurrenceId)
      .filter((id): id is string => id !== null))]
    const liveReplacementFor = new Set(movedOriginals.length
      ? tx.select({ originalId: sessionOccurrences.replacementForOccurrenceId })
        .from(sessionOccurrences).where(and(
          inArray(sessionOccurrences.replacementForOccurrenceId, movedOriginals),
          eq(sessionOccurrences.status, "scheduled"),
        )).all().map((row) => row.originalId)
      : [])

    const scheduleEndedBeforeThisDay = (occurrence: (typeof suspended)[number]) => (
      endedSeries.has(occurrence.seriesId)
      && (!endedSeriesOpenThatDay.has(occurrence.seriesId) || occurrenceIsUpcoming(occurrence, now))
    )
    /*
     * At most one session per schedule comes back on this day. A moved session
     * goes first: it is the coach's latest word on when that schedule trains.
     */
    const candidates = suspended
      .filter((occurrence) => !occupiedSeries.has(occurrence.seriesId))
      .filter((occurrence) => !scheduleEndedBeforeThisDay(occurrence))
      .filter((occurrence) => (
        occurrence.replacementForOccurrenceId === null
        || !liveReplacementFor.has(occurrence.replacementForOccurrenceId)
      ))
      .sort((first, second) => (
        Number(first.replacementForOccurrenceId === null)
          - Number(second.replacementForOccurrenceId === null)
        || first.startsAt.getTime() - second.startsAt.getTime()
        || first.id.localeCompare(second.id)
      ))
    const restoringSeries = new Set<string>()
    const restore = candidates.filter((occurrence) => {
      if (restoringSeries.has(occurrence.seriesId)) return false
      restoringSeries.add(occurrence.seriesId)
      return true
    }).map((occurrence) => occurrence.id)
    const restoreIds = new Set(restore)
    const stayOff = suspended.filter((occurrence) => !restoreIds.has(occurrence.id))
      .map((occurrence) => occurrence.id)

    if (stayOff.length) {
      tx.update(sessionOccurrences).set({ holidayId: null })
        .where(inArray(sessionOccurrences.id, stayOff)).run()
    }
    const restoredSessions = restore.length
      ? tx.update(sessionOccurrences)
        .set({ holidayId: null, status: "scheduled" })
        .where(and(
          inArray(sessionOccurrences.id, restore),
          eq(sessionOccurrences.holidayId, holiday.id),
        )).run().changes
      : 0

    /*
     * `markAcademyHolidays` flags a make-up completed on the closed day with the
     * closure's own timestamp, and only one that was not already flagged.
     * Matching that exact timestamp clears what this closure raised and leaves a
     * flag raised for any other reason in place.
     */
    const reviewFlagsCleared = tx.update(attendanceAdjustments)
      .set({ reviewRequiredAt: null })
      .where(and(
        eq(attendanceAdjustments.completedOn, dateKey),
        isNull(attendanceAdjustments.voidedAt),
        eq(attendanceAdjustments.reviewRequiredAt, holiday.createdAt),
      )).run().changes

    tx.delete(academyHolidays).where(eq(academyHolidays.id, holiday.id)).run()

    return {
      dateKey,
      keptCancelledSessions: stayOff.length,
      restoredSessions,
      reviewFlagsCleared,
    }
  }, { behavior: "immediate" })
}
