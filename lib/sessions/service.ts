import { randomUUID } from "node:crypto"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { isValidDateKey } from "@/lib/attendance/domain"
import { reconcileAttendanceAdjustmentReviewStates } from "@/lib/attendance/adjustments"
import {
  OperationalActionError,
  operationalActionError,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import type { SmbaDatabase } from "@/lib/db/client"
import {
  accounts,
  attendanceAdjustments,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
  sessionRecurrenceRules,
  sessionSeries,
} from "@/lib/db/schema"
import {
  assignmentCoversOccurrence,
  buildOccurrenceDrafts,
  dateRangesOverlapInclusive,
  distinctAssignmentWeekdays,
  indiaLocalDateTime,
  MAX_SCHEDULE_TERM_DAYS,
  playerWasEnrolledForOccurrence,
  sessionDisplayName,
  sessionSlotsOverlap,
  validateSeriesInput,
} from "@/lib/sessions/domain"
import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import type {
  CreateSessionSeriesInput,
  SessionAttendanceChange,
} from "@/lib/sessions/types"
import {
  academyPlanAssignmentLimit,
  academyPlanIsValid,
  academyPlanLabel,
  academyPlanRequiredWeekdayCount,
} from "@/lib/training/academy-plans"

function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function occurrenceIntervalsOverlap(
  first: { durationMinutes: number; startsAt: Date },
  second: { durationMinutes: number; startsAt: Date },
) {
  const firstStart = first.startsAt.getTime()
  const secondStart = second.startsAt.getTime()
  return firstStart < secondStart + second.durationMinutes * 60_000
    && secondStart < firstStart + first.durationMinutes * 60_000
}

function assertActiveAssignmentCoverage(
  academyPlan: NonNullable<typeof playerEnrollments.$inferSelect.academyPlan>,
  weekdayGroups: number[][],
  { allowNoAssignments = false }: { allowNoAssignments?: boolean } = {},
) {
  const assignedWeekdays = distinctAssignmentWeekdays(weekdayGroups)
  if (allowNoAssignments && !weekdayGroups.length) return assignedWeekdays

  const requiredWeekdays = academyPlanRequiredWeekdayCount(academyPlan)
  if (requiredWeekdays !== null && assignedWeekdays.length !== requiredWeekdays) {
    operationalActionError(
      "BUSINESS_RULE",
      `The player’s ${academyPlanLabel(academyPlan)} requires exactly ${requiredWeekdays} distinct weekdays across active schedules. The current selection covers ${assignedWeekdays.length}.`,
      "weekdays",
    )
  }
  if (requiredWeekdays === null
    && assignedWeekdays.length > academyPlanAssignmentLimit(academyPlan)) {
    operationalActionError(
      "BUSINESS_RULE",
      "The player’s Weekend plan allows at most two attendance days.",
      "weekdays",
    )
  }

  return assignedWeekdays
}

export function createSessionSeriesRecords({
  coachId,
  database,
  input,
  now,
}: {
  coachId: string
  database: SmbaDatabase
  input: CreateSessionSeriesInput
  now: Date
}) {
  requireHeadAdminAccess(coachId, { database })
  validateSeriesInput(input)
  const seriesId = randomUUID()
  const venue = input.venue.trim()
  const slots = input.weekdays.map((weekday) => ({
    id: randomUUID(),
    seriesId,
    weekday,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
  }))
  const occurrenceDrafts = buildOccurrenceDrafts({
    from: input.startsOn,
    to: input.endsOn,
    series: {
      id: seriesId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      venue,
    },
    slots,
  })

  database.transaction((tx) => {
    const existingSeries = tx.select().from(sessionSeries).where(and(
      eq(sessionSeries.programme, input.programme),
      eq(sessionSeries.batch, input.batch),
      eq(sessionSeries.status, "active"),
    )).all()
    const existingSeriesIds = existingSeries.map((series) => series.id)
    const existingRules = existingSeriesIds.length
      ? tx.select().from(sessionRecurrenceRules).where(
        inArray(sessionRecurrenceRules.seriesId, existingSeriesIds),
      ).all()
      : []
    const conflicts = existingSeries.some((series) => (
      dateRangesOverlapInclusive(
        { startsOn: series.startsOn, endsOn: series.endsOn },
        { startsOn: input.startsOn, endsOn: input.endsOn },
      )
      && sessionSlotsOverlap(
        { slots: existingRules.filter((rule) => rule.seriesId === series.id) },
        { slots },
      )
    ))
    const draftDates = new Set(occurrenceDrafts.map((draft) => draft.occurrenceDate))
    const scheduledOccurrences = existingSeriesIds.length && draftDates.size
      ? tx.select().from(sessionOccurrences).where(and(
          inArray(sessionOccurrences.seriesId, existingSeriesIds),
          eq(sessionOccurrences.status, "scheduled"),
        )).all().filter((occurrence) => draftDates.has(occurrence.occurrenceDate))
      : []
    const materializedConflict = occurrenceDrafts.some((draft) => (
      scheduledOccurrences.some((occurrence) => (
        occurrence.occurrenceDate === draft.occurrenceDate
        && occurrenceIntervalsOverlap(draft, occurrence)
      ))
    ))
    if (conflicts || materializedConflict) {
      operationalActionError(
        "CONFLICT",
        "A schedule already uses this level, batch and time slot during the selected dates.",
        "startTime",
      )
    }

    tx.insert(sessionSeries).values({
      id: seriesId,
      title: sessionDisplayName(input),
      programme: input.programme,
      batch: input.batch,
      venue,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: "active",
      replacedSeriesId: null,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    slots.forEach((slot) => {
      tx.insert(sessionRecurrenceRules).values(slot).run()
    })
    /*
     * One statement for the whole term. Production runs libSQL over the network
     * with the synchronous driver, so each of these was a blocking round trip
     * inside the `immediate` write lock, with every other writer in the academy
     * queued behind them: `validateSeriesInput` caps a term at
     * MAX_SCHEDULE_TERM_DAYS days, which is 262 occurrences for a Weekday batch
     * training all five weekdays.
     *
     * No conflict clause, unlike `saveSessionAttendanceRecords`: `seriesId` is
     * minted a few lines above, so nothing can already hold
     * (seriesId, occurrenceDate), and `buildOccurrenceDrafts` walks each date in
     * the range once. A unique violation here is a real defect and must keep
     * failing the transaction rather than being folded into an update.
     */
    const occurrenceRows: Array<typeof sessionOccurrences.$inferInsert> = occurrenceDrafts
      .map((draft) => ({
        id: randomUUID(),
        ...draft,
        status: "scheduled",
        replacementForOccurrenceId: null,
        createdAt: now,
      }))
    // A term can select a weekday its date range never reaches, and drizzle
    // rejects an empty `values()`.
    if (occurrenceRows.length) tx.insert(sessionOccurrences).values(occurrenceRows).run()
  }, { behavior: "immediate" })
  return seriesId
}

export function assignSessionRecords({
  coachId,
  database,
  effectiveFrom,
  now,
  playerId,
  seriesId,
  weekdays,
}: {
  coachId: string
  database: SmbaDatabase
  effectiveFrom: string
  now: Date
  playerId: string
  seriesId: string
  weekdays: number[]
}) {
  requireHeadAdminAccess(coachId, { database })
  if (!isValidDateKey(effectiveFrom)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid assignment start date.",
      "effectiveFrom",
    )
  }
  const player = database.select({
    approvalStatus: accounts.approvalStatus,
    archivedAt: accounts.archivedAt,
    recordRevision: playerEnrollments.recordRevision,
    trainingStartOn: playerEnrollments.trainingStartOn,
    batch: playerEnrollments.batch,
    level: playerEnrollments.level,
    academyPlan: playerEnrollments.academyPlan,
  }).from(accounts).innerJoin(
    playerEnrollments,
    eq(playerEnrollments.accountId, accounts.id),
  ).where(and(eq(accounts.id, playerId), eq(accounts.role, "player"))).get()
  if (!player || player.approvalStatus !== "approved" || player.archivedAt) {
    operationalActionError("NOT_FOUND", "Approved player was not found.", "playerId")
  }
  if (!player.level || !player.batch) {
    operationalActionError(
      "BUSINESS_RULE",
      "Set the player’s level and batch before assigning a schedule.",
      "playerId",
    )
  }
  if (!player.academyPlan) {
    operationalActionError(
      "BUSINESS_RULE",
      "Set the player’s Academy Plan before assigning a schedule.",
      "playerId",
    )
  }
  const academyPlan = player.academyPlan
  if (!academyPlanIsValid(academyPlan, player.level, player.batch)) {
    operationalActionError(
      "BUSINESS_RULE",
      "Review the player’s Academy Plan before assigning a schedule.",
      "playerId",
    )
  }
  const series = database.select().from(sessionSeries).where(and(
    eq(sessionSeries.id, seriesId),
    eq(sessionSeries.status, "active"),
  )).get()
  if (!series) {
    operationalActionError("NOT_FOUND", "The selected schedule is unavailable.", "seriesId")
  }
  if (series.endsOn && series.endsOn < getIndiaDateKey(now)) {
    operationalActionError("BUSINESS_RULE", "The selected schedule has ended.", "seriesId")
  }
  if (series.programme !== player.level) {
    operationalActionError(
      "BUSINESS_RULE",
      "The schedule programme must match the player’s level.",
      "seriesId",
    )
  }
  if (series.batch !== player.batch) {
    operationalActionError(
      "BUSINESS_RULE",
      "The schedule batch must match the player’s Weekday or Weekend batch.",
      "seriesId",
    )
  }
  const recurrenceRules = database.select().from(sessionRecurrenceRules)
    .where(eq(sessionRecurrenceRules.seriesId, seriesId)).all()
  const availableWeekdays = new Set(recurrenceRules.map((rule) => rule.weekday))
  const selectedWeekdays = [...new Set(weekdays)].sort((first, second) => first - second)
  if (!selectedWeekdays.length) {
    operationalActionError("INVALID_INPUT", "Choose at least one attendance day.", "weekdays")
  }
  const selectionLimit = academyPlanAssignmentLimit(academyPlan)
  if (selectedWeekdays.length > selectionLimit) {
    operationalActionError(
      "BUSINESS_RULE",
      `The player’s Academy Plan allows up to ${selectionLimit} attendance days.`,
      "weekdays",
    )
  }
  if (selectedWeekdays.some((weekday) => (
    !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !availableWeekdays.has(weekday)
  ))) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose only days offered by this session.",
      "weekdays",
    )
  }
  const joinedOn = player.trainingStartOn
  const earliestDate = joinedOn > series.startsOn ? joinedOn : series.startsOn
  if (effectiveFrom < earliestDate) {
    operationalActionError(
      "BUSINESS_RULE",
      `Assignment cannot begin before ${earliestDate}.`,
      "effectiveFrom",
    )
  }
  if (series.endsOn && effectiveFrom > series.endsOn) {
    operationalActionError(
      "BUSINESS_RULE",
      "Assignment cannot begin after the schedule ends.",
      "effectiveFrom",
    )
  }

  database.transaction((tx) => {
    const transactionPlayer = tx.select({
      approvalStatus: accounts.approvalStatus,
      archivedAt: accounts.archivedAt,
      recordRevision: playerEnrollments.recordRevision,
      trainingStartOn: playerEnrollments.trainingStartOn,
      batch: playerEnrollments.batch,
      level: playerEnrollments.level,
      academyPlan: playerEnrollments.academyPlan,
    }).from(accounts).innerJoin(
      playerEnrollments,
      eq(playerEnrollments.accountId, accounts.id),
    ).where(and(eq(accounts.id, playerId), eq(accounts.role, "player"))).get()
    if (!transactionPlayer
      || transactionPlayer.approvalStatus !== "approved"
      || transactionPlayer.archivedAt) {
      operationalActionError("NOT_FOUND", "Approved player was not found.", "playerId")
    }
    if (transactionPlayer.recordRevision !== player.recordRevision
      || transactionPlayer.trainingStartOn !== player.trainingStartOn
      || transactionPlayer.batch !== player.batch
      || transactionPlayer.level !== player.level
      || transactionPlayer.academyPlan !== player.academyPlan) {
      operationalActionError(
        "CONFLICT",
        "The player changed while this assignment was being prepared. Refresh and try again.",
        "playerId",
      )
    }
    const transactionSeries = tx.select().from(sessionSeries).where(and(
      eq(sessionSeries.id, seriesId),
      eq(sessionSeries.status, "active"),
    )).get()
    if (!transactionSeries) {
      operationalActionError("NOT_FOUND", "The selected schedule is unavailable.", "seriesId")
    }
    const activeAssignments = tx.select().from(sessionAssignments).where(and(
      eq(sessionAssignments.accountId, playerId),
      isNull(sessionAssignments.effectiveTo),
    )).all()
    if (activeAssignments.some((assignment) => assignment.seriesId === seriesId)) {
      operationalActionError(
        "CONFLICT",
        "The player is already assigned to this session.",
        "playerId",
      )
    }
    const allSeries = tx.select().from(sessionSeries).all()
    const allRules = tx.select().from(sessionRecurrenceRules).all()
    const allAssignmentWeekdays = tx.select().from(sessionAssignmentWeekdays).all()
    const toDomainSeries = (row: typeof allSeries[number]) => ({
      ...row,
      slots: allRules.filter((rule) => rule.seriesId === row.id),
    })
    const targetDomainSeries = toDomainSeries(transactionSeries)
    const targetSeries = {
      ...targetDomainSeries,
      slots: targetDomainSeries.slots.filter((slot) => selectedWeekdays.includes(slot.weekday)),
    }
    const overlaps = activeAssignments.some((assignment) => {
      const existingRow = allSeries.find((item) => item.id === assignment.seriesId)
      if (!existingRow) return false
      const existingDays = allAssignmentWeekdays
        .filter((item) => item.assignmentId === assignment.id)
        .map((item) => item.weekday)
      const existingDomainSeries = toDomainSeries(existingRow)
      const existingSeries = {
        ...existingDomainSeries,
        slots: existingDomainSeries.slots.filter((slot) => existingDays.includes(slot.weekday)),
      }
      const datesOverlap = dateRangesOverlapInclusive(
        {
          startsOn: assignment.effectiveFrom,
          endsOn: assignment.effectiveTo ?? existingSeries.endsOn,
        },
        { startsOn: effectiveFrom, endsOn: targetSeries.endsOn },
      )
      return datesOverlap && sessionSlotsOverlap(existingSeries, targetSeries)
    })
    if (overlaps) {
      operationalActionError(
        "CONFLICT",
        "This session overlaps another active assignment for the player.",
        "seriesId",
      )
    }
    const activeAssignmentIds = new Set(activeAssignments.map((assignment) => assignment.id))
    const activeWeekdays = tx.select().from(sessionAssignmentWeekdays).all()
      .filter((item) => activeAssignmentIds.has(item.assignmentId))
    const weekdayGroups = activeAssignments.map((assignment) => activeWeekdays
      .filter((item) => item.assignmentId === assignment.id)
      .map((item) => item.weekday))
    assertActiveAssignmentCoverage(academyPlan, [...weekdayGroups, selectedWeekdays])

    const assignmentId = randomUUID()
    tx.insert(sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      seriesId,
      effectiveFrom,
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    tx.insert(sessionAssignmentWeekdays).values(selectedWeekdays.map((weekday) => ({
      id: randomUUID(),
      assignmentId,
      weekday,
    }))).run()
    tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      status: "active",
      updatedAt: now,
    }).where(eq(playerEnrollments.accountId, playerId)).run()
  }, { behavior: "immediate" })
}

