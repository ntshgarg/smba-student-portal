import { randomUUID } from "node:crypto"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { isValidDateKey } from "@/lib/attendance/domain"
import { reconcileAttendanceAdjustmentReviewState } from "@/lib/attendance/adjustments"
import { operationalActionError } from "@/lib/actions/operational-result"
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
      && existingRules.some((rule) => (
        rule.seriesId === series.id
        && rule.startTime === input.startTime
        && rule.durationMinutes === input.durationMinutes
      ))
    ))
    if (conflicts) {
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
    occurrenceDrafts.forEach((draft) => {
      tx.insert(sessionOccurrences).values({
        id: randomUUID(),
        ...draft,
        status: "scheduled",
        replacementForOccurrenceId: null,
        createdAt: now,
      }).run()
    })
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
    joinedAt: playerEnrollments.joinedAt,
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
  const joinedOn = getIndiaDateKey(player.joinedAt)
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

  const currentAssignments = database.select().from(sessionAssignments).where(and(
    eq(sessionAssignments.accountId, playerId),
    isNull(sessionAssignments.effectiveTo),
  )).all()
  if (currentAssignments.some((assignment) => assignment.seriesId === seriesId)) {
    operationalActionError(
      "CONFLICT",
      "The player is already assigned to this session.",
      "playerId",
    )
  }
  const allSeries = database.select().from(sessionSeries).all()
  const allRules = database.select().from(sessionRecurrenceRules).all()
  const allAssignmentWeekdays = database.select().from(sessionAssignmentWeekdays).all()
  const toDomainSeries = (row: typeof allSeries[number]) => ({
    ...row,
    slots: allRules.filter((rule) => rule.seriesId === row.id),
  })
  const targetDomainSeries = toDomainSeries(series)
  const targetSeries = {
    ...targetDomainSeries,
    slots: targetDomainSeries.slots.filter((slot) => selectedWeekdays.includes(slot.weekday)),
  }
  const overlaps = currentAssignments.some((assignment) => {
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

  database.transaction((tx) => {
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
  })
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
  })
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
  if (!changes.length) return
  const unique = new Set<string>()
  database.transaction((tx) => {
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
      const enrollment = tx.select({ joinedAt: playerEnrollments.joinedAt })
        .from(playerEnrollments).where(eq(playerEnrollments.accountId, change.playerId)).get()
      if (!enrollment || !playerWasEnrolledForOccurrence(
        getIndiaDateKey(enrollment.joinedAt),
        occurrence,
      )) {
        operationalActionError(
          "BUSINESS_RULE",
          "The player was not enrolled for this session.",
          "changes",
        )
      }
      const assignments = tx.select().from(sessionAssignments).where(and(
        eq(sessionAssignments.accountId, change.playerId),
        eq(sessionAssignments.seriesId, occurrence.seriesId),
      )).all()
      const assignmentIds = assignments.map((assignment) => assignment.id)
      const assignedWeekdays = assignmentIds.length
        ? tx.select().from(sessionAssignmentWeekdays).where(inArray(
            sessionAssignmentWeekdays.assignmentId,
            assignmentIds,
          )).all()
        : []
      const assignment = assignments.find((item) => assignmentCoversOccurrence({
        ...item,
        weekdays: assignedWeekdays
          .filter((weekday) => weekday.assignmentId === item.id)
          .map((weekday) => weekday.weekday),
      }, occurrence))
      if (!assignment) {
        operationalActionError(
          "BUSINESS_RULE",
          "The player was not assigned to this session day.",
          "changes",
        )
      }

      const activeSourceAdjustment = tx.select({ id: attendanceAdjustments.id })
        .from(attendanceAdjustments).where(and(
          eq(attendanceAdjustments.playerId, change.playerId),
          eq(attendanceAdjustments.sourceOccurrenceId, change.occurrenceId),
          isNull(attendanceAdjustments.voidedAt),
        )).get()
      if (activeSourceAdjustment && change.choice !== "absent") {
        operationalActionError(
          "BUSINESS_RULE",
          "Void the attendance adjustment before changing its source absence.",
          "changes",
        )
      }

      const affectedDateKey = `${change.playerId}:${occurrence.occurrenceDate}`
      if (!affectedDates.has(affectedDateKey)) {
        const hadOrdinaryPresence = Boolean(tx.select({ id: sessionAttendanceRecords.id })
          .from(sessionAttendanceRecords)
          .innerJoin(
            sessionOccurrences,
            eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId),
          ).where(and(
            eq(sessionAttendanceRecords.accountId, change.playerId),
            eq(sessionAttendanceRecords.choice, "present"),
            eq(sessionOccurrences.occurrenceDate, occurrence.occurrenceDate),
          )).get())
        affectedDates.set(affectedDateKey, {
          completedOn: occurrence.occurrenceDate,
          hadOrdinaryPresence,
          playerId: change.playerId,
        })
      }

      tx.insert(sessionAttendanceRecords).values({
        id: randomUUID(),
        accountId: change.playerId,
        occurrenceId: change.occurrenceId,
        choice: change.choice,
        markedByAccountId: coachId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [sessionAttendanceRecords.accountId, sessionAttendanceRecords.occurrenceId],
        set: { choice: change.choice, markedByAccountId: coachId, updatedAt: now },
      }).run()
    })

    affectedDates.forEach(({ completedOn, hadOrdinaryPresence, playerId }) => {
      reconcileAttendanceAdjustmentReviewState({
        database: tx as unknown as SmbaDatabase,
        playerId,
        completedOn,
        lostFinalPresence: hadOrdinaryPresence,
        now,
      })
    })
  })
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
  const occurrence = database.select().from(sessionOccurrences)
    .where(eq(sessionOccurrences.id, occurrenceId)).get()
  if (!occurrence || occurrence.status !== "scheduled") {
    operationalActionError("NOT_FOUND", "Session was not found.", "occurrenceId")
  }
  if (occurrence.occurrenceDate < referenceDate || !occurrenceIsUpcoming(occurrence, now)) {
    operationalActionError(
      "BUSINESS_RULE",
      "Completed sessions cannot be cancelled.",
      "occurrenceId",
    )
  }
  database.update(sessionOccurrences).set({ status: "cancelled" })
    .where(eq(sessionOccurrences.id, occurrenceId)).run()
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
  const occurrence = database.select().from(sessionOccurrences)
    .where(eq(sessionOccurrences.id, occurrenceId)).get()
  if (!occurrence || occurrence.status !== "scheduled") {
    operationalActionError("NOT_FOUND", "Session was not found.", "occurrenceId")
  }
  if (!isValidDateKey(dateKey)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid replacement date.",
      "dateKey",
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
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 300) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid session duration.",
      "durationMinutes",
    )
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
  if (!occurrenceIsUpcoming({ startsAt }, now)) {
    operationalActionError(
      "BUSINESS_RULE",
      "Choose a replacement time in the future.",
      "startTime",
    )
  }
  database.transaction((tx) => {
    tx.update(sessionOccurrences).set({ status: "cancelled" })
      .where(eq(sessionOccurrences.id, occurrenceId)).run()
    tx.insert(sessionOccurrences).values({
      id: randomUUID(),
      seriesId: occurrence.seriesId,
      occurrenceDate: dateKey,
      startsAt,
      durationMinutes,
      venue: venue.trim() || occurrence.venue,
      status: "scheduled",
      replacementForOccurrenceId: occurrence.id,
      createdAt: now,
    }).run()
  })
}