export function endSessionAssignment({
  assignmentId,
  coachId,
  database,
  effectiveTo,
  now,
}: {
  assignmentId: string
  coachId: string
  database: SmbaDatabase
  effectiveTo: string
  now: Date
}) {
  requireHeadAdminAccess(coachId, { database })
  if (!isValidDateKey(effectiveTo)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid assignment end date.",
      "effectiveTo",
    )
  }
  if (effectiveTo > getIndiaDateKey(now)) {
    operationalActionError(
      "INVALID_INPUT",
      "Assignment end date cannot be in the future.",
      "effectiveTo",
    )
  }
  database.transaction((tx) => {
    const assignment = tx.select().from(sessionAssignments).where(and(
      eq(sessionAssignments.id, assignmentId),
      isNull(sessionAssignments.effectiveTo),
    )).get()
    if (!assignment) {
      operationalActionError(
        "NOT_FOUND",
        "The active session assignment was not found.",
        "assignmentId",
      )
    }
    if (effectiveTo < assignment.effectiveFrom) {
      operationalActionError(
        "INVALID_INPUT",
        "End date cannot precede assignment.",
        "effectiveTo",
      )
    }
    const enrollment = tx.select({ academyPlan: playerEnrollments.academyPlan })
      .from(playerEnrollments)
      .where(eq(playerEnrollments.accountId, assignment.accountId)).get()
    const remainingAssignments = tx.select().from(sessionAssignments).where(and(
      eq(sessionAssignments.accountId, assignment.accountId),
      isNull(sessionAssignments.effectiveTo),
    )).all().filter((item) => item.id !== assignment.id)
    if (enrollment?.academyPlan) {
      const remainingIds = new Set(remainingAssignments.map((item) => item.id))
      const remainingWeekdays = tx.select().from(sessionAssignmentWeekdays).all()
        .filter((item) => remainingIds.has(item.assignmentId))
      assertActiveAssignmentCoverage(
        enrollment.academyPlan,
        remainingAssignments.map((item) => remainingWeekdays
          .filter((weekday) => weekday.assignmentId === item.id)
          .map((weekday) => weekday.weekday)),
        { allowNoAssignments: true },
      )
    }
    tx.update(sessionAssignments).set({ effectiveTo })
      .where(eq(sessionAssignments.id, assignment.id)).run()
    const remaining = tx.select({ id: sessionAssignments.id }).from(sessionAssignments).where(and(
      eq(sessionAssignments.accountId, assignment.accountId),
      isNull(sessionAssignments.effectiveTo),
    )).get()
    tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      status: remaining ? "active" : "paused",
      updatedAt: now,
    }).where(eq(playerEnrollments.accountId, assignment.accountId)).run()
  }, { behavior: "immediate" })
}

export function saveSessionAttendanceRecords({
  changes,
  coachId,
  database,
  now,
  referenceDate,
}: {
  changes: SessionAttendanceChange[]
  coachId: string
  database: SmbaDatabase
  now: Date
  referenceDate: string
}) {
  requireHeadAdminAccess(coachId, { database })
  if (!changes.length) return { applied: 0 }
  const unique = new Set<string>()
  return database.transaction((tx) => {
    let applied = 0
    const affectedDates = new Map<string, {
      completedOn: string
      hadOrdinaryPresence: boolean
      playerId: string
    }>()
    const occurrenceIds = [...new Set(changes.map((change) => change.occurrenceId))]
    const resolvedOccurrences = resolveOccurrenceEligibilityDates(
      tx,
      tx.select().from(sessionOccurrences)
        .where(inArray(sessionOccurrences.id, occurrenceIds)).all(),
    )
    const occurrenceById = new Map(resolvedOccurrences.map((occurrence) => [occurrence.id, occurrence]))

    /*
     * Every read this loop needs, fetched once for the whole register rather
     * than once per row. Production runs libSQL over the network with the
     * synchronous driver, so each of these was a blocking round trip inside an
     * `immediate` write lock: eight per changed player, which is roughly 180
     * for a 22-player roster against the recorder's 20-second deadline, with
     * every other writer in the academy queued behind them.
     *
     * Order of validation below is unchanged -- only the source of the data is.
     * All six run before any insert, which is what the pre-insert reads
     * (`stored`, `hadOrdinaryPresence`) relied on anyway: no change can observe
     * another change's write, because (accountId, occurrenceId) is unique and
     * `unique` already rejects a repeated pair.
     */
    const playerIds = [...new Set(changes.map((change) => change.playerId))]
    const seriesIds = [...new Set(
      changes.map((change) => occurrenceById.get(change.occurrenceId)?.seriesId).filter(Boolean),
    )] as string[]
    const occurrenceDates = [...new Set(
      changes.map((change) => occurrenceById.get(change.occurrenceId)?.occurrenceDate).filter(Boolean),
    )] as string[]

    const enrollmentByPlayer = new Map(
      tx.select({
        accountId: playerEnrollments.accountId,
        trainingStartOn: playerEnrollments.trainingStartOn,
      })
        .from(playerEnrollments)
        .innerJoin(accounts, eq(accounts.id, playerEnrollments.accountId))
        .where(and(
          inArray(playerEnrollments.accountId, playerIds),
          eq(accounts.role, "player"),
          eq(accounts.approvalStatus, "approved"),
          isNull(accounts.archivedAt),
        )).all()
        .map((row) => [row.accountId, row]),
    )

    const assignmentRows = seriesIds.length
      ? tx.select().from(sessionAssignments).where(and(
        inArray(sessionAssignments.accountId, playerIds),
        inArray(sessionAssignments.seriesId, seriesIds),
      )).all()
      : []
    const assignmentsByPlayerSeries = new Map<string, typeof assignmentRows>()
    assignmentRows.forEach((assignment) => {
      const key = `${assignment.accountId}:${assignment.seriesId}`
      const bucket = assignmentsByPlayerSeries.get(key)
      if (bucket) bucket.push(assignment)
      else assignmentsByPlayerSeries.set(key, [assignment])
    })

    const allAssignmentIds = assignmentRows.map((assignment) => assignment.id)
    const weekdaysByAssignment = new Map<string, number[]>()
    if (allAssignmentIds.length) {
      tx.select().from(sessionAssignmentWeekdays)
        .where(inArray(sessionAssignmentWeekdays.assignmentId, allAssignmentIds)).all()
        .forEach((weekday) => {
          const bucket = weekdaysByAssignment.get(weekday.assignmentId)
          if (bucket) bucket.push(weekday.weekday)
          else weekdaysByAssignment.set(weekday.assignmentId, [weekday.weekday])
        })
    }

    const storedByPlayerOccurrence = new Map(
      tx.select({
        accountId: sessionAttendanceRecords.accountId,
        occurrenceId: sessionAttendanceRecords.occurrenceId,
        choice: sessionAttendanceRecords.choice,
      }).from(sessionAttendanceRecords).where(and(
        inArray(sessionAttendanceRecords.accountId, playerIds),
        inArray(sessionAttendanceRecords.occurrenceId, occurrenceIds),
      )).all()
        .map((row) => [`${row.accountId}:${row.occurrenceId}`, row.choice]),
    )

    const activeAdjustmentByPlayerSource = new Set(
      tx.select({
        playerId: attendanceAdjustments.playerId,
        sourceOccurrenceId: attendanceAdjustments.sourceOccurrenceId,
      }).from(attendanceAdjustments).where(and(
        inArray(attendanceAdjustments.playerId, playerIds),
        inArray(attendanceAdjustments.sourceOccurrenceId, occurrenceIds),
        isNull(attendanceAdjustments.voidedAt),
      )).all()
        .map((row) => `${row.playerId}:${row.sourceOccurrenceId}`),
    )

    const ordinaryPresenceByPlayerDate = new Set(
      occurrenceDates.length
        ? tx.select({
          accountId: sessionAttendanceRecords.accountId,
          occurrenceDate: sessionOccurrences.occurrenceDate,
        }).from(sessionAttendanceRecords)
          .innerJoin(
            sessionOccurrences,
            eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId),
          ).where(and(
            inArray(sessionAttendanceRecords.accountId, playerIds),
            eq(sessionAttendanceRecords.choice, "present"),
            inArray(sessionOccurrences.occurrenceDate, occurrenceDates),
          )).all()
          .map((row) => `${row.accountId}:${row.occurrenceDate}`)
        : [],
    )

    const pendingRecords: Array<typeof sessionAttendanceRecords.$inferInsert> = []

    changes.forEach((change) => {
      const key = `${change.playerId}:${change.occurrenceId}`
      if (unique.has(key)) {
        operationalActionError(
          "INVALID_INPUT",
          "Attendance contains duplicate changes.",
          "changes",
        )
      }
      unique.add(key)
      if (change.choice !== "present"
        && change.choice !== "absent"
        && change.choice !== "cleared") {
        operationalActionError(
          "INVALID_INPUT",
          "Choose a valid attendance result.",
          "changes",
        )
      }
      if (change.expectedChoice !== "present"
        && change.expectedChoice !== "absent"
        && change.expectedChoice !== "cleared") {
        operationalActionError(
          "INVALID_INPUT",
          "Attendance is missing its original result. Refresh and try again.",
          "changes",
        )
      }
      const occurrence = occurrenceById.get(change.occurrenceId)
      if (!occurrence || occurrence.status !== "scheduled") {
        operationalActionError(
          "NOT_FOUND",
          "The selected session is unavailable.",
          "changes",
        )
      }
      if (occurrence.occurrenceDate > referenceDate || occurrenceIsUpcoming(occurrence, now)) {
        operationalActionError(
          "BUSINESS_RULE",
          "Attendance cannot be marked for a future session.",
          "changes",
        )
      }
      const enrollment = enrollmentByPlayer.get(change.playerId)
      if (!enrollment) {
        operationalActionError(
          "NOT_FOUND",
          "The selected player is unavailable.",
          "changes",
        )
      }
      if (!playerWasEnrolledForOccurrence(enrollment.trainingStartOn, occurrence)) {
        operationalActionError(
          "BUSINESS_RULE",
          "The player was not enrolled for this session.",
          "changes",
        )
      }
      const assignments = assignmentsByPlayerSeries.get(`${change.playerId}:${occurrence.seriesId}`) ?? []
      const assignment = assignments.find((item) => assignmentCoversOccurrence({
        ...item,
        weekdays: weekdaysByAssignment.get(item.id) ?? [],
      }, occurrence))
      if (!assignment) {
        operationalActionError(
          "BUSINESS_RULE",
          "The player was not assigned to this session day.",
          "changes",
        )
      }

      const currentChoice: SessionAttendanceChange["choice"] =
        storedByPlayerOccurrence.get(`${change.playerId}:${change.occurrenceId}`) ?? "cleared"
      if (currentChoice === change.choice) return
      if (currentChoice !== change.expectedChoice) {
        operationalActionError(
          "CONFLICT",
          "Player attendance changed since this page was opened. Refresh and try again.",
          "changes",
        )
      }

      const activeSourceAdjustment = activeAdjustmentByPlayerSource
        .has(`${change.playerId}:${change.occurrenceId}`)
      if (activeSourceAdjustment && change.choice !== "absent") {
        operationalActionError(
          "BUSINESS_RULE",
          "Void the attendance adjustment before changing its source absence.",
          "changes",
        )
      }

      const affectedDateKey = `${change.playerId}:${occurrence.occurrenceDate}`
      if (!affectedDates.has(affectedDateKey)) {
        const hadOrdinaryPresence = ordinaryPresenceByPlayerDate
          .has(`${change.playerId}:${occurrence.occurrenceDate}`)
        affectedDates.set(affectedDateKey, {
          completedOn: occurrence.occurrenceDate,
          hadOrdinaryPresence,
          playerId: change.playerId,
        })
      }

      pendingRecords.push({
        id: randomUUID(),
        accountId: change.playerId,
        occurrenceId: change.occurrenceId,
        choice: change.choice,
        markedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      })
      applied += 1
    })

    /*
     * One statement for the whole register. `set` has to read from `excluded`
     * rather than a captured value, because a multi-row upsert shares one SET
     * clause across rows that each carry their own choice.
     */
    if (pendingRecords.length) {
      tx.insert(sessionAttendanceRecords).values(pendingRecords).onConflictDoUpdate({
        target: [sessionAttendanceRecords.accountId, sessionAttendanceRecords.occurrenceId],
        set: {
          choice: sql`excluded.choice`,
          markedByAccountId: sql`excluded.marked_by_account_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      }).run()
    }

    /*
     * The ninth per-player read. This ran once per (player, date) pair and
     * opened with an unbatched select each time, so a twelve-player register
     * paid twelve blocking round trips here for adjustments that, on almost
     * every register, do not exist. Batched it is one, whatever the roster.
     */
    reconcileAttendanceAdjustmentReviewStates({
      database: tx,
      now,
      targets: [...affectedDates.values()].map(({
        completedOn,
        hadOrdinaryPresence,
        playerId,
      }) => ({ completedOn, lostFinalPresence: hadOrdinaryPresence, playerId })),
    })
    return { applied }
  }, { behavior: "immediate" })
}

export function cancelSessionOccurrence({
  coachId,
  database,
  now,
  occurrenceId,
  referenceDate,
}: {
  coachId: string
  database: SmbaDatabase
  now: Date
  occurrenceId: string
  referenceDate: string
}) {
  requireHeadAdminAccess(coachId, { database })
  return database.transaction((tx) => {
    const occurrence = tx.select().from(sessionOccurrences)
      .where(eq(sessionOccurrences.id, occurrenceId)).get()
    if (!occurrence) {
      operationalActionError("NOT_FOUND", "Session was not found.", "occurrenceId")
    }
    const replacements = tx.select().from(sessionOccurrences).where(
      eq(sessionOccurrences.replacementForOccurrenceId, occurrenceId),
    ).all()
    if (occurrence.status === "cancelled") {
      if (replacements.length) {
        operationalActionError(
          "CONFLICT",
          "This session was already replaced and cannot be cancelled separately.",
          "occurrenceId",
        )
      }
      return { alreadyCancelled: true }
    }
    if (replacements.length) {
      operationalActionError(
        "CONFLICT",
        "This session has already changed. Reload the calendar and try again.",
        "occurrenceId",
      )
    }
    if (occurrence.occurrenceDate < referenceDate || !occurrenceIsUpcoming(occurrence, now)) {
      operationalActionError(
        "BUSINESS_RULE",
        "Completed sessions cannot be cancelled.",
        "occurrenceId",
      )
    }
    const cancelled = tx.update(sessionOccurrences).set({ status: "cancelled" }).where(and(
      eq(sessionOccurrences.id, occurrenceId),
      eq(sessionOccurrences.status, "scheduled"),
    )).run()
    if (cancelled.changes !== 1) {
      operationalActionError(
        "CONFLICT",
        "This session changed elsewhere. Reload the calendar and try again.",
        "occurrenceId",
      )
    }
    return { alreadyCancelled: false }
  }, { behavior: "immediate" })
}

function isSessionOccurrenceUniqueConstraint(error: unknown) {
  return error instanceof Error
    && "code" in error
    && String((error as Error & { code?: unknown }).code).startsWith("SQLITE_CONSTRAINT")
    && /session_occurrences/u.test(error.message)
}

export function replaceSessionOccurrence({
  coachId,
  database,
  dateKey,
  durationMinutes,
  now,
  occurrenceId,
  referenceDate,
  startTime,
  venue,
}: {
  coachId: string
  database: SmbaDatabase
  dateKey: string
  durationMinutes: number
  now: Date
  occurrenceId: string
  referenceDate: string
  startTime: string
  venue: string
}) {
  requireHeadAdminAccess(coachId, { database })
  if (!isValidDateKey(dateKey)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid replacement date.",
      "dateKey",
    )
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 300) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid session duration.",
      "durationMinutes",
    )
  }
  const normalizedVenue = venue.trim()
  if (normalizedVenue.length < 2 || normalizedVenue.length > 120) {
    operationalActionError("INVALID_INPUT", "Enter a valid venue or court.", "venue")
  }
  let startsAt: Date
  try {
    startsAt = indiaLocalDateTime(dateKey, startTime)
  } catch {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid replacement time.",
      "startTime",
    )
  }
  const [startHours, startMinutes] = startTime.split(":").map(Number)
  if ((startHours * 60) + startMinutes + durationMinutes >= 24 * 60) {
    operationalActionError(
      "INVALID_INPUT",
      "A replacement session cannot cross midnight.",
      "durationMinutes",
    )
  }
  try {
    return database.transaction((tx) => {
      const occurrence = tx.select().from(sessionOccurrences)
        .where(eq(sessionOccurrences.id, occurrenceId)).get()
      if (!occurrence) {
        operationalActionError("NOT_FOUND", "Session was not found.", "occurrenceId")
      }
      const sourceSeries = tx.select().from(sessionSeries)
        .where(eq(sessionSeries.id, occurrence.seriesId)).get()
      if (!sourceSeries || sourceSeries.status !== "active") {
        operationalActionError("NOT_FOUND", "The recurring schedule is unavailable.", "occurrenceId")
      }
      const replacements = tx.select().from(sessionOccurrences).where(
        eq(sessionOccurrences.replacementForOccurrenceId, occurrenceId),
      ).all()
      const exactReplacement = replacements.find((replacement) => (
        replacement.status === "scheduled"
        && replacement.occurrenceDate === dateKey
        && replacement.startsAt.getTime() === startsAt.getTime()
        && replacement.durationMinutes === durationMinutes
        && replacement.venue === normalizedVenue
      ))
      if (occurrence.status === "cancelled") {
        if (exactReplacement) {
          return { alreadyReplaced: true, replacementOccurrenceId: exactReplacement.id }
        }
        operationalActionError(
          "CONFLICT",
          replacements.length
            ? "This session was already replaced with different details."
            : "This session was already cancelled.",
          "occurrenceId",
        )
      }
      if (replacements.length) {
        operationalActionError(
          "CONFLICT",
          "This session has already changed. Reload the calendar and try again.",
          "occurrenceId",
        )
      }
      if (occurrence.occurrenceDate < referenceDate
        || dateKey < referenceDate
        || !occurrenceIsUpcoming(occurrence, now)) {
        operationalActionError(
          "BUSINESS_RULE",
          "Completed sessions cannot be replaced.",
          "dateKey",
        )
      }
      if (!occurrenceIsUpcoming({ startsAt }, now)) {
        operationalActionError(
          "BUSINESS_RULE",
          "Choose a replacement time in the future.",
          "startTime",
        )
      }
      const maximumTermEnd = addCalendarDays(
        sourceSeries.startsOn,
        MAX_SCHEDULE_TERM_DAYS - 1,
      )
      const latestReplacementDate = sourceSeries.endsOn && sourceSeries.endsOn < maximumTermEnd
        ? sourceSeries.endsOn
        : maximumTermEnd
      if (dateKey < sourceSeries.startsOn || dateKey > latestReplacementDate) {
        operationalActionError(
          "INVALID_INPUT",
          "Choose a replacement date within the recurring schedule term.",
          "dateKey",
        )
      }
      const occupiedTarget = tx.select().from(sessionOccurrences).where(and(
        eq(sessionOccurrences.seriesId, occurrence.seriesId),
        eq(sessionOccurrences.occurrenceDate, dateKey),
        eq(sessionOccurrences.status, "scheduled"),
      )).all().find((candidate) => candidate.id !== occurrence.id)
      if (occupiedTarget) {
        operationalActionError(
          "CONFLICT",
          "This schedule already has a session on the selected replacement date.",
          "dateKey",
        )
      }
      const sameDayOccurrences = tx.select().from(sessionOccurrences).where(and(
        eq(sessionOccurrences.occurrenceDate, dateKey),
        eq(sessionOccurrences.status, "scheduled"),
      )).all().filter((candidate) => candidate.id !== occurrence.id)
      const otherSeriesIds = [...new Set(sameDayOccurrences
        .map((candidate) => candidate.seriesId)
        .filter((candidateSeriesId) => candidateSeriesId !== occurrence.seriesId))]
      const otherSeries = otherSeriesIds.length
        ? tx.select().from(sessionSeries).where(inArray(sessionSeries.id, otherSeriesIds)).all()
        : []
      const otherSeriesById = new Map(otherSeries.map((series) => [series.id, series]))
      const overlapsAnotherSchedule = sameDayOccurrences.some((candidate) => {
        const candidateSeries = otherSeriesById.get(candidate.seriesId)
        if (!candidateSeries
          || candidateSeries.programme !== sourceSeries.programme
          || candidateSeries.batch !== sourceSeries.batch) return false
        return occurrenceIntervalsOverlap(
          { durationMinutes, startsAt },
          candidate,
        )
      })
      if (overlapsAnotherSchedule) {
        operationalActionError(
          "CONFLICT",
          "Another schedule for this level and batch overlaps the replacement time.",
          "startTime",
        )
      }
      const cancelled = tx.update(sessionOccurrences).set({ status: "cancelled" }).where(and(
        eq(sessionOccurrences.id, occurrenceId),
        eq(sessionOccurrences.status, "scheduled"),
      )).run()
      if (cancelled.changes !== 1) {
        operationalActionError(
          "CONFLICT",
          "This session changed elsewhere. Reload the calendar and try again.",
          "occurrenceId",
        )
      }
      const replacementOccurrenceId = randomUUID()
      tx.insert(sessionOccurrences).values({
        id: replacementOccurrenceId,
        seriesId: occurrence.seriesId,
        occurrenceDate: dateKey,
        startsAt,
        durationMinutes,
        venue: normalizedVenue,
        status: "scheduled",
        replacementForOccurrenceId: occurrence.id,
        createdAt: now,
      }).run()
      return { alreadyReplaced: false, replacementOccurrenceId }
    }, { behavior: "immediate" })
  } catch (error) {
    if (error instanceof OperationalActionError) throw error
    if (isSessionOccurrenceUniqueConstraint(error)) {
      operationalActionError(
        "CONFLICT",
        "This session or replacement changed elsewhere. Reload the calendar and try again.",
        "dateKey",
      )
    }
    throw error
  }
}

export function endSessionSeriesRecords({
  coachId,
  database,
  now = new Date(),
  seriesId,
}: {
  coachId: string
  database: SmbaDatabase
  now?: Date
  seriesId: string
}) {
  requireHeadAdminAccess(coachId, { database })
  if (typeof seriesId !== "string" || !seriesId.trim()) {
    operationalActionError("NOT_FOUND", "Schedule was not found.", "seriesId")
  }
  const referenceDate = getIndiaDateKey(now)

  return database.transaction((tx) => {
    const series = tx.select().from(sessionSeries)
      .where(eq(sessionSeries.id, seriesId)).get()
    if (!series) {
      operationalActionError("NOT_FOUND", "Schedule was not found.", "seriesId")
    }
    if (series.status === "ended") {
      return { alreadyEnded: true, cancelledOccurrences: 0, closedAssignments: 0 }
    }
    const occurrences = tx.select().from(sessionOccurrences).where(
      eq(sessionOccurrences.seriesId, seriesId),
    ).all()
    const startedToday = occurrences.some((occurrence) => (
      occurrence.status === "scheduled"
      && occurrence.occurrenceDate === referenceDate
      && !occurrenceIsUpcoming(occurrence, now)
    ))
    if (startedToday) {
      operationalActionError(
        "BUSINESS_RULE",
        "This schedule has already started today. End it before the first session on another day.",
        "seriesId",
      )
    }
    const futureOccurrenceIds = occurrences.filter((occurrence) => (
      occurrence.status === "scheduled" && occurrenceIsUpcoming(occurrence, now)
    )).map((occurrence) => occurrence.id)
    const openAssignments = tx.select().from(sessionAssignments).where(and(
      eq(sessionAssignments.seriesId, seriesId),
      isNull(sessionAssignments.effectiveTo),
    )).all()
    const ended = tx.update(sessionSeries).set({ status: "ended" }).where(and(
      eq(sessionSeries.id, seriesId),
      eq(sessionSeries.status, "active"),
    )).run()
    if (ended.changes !== 1) {
      operationalActionError(
        "CONFLICT",
        "This schedule changed elsewhere. Reload the roster and try again.",
        "seriesId",
      )
    }
    if (futureOccurrenceIds.length) {
      tx.update(sessionOccurrences).set({ status: "cancelled" }).where(and(
        inArray(sessionOccurrences.id, futureOccurrenceIds),
        eq(sessionOccurrences.status, "scheduled"),
      )).run()
    }
    openAssignments.forEach((assignment) => {
      tx.update(sessionAssignments).set({
        effectiveTo: assignment.effectiveFrom > referenceDate
          ? assignment.effectiveFrom
          : referenceDate,
      }).where(and(
        eq(sessionAssignments.id, assignment.id),
        isNull(sessionAssignments.effectiveTo),
      )).run()
    })
    const affectedPlayerIds = [...new Set(openAssignments.map((assignment) => assignment.accountId))]
    affectedPlayerIds.forEach((playerId) => {
      const remaining = tx.select({ id: sessionAssignments.id }).from(sessionAssignments).where(and(
        eq(sessionAssignments.accountId, playerId),
        isNull(sessionAssignments.effectiveTo),
      )).get()
      tx.update(playerEnrollments).set({
        recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
        status: remaining ? "active" : "paused",
        updatedAt: now,
      }).where(eq(playerEnrollments.accountId, playerId)).run()
    })
    return {
      alreadyEnded: false,
      cancelledOccurrences: futureOccurrenceIds.length,
      closedAssignments: openAssignments.length,
    }
  }, { behavior: "immediate" })
}
