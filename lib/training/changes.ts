import "server-only"

import { randomUUID } from "node:crypto"

import { and, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm"

import {
  OperationalActionError,
  operationalActionError,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import type { SmbaDatabase, SmbaDatabaseExecutor } from "@/lib/db/client"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  attendanceAdjustments,
  feeAgreements,
  financialCharges,
  playerEnrollments,
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
  sessionRecurrenceRules,
  sessionSeries,
  trainingChanges,
} from "@/lib/db/schema"
import {
  FinanceServiceError,
  applyChargeAdjustmentInTransaction,
  correctFeeAgreementInTransaction,
  createFeeAgreementInTransaction,
  endFeeAgreementInTransaction,
  isFinanceActive,
} from "@/lib/finance/service"
import { loadChargeView } from "@/lib/finance/repository"
import { getAcademyDateKey } from "@/lib/format"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanAssignmentLimit,
  academyPlanIsValid,
  academyPlanLabel,
  academyPlanRequiredWeekdayCount,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

/*
 * Training changes made from a player's record in Members (head coach, 5 Oct
 * 2026). Two kinds of change, two timings:
 *
 * - A real change of schedule, days, plan or level, and stopping training, are
 *   month-wise. They are stored as a scheduled `training_changes` row for the
 *   1st of next month and applied on or after that day, all at once, in one
 *   transaction: old schedule ends, level/plan updates, new schedule starts,
 *   new fee. Every date written is the row's `effective_on`, never the day it
 *   happened to be applied, so the result does not depend on who opened the
 *   portal first.
 * - A mistake is corrected now, for the current month only: the wrong schedule
 *   stops covering this month, its marks this month are cleared (not moved; the
 *   coach marks them again), the right schedule starts from the 1st, and this
 *   month's fee is corrected in the same step. Earlier months are untouched.
 *
 * Ending training immediately ("he has left already") is the one same-day path.
 */

export type TrainingSelection = {
  academyPlan: AcademyPlan
  batch: TrainingBatch
  level: TrainingProgramme
  playerId: string
  seriesId: string
  weekdays: number[]
}

type TrainingContext = {
  coachId: string
  createId?: () => string
  database?: SmbaDatabase
  now?: Date
}

type Executor = SmbaDatabaseExecutor

export function monthStartOf(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`
}

export function nextMonthStartOf(dateKey: string) {
  const [year, month] = dateKey.slice(0, 7).split("-").map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return next.toISOString().slice(0, 10)
}

function monthEndOf(dateKey: string) {
  const [year, month] = dateKey.slice(0, 7).split("-").map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function previousMonthKey(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number)
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

function laterOf(first: string, second: string) {
  return first > second ? first : second
}

function asOperationalError(error: unknown): never {
  if (error instanceof FinanceServiceError) {
    operationalActionError("BUSINESS_RULE", error.message)
  }
  throw error
}

function requirePlayer(database: Executor, playerId: string) {
  const player = database.select({
    approvalStatus: accounts.approvalStatus,
    archivedAt: accounts.archivedAt,
    fullName: accounts.fullName,
    recordRevision: playerEnrollments.recordRevision,
    trainingStartOn: playerEnrollments.trainingStartOn,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(eq(accounts.id, playerId), eq(accounts.role, "player")))
    .get()
  if (!player || player.approvalStatus !== "approved" || player.archivedAt) {
    operationalActionError("NOT_FOUND", "This player is not available.", "playerId")
  }
  return player
}

function openAssignments(database: Executor, playerId: string) {
  return database.select().from(sessionAssignments).where(and(
    eq(sessionAssignments.accountId, playerId),
    isNull(sessionAssignments.effectiveTo),
  )).all()
}

function scheduledChange(database: Executor, playerId: string) {
  return database.select().from(trainingChanges).where(and(
    eq(trainingChanges.playerAccountId, playerId),
    eq(trainingChanges.status, "scheduled"),
  )).get()
}

/**
 * Everything a new schedule must satisfy, checked against the date it starts.
 * Returns the cleaned weekday list.
 */
function validateSelection(
  database: Executor,
  selection: TrainingSelection,
  startsOn: string,
) {
  if (!academyPlanIsValid(selection.academyPlan, selection.level, selection.batch)) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose an Academy Plan that suits this level and batch.",
      "academyPlan",
    )
  }
  const series = database.select().from(sessionSeries)
    .where(eq(sessionSeries.id, selection.seriesId)).get()
  if (!series || series.status !== "active") {
    operationalActionError("NOT_FOUND", "Choose an active schedule.", "seriesId")
  }
  if (series.programme !== selection.level || series.batch !== selection.batch) {
    operationalActionError(
      "INVALID_INPUT",
      "The schedule must match the chosen level and batch.",
      "seriesId",
    )
  }
  if (series.startsOn > startsOn) {
    operationalActionError(
      "BUSINESS_RULE",
      `That schedule only starts on ${series.startsOn}. Choose one that is running by ${startsOn}.`,
      "seriesId",
    )
  }
  if (series.endsOn && series.endsOn < startsOn) {
    operationalActionError("BUSINESS_RULE", "That schedule ends before the change starts.", "seriesId")
  }
  const offered = new Set(database.select({ weekday: sessionRecurrenceRules.weekday })
    .from(sessionRecurrenceRules)
    .where(eq(sessionRecurrenceRules.seriesId, series.id))
    .all()
    .map((rule) => rule.weekday))
  const weekdays = [...new Set(selection.weekdays)].sort((first, second) => first - second)
  if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || !offered.has(day))) {
    operationalActionError("INVALID_INPUT", "Choose training days that this schedule offers.", "weekdays")
  }
  const required = academyPlanRequiredWeekdayCount(selection.academyPlan)
  if (required !== null && weekdays.length !== required) {
    operationalActionError(
      "INVALID_INPUT",
      `${academyPlanLabel(selection.academyPlan)} needs exactly ${required} training days.`,
      "weekdays",
    )
  }
  if (required === null && weekdays.length > academyPlanAssignmentLimit(selection.academyPlan)) {
    operationalActionError("INVALID_INPUT", "The Weekend plan allows at most two days.", "weekdays")
  }
  return { series, weekdays }
}

function validateFee(monthlyFeePaise: number | null, financeActive: boolean) {
  if (!financeActive) return null
  if (typeof monthlyFeePaise !== "number"
    || !Number.isSafeInteger(monthlyFeePaise)
    || monthlyFeePaise <= 0
    || monthlyFeePaise > 1_000_000_000) {
    operationalActionError("INVALID_INPUT", "Enter the monthly fee.", "monthlyFeePaise")
  }
  return monthlyFeePaise
}

/** The plan in force on a date (active or ended), and the active one if different. */
function agreementsAround(database: Executor, playerId: string, dateKey: string) {
  const covering = database.select().from(feeAgreements).where(and(
    eq(feeAgreements.playerAccountId, playerId),
    ne(feeAgreements.status, "paused"),
    lte(feeAgreements.effectiveFrom, dateKey),
    or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, dateKey)),
  )).get()
  const active = database.select().from(feeAgreements).where(and(
    eq(feeAgreements.playerAccountId, playerId),
    eq(feeAgreements.status, "active"),
  )).get()
  return { active, covering }
}

/* ------------------------------------------------------------------ */
/* Scheduling: change training, or end it, from the 1st of next month  */
/* ------------------------------------------------------------------ */

export type ScheduleChangeInput = TrainingSelection & { monthlyFeePaise: number | null }

export function scheduleTrainingChange(
  input: ScheduleChangeInput,
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  return database.transaction((tx) => {
    requirePlayer(tx, input.playerId)
    const today = getAcademyDateKey(now)
    const effectiveOn = nextMonthStartOf(today)
    const { weekdays } = validateSelection(tx, input, effectiveOn)
    const financeActive = isFinanceActive(tx)
    const fee = validateFee(input.monthlyFeePaise, financeActive)
    if (financeActive) {
      const { active } = agreementsAround(tx, input.playerId, today)
      if (active && active.effectiveFrom >= effectiveOn) {
        operationalActionError(
          "CONFLICT",
          "A new fee already starts next month. Cancel that fee change before changing training.",
        )
      }
    }

    const values = {
      academyPlan: input.academyPlan,
      batch: input.batch,
      effectiveOn,
      level: input.level,
      monthlyFeePaise: fee,
      seriesId: input.seriesId,
      stopFees: false,
      updatedAt: now,
      weekdays: JSON.stringify(weekdays),
    }
    const existing = scheduledChange(tx, input.playerId)
    if (existing) {
      tx.update(trainingChanges).set({ ...values, kind: "change" })
        .where(eq(trainingChanges.id, existing.id)).run()
      return { changeId: existing.id, effectiveOn }
    }
    const changeId = createId()
    tx.insert(trainingChanges).values({
      ...values,
      createdAt: now,
      createdByAccountId: coachId,
      id: changeId,
      kind: "change",
      playerAccountId: input.playerId,
      status: "scheduled",
    }).run()
    return { changeId, effectiveOn }
  }, { behavior: "immediate" })
}

export function scheduleEndOfTraining(
  input: { playerId: string; stopFees: boolean },
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  return database.transaction((tx) => {
    requirePlayer(tx, input.playerId)
    if (!openAssignments(tx, input.playerId).length) {
      operationalActionError("BUSINESS_RULE", "This player is not on any schedule.")
    }
    const effectiveOn = nextMonthStartOf(getAcademyDateKey(now))
    const values = {
      academyPlan: null,
      batch: null,
      effectiveOn,
      kind: "end" as const,
      level: null,
      monthlyFeePaise: null,
      seriesId: null,
      stopFees: Boolean(input.stopFees),
      updatedAt: now,
      weekdays: "[]",
    }
    const existing = scheduledChange(tx, input.playerId)
    if (existing) {
      tx.update(trainingChanges).set(values).where(eq(trainingChanges.id, existing.id)).run()
      return { changeId: existing.id, effectiveOn }
    }
    const changeId = createId()
    tx.insert(trainingChanges).values({
      ...values,
      createdAt: now,
      createdByAccountId: coachId,
      id: changeId,
      playerAccountId: input.playerId,
      status: "scheduled",
    }).run()
    return { changeId, effectiveOn }
  }, { behavior: "immediate" })
}

export function cancelTrainingChange(
  input: { changeId: string },
  { coachId, database = initializeDatabase(), now = new Date() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  const result = database.update(trainingChanges).set({
    resolvedAt: now,
    status: "cancelled",
    updatedAt: now,
  }).where(and(
    eq(trainingChanges.id, input.changeId),
    eq(trainingChanges.status, "scheduled"),
  )).run()
  if (result.changes !== 1) {
    operationalActionError("NOT_FOUND", "This scheduled change has already happened or been cancelled.")
  }
}

/* ------------------------------------------------------------------ */
/* Applying due changes                                                */
/* ------------------------------------------------------------------ */

function endOpenAssignments(tx: Executor, playerId: string, endOn: string) {
  for (const assignment of openAssignments(tx, playerId)) {
    tx.update(sessionAssignments).set({
      effectiveTo: laterOf(assignment.effectiveFrom, endOn),
    }).where(eq(sessionAssignments.id, assignment.id)).run()
  }
}

function insertAssignment(
  tx: Executor,
  {
    actorId,
    createId,
    effectiveFrom,
    now,
    playerId,
    seriesId,
    weekdays,
  }: {
    actorId: string
    createId: () => string
    effectiveFrom: string
    now: Date
    playerId: string
    seriesId: string
    weekdays: number[]
  },
) {
  const assignmentId = createId()
  tx.insert(sessionAssignments).values({
    accountId: playerId,
    assignedAt: now,
    assignedByAccountId: actorId,
    effectiveFrom,
    effectiveTo: null,
    id: assignmentId,
    seriesId,
  }).run()
  for (const weekday of weekdays) {
    tx.insert(sessionAssignmentWeekdays).values({ assignmentId, id: createId(), weekday }).run()
  }
}

function applyChange(
  tx: Executor,
  change: typeof trainingChanges.$inferSelect,
  { createId, now }: { createId: () => string; now: Date },
) {
  const actorId = change.createdByAccountId
  const effectiveOn = change.effectiveOn
  requirePlayer(tx, change.playerAccountId)

  if (change.kind === "end") {
    endOpenAssignments(tx, change.playerAccountId, effectiveOn)
    tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      status: "paused",
      updatedAt: now,
    }).where(eq(playerEnrollments.accountId, change.playerAccountId)).run()
    if (change.stopFees && isFinanceActive(tx)) {
      const { active } = agreementsAround(tx, change.playerAccountId, effectiveOn)
      const finalMonth = previousMonthKey(effectiveOn)
      if (active && active.effectiveFrom.slice(0, 7) <= finalMonth) {
        endFeeAgreementInTransaction(tx, {
          agreementId: active.id,
          effectiveThroughPeriod: finalMonth,
          expectedRevision: active.recordRevision,
          idempotencyKey: `training-end:${change.id}`,
          reason: "Training ended from the player's record",
        }, { actorId, createId, now })
      }
    }
    return
  }

  const selection: TrainingSelection = {
    academyPlan: change.academyPlan as AcademyPlan,
    batch: change.batch as TrainingBatch,
    level: change.level as TrainingProgramme,
    playerId: change.playerAccountId,
    seriesId: change.seriesId ?? "",
    weekdays: JSON.parse(change.weekdays) as number[],
  }
  const { weekdays } = validateSelection(tx, selection, effectiveOn)
  endOpenAssignments(tx, change.playerAccountId, effectiveOn)
  tx.update(playerEnrollments).set({
    academyPlan: selection.academyPlan,
    batch: selection.batch,
    level: selection.level,
    recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
    status: "active",
    updatedAt: now,
  }).where(eq(playerEnrollments.accountId, change.playerAccountId)).run()
  insertAssignment(tx, {
    actorId,
    createId,
    effectiveFrom: effectiveOn,
    now,
    playerId: change.playerAccountId,
    seriesId: selection.seriesId,
    weekdays,
  })

  if (change.monthlyFeePaise !== null && isFinanceActive(tx)) {
    const { active } = agreementsAround(tx, change.playerAccountId, effectiveOn)
    const unchanged = active
      && active.level === selection.level
      && active.batch === selection.batch
      && active.academyPlan === selection.academyPlan
      && active.agreedMonthlyFeePaise === change.monthlyFeePaise
    if (!unchanged) {
      createFeeAgreementInTransaction(tx, {
        academyPlan: selection.academyPlan,
        agreedMonthlyFeePaise: change.monthlyFeePaise,
        batch: selection.batch,
        effectiveFrom: effectiveOn,
        expectedAgreementRevision: active?.recordRevision,
        idempotencyKey: `training-change:${change.id}`,
        level: selection.level,
        playerId: change.playerAccountId,
      }, { actorId, createId, now })
    }
  }
}

/**
 * Applies every scheduled change whose date has come. Each change is its own
 * transaction; one that can no longer be applied (its schedule ended, say) is
 * marked failed with the reason, so the coach sees it on the player's record
 * instead of the change silently waiting forever.
 */
export function applyDueTrainingChanges({
  createId = randomUUID,
  database = initializeDatabase(),
  now = new Date(),
}: { createId?: () => string; database?: SmbaDatabase; now?: Date } = {}) {
  const today = getAcademyDateKey(now)
  const due = database.select().from(trainingChanges).where(and(
    eq(trainingChanges.status, "scheduled"),
    lte(trainingChanges.effectiveOn, today),
  )).all()
  let applied = 0
  for (const change of due) {
    try {
      database.transaction((tx) => {
        const current = tx.select({ status: trainingChanges.status }).from(trainingChanges)
          .where(eq(trainingChanges.id, change.id)).get()
        if (current?.status !== "scheduled") return
        applyChange(tx, change, { createId, now })
        tx.update(trainingChanges).set({ resolvedAt: now, status: "applied", updatedAt: now })
          .where(eq(trainingChanges.id, change.id)).run()
      }, { behavior: "immediate" })
      applied += 1
    } catch (error) {
      const reason = error instanceof OperationalActionError || error instanceof FinanceServiceError
        ? error.message
        : "The change could not be applied."
      database.update(trainingChanges).set({
        failureReason: reason,
        resolvedAt: now,
        status: "failed",
        updatedAt: now,
      }).where(and(eq(trainingChanges.id, change.id), eq(trainingChanges.status, "scheduled"))).run()
    }
  }
  return { applied, due: due.length }
}

/*
 * Pages and actions call this on every request. A new change is always dated
 * the 1st of a later month, so once a server instance has looked on a given
 * day nothing else can fall due that day; the memo makes every later call that
 * day free, which matters because production reads are network round trips.
 */
let checkedOn: string | null = null

export function ensureDueTrainingChangesApplied(now = new Date()) {
  const today = getAcademyDateKey(now)
  if (checkedOn === today) return
  try {
    applyDueTrainingChanges({ now })
    checkedOn = today
  } catch (error) {
    // Never let this stop a page from loading; the next request tries again.
    console.error("Scheduled training changes could not be applied.", error)
  }
}

/* ------------------------------------------------------------------ */
/* Change schedule within this month                                   */
/* ------------------------------------------------------------------ */

/*
 * A change that starts on a day of the current month, up to today (head coach,
 * 5 Oct 2026). Changing only the session time is always allowed. Changing the
 * level, batch or plan is allowed only while this month's fee has not been
 * paid -- any payment against it counts as paid -- because the change also
 * corrects this month's fee, and a paid fee is left alone. Marks in the old
 * schedule from the start date on are cleared, not moved: the coach marks those
 * days again on the new schedule. Starting on the 1st is how a schedule that
 * was wrong all month is put right.
 */

export type ChangeThisMonthInput = TrainingSelection & {
  monthlyFeePaise: number | null
  startsOn: string
}

export type ChangeThisMonthResult = {
  adjustment: { amountPaise: number; kind: "manual_credit" | "manual_debit" } | null
  clearedMarks: Array<{ choice: string; occurrenceDate: string }>
  refundNeededPaise: number
  startsOn: string
}

function thisMonthCharge(database: Executor, playerId: string, monthStart: string, now: Date) {
  const charge = database.select().from(financialCharges).where(and(
    eq(financialCharges.playerAccountId, playerId),
    eq(financialCharges.type, "monthly_training"),
    eq(financialCharges.billingPeriod, monthStart.slice(0, 7)),
    eq(financialCharges.lifecycle, "issued"),
  )).get()
  if (!charge) return null
  const view = loadChargeView(database, charge.id, now)
  return { charge, outstandingPaise: view?.outstandingPaise ?? 0, receivedPaise: view?.receivedPaise ?? 0 }
}

/** What a change from `startsOn` would clear, for the confirm screen. */
export function previewScheduleChange(
  input: { playerId: string; startsOn: string },
  { coachId, database = initializeDatabase() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  const covering = database.select({ seriesId: sessionAssignments.seriesId }).from(sessionAssignments).where(and(
    eq(sessionAssignments.accountId, input.playerId),
    or(isNull(sessionAssignments.effectiveTo), gt(sessionAssignments.effectiveTo, input.startsOn)),
  )).all()
  const marks = marksFrom(database, input.playerId, [...new Set(covering.map((item) => item.seriesId))], input.startsOn)
  return { marks: marks.map((mark) => ({ choice: mark.choice, occurrenceDate: mark.occurrenceDate })) }
}

function marksFrom(database: Executor, playerId: string, seriesIds: string[], startsOn: string) {
  if (!seriesIds.length || !/^\d{4}-\d{2}-\d{2}$/u.test(startsOn)) return []
  return database.select({
    choice: sessionAttendanceRecords.choice,
    id: sessionAttendanceRecords.id,
    occurrenceDate: sessionOccurrences.occurrenceDate,
    occurrenceId: sessionOccurrences.id,
  }).from(sessionAttendanceRecords)
    .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId))
    .where(and(
      eq(sessionAttendanceRecords.accountId, playerId),
      inArray(sessionOccurrences.seriesId, seriesIds),
      gte(sessionOccurrences.occurrenceDate, startsOn),
      lte(sessionOccurrences.occurrenceDate, monthEndOf(startsOn)),
      ne(sessionAttendanceRecords.choice, "cleared"),
    ))
    .all()
    .sort((first, second) => first.occurrenceDate.localeCompare(second.occurrenceDate))
}

export function changeScheduleThisMonth(
  input: ChangeThisMonthInput,
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: TrainingContext,
): ChangeThisMonthResult {
  requireHeadAdminAccess(coachId, { database })
  try {
    return database.transaction((tx) => {
      const player = requirePlayer(tx, input.playerId)
      const today = getAcademyDateKey(now)
      const monthStart = monthStartOf(today)
      const startsOn = input.startsOn
      if (typeof startsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(startsOn)
        || startsOn < monthStart || startsOn > today) {
        operationalActionError(
          "INVALID_INPUT",
          "Choose a start date from the 1st of this month up to today, or start next month.",
          "startsOn",
        )
      }
      if (startsOn < player.trainingStartOn) {
        operationalActionError("INVALID_INPUT", "The new schedule cannot start before the player's training started.", "startsOn")
      }
      if (scheduledChange(tx, input.playerId)) {
        operationalActionError(
          "CONFLICT",
          "This player has a change waiting for next month. Cancel it before changing this month.",
        )
      }
      const current = openAssignments(tx, input.playerId)
      if (!current.length) {
        operationalActionError("BUSINESS_RULE", "This player is not on any schedule. Use Start training.")
      }
      const enrollment = tx.select().from(playerEnrollments)
        .where(eq(playerEnrollments.accountId, input.playerId)).get()
      const profileChanges = enrollment?.level !== input.level
        || enrollment?.batch !== input.batch
        || enrollment?.academyPlan !== input.academyPlan
      const financeActive = isFinanceActive(tx)
      const monthCharge = financeActive ? thisMonthCharge(tx, input.playerId, monthStart, now) : null
      if (profileChanges && monthCharge && monthCharge.receivedPaise > 0) {
        operationalActionError(
          "BUSINESS_RULE",
          "This month's fee has already been paid, so only the session time can change this month. To change the level, batch or plan, start the change next month.",
        )
      }
      const { weekdays } = validateSelection(tx, input, startsOn)

      // Every schedule that still covers a day from the start date is cut back,
      // not only the open one: a second change this month that starts earlier
      // than the first would otherwise leave the first one covering the days in
      // between, and the player would be on two registers again.
      const overlapping = tx.select().from(sessionAssignments).where(and(
        eq(sessionAssignments.accountId, input.playerId),
        or(isNull(sessionAssignments.effectiveTo), gt(sessionAssignments.effectiveTo, startsOn)),
      )).all()
      const oldSeries = [...new Set(overlapping.map((item) => item.seriesId))]
      const occurrenceIds = tx.select({ id: sessionOccurrences.id }).from(sessionOccurrences).where(and(
        inArray(sessionOccurrences.seriesId, oldSeries),
        gte(sessionOccurrences.occurrenceDate, startsOn),
        lte(sessionOccurrences.occurrenceDate, monthEndOf(startsOn)),
      )).all().map((row) => row.id)
      if (occurrenceIds.length) {
        const makeup = tx.select({ id: attendanceAdjustments.id }).from(attendanceAdjustments).where(and(
          eq(attendanceAdjustments.playerId, input.playerId),
          isNull(attendanceAdjustments.voidedAt),
          or(
            inArray(attendanceAdjustments.sourceOccurrenceId, occurrenceIds),
            inArray(attendanceAdjustments.completionOccurrenceId, occurrenceIds),
          ),
        )).get()
        if (makeup) {
          operationalActionError(
            "BUSINESS_RULE",
            "A rescheduled (make-up) session falls after this start date. Undo it in Reschedule attendance first, or start later.",
          )
        }
      }

      const marks = marksFrom(tx, input.playerId, oldSeries, startsOn)
      for (const mark of marks) {
        tx.update(sessionAttendanceRecords).set({
          choice: "cleared",
          markedByAccountId: coachId,
          updatedAt: now,
        }).where(eq(sessionAttendanceRecords.id, mark.id)).run()
      }
      for (const assignment of overlapping) {
        tx.update(sessionAssignments).set({
          effectiveTo: laterOf(assignment.effectiveFrom, startsOn),
        }).where(eq(sessionAssignments.id, assignment.id)).run()
      }
      tx.update(playerEnrollments).set({
        academyPlan: input.academyPlan,
        batch: input.batch,
        level: input.level,
        recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
        status: "active",
        updatedAt: now,
      }).where(eq(playerEnrollments.accountId, input.playerId)).run()
      insertAssignment(tx, {
        actorId: coachId,
        createId,
        effectiveFrom: startsOn,
        now,
        playerId: input.playerId,
        seriesId: input.seriesId,
        weekdays,
      })

      const result: ChangeThisMonthResult = {
        adjustment: null,
        clearedMarks: marks.map((mark) => ({ choice: mark.choice, occurrenceDate: mark.occurrenceDate })),
        refundNeededPaise: 0,
        startsOn,
      }
      // A change of session time alone leaves the fee exactly as it is.
      if (!financeActive || !profileChanges) return result

      const fee = validateFee(input.monthlyFeePaise, true) as number
      const { active, covering } = agreementsAround(tx, input.playerId, monthStart)
      if (active && active.effectiveFrom > monthStart) {
        operationalActionError(
          "CONFLICT",
          "A new fee already starts next month. Cancel that fee change before changing this month.",
        )
      }
      if (!covering) return result
      const monthLabel = new Intl.DateTimeFormat("en-IN", {
        month: "long", timeZone: "UTC", year: "numeric",
      }).format(new Date(`${monthStart}T00:00:00Z`))
      const reason = `Schedule changed in ${monthLabel}`
      if (covering.effectiveFrom >= monthStart) {
        correctFeeAgreementInTransaction(tx, {
          academyPlan: input.academyPlan,
          agreedMonthlyFeePaise: fee,
          agreementId: covering.id,
          batch: input.batch,
          level: input.level,
          reason,
        }, { actorId: coachId, createId, now })
      } else {
        createFeeAgreementInTransaction(tx, {
          academyPlan: input.academyPlan,
          agreedMonthlyFeePaise: fee,
          batch: input.batch,
          effectiveFrom: monthStart,
          expectedAgreementRevision: covering.recordRevision,
          idempotencyKey: `schedule-change:${createId()}`,
          level: input.level,
          playerId: input.playerId,
        }, { actorId: coachId, createId, now })
      }

      if (!monthCharge || covering.agreedMonthlyFeePaise === fee) return result
      // A first month may have been charged for part of the month, so the
      // corrected amount keeps that same share of the new fee.
      const corrected = Math.round(
        monthCharge.charge.originalAmountPaise * fee / covering.agreedMonthlyFeePaise,
      )
      const delta = corrected - monthCharge.charge.originalAmountPaise
      if (delta === 0) return result
      if (delta > 0) {
        applyChargeAdjustmentInTransaction(tx, {
          amountPaise: delta,
          chargeId: monthCharge.charge.id,
          idempotencyKey: `schedule-change-adj:${createId()}`,
          kind: "manual_debit",
          reason,
        }, { actorId: coachId, createId, now })
        result.adjustment = { amountPaise: delta, kind: "manual_debit" }
        return result
      }
      const credit = Math.min(-delta, monthCharge.outstandingPaise)
      if (credit > 0) {
        applyChargeAdjustmentInTransaction(tx, {
          amountPaise: credit,
          chargeId: monthCharge.charge.id,
          idempotencyKey: `schedule-change-adj:${createId()}`,
          kind: "manual_credit",
          reason,
        }, { actorId: coachId, createId, now })
        result.adjustment = { amountPaise: credit, kind: "manual_credit" }
      }
      result.refundNeededPaise = -delta - credit
      return result
    }, { behavior: "immediate" })
  } catch (error) {
    return asOperationalError(error)
  }
}

/* ------------------------------------------------------------------ */
/* End training now ("he has left already")                            */
/* ------------------------------------------------------------------ */

export function endTrainingNow(
  input: { playerId: string; stopFees: boolean },
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  try {
    return database.transaction((tx) => {
      requirePlayer(tx, input.playerId)
      const today = getAcademyDateKey(now)
      if (!openAssignments(tx, input.playerId).length) {
        operationalActionError("BUSINESS_RULE", "This player is not on any schedule.")
      }
      const waiting = scheduledChange(tx, input.playerId)
      if (waiting) {
        tx.update(trainingChanges).set({ resolvedAt: now, status: "cancelled", updatedAt: now })
          .where(eq(trainingChanges.id, waiting.id)).run()
      }
      endOpenAssignments(tx, input.playerId, today)
      tx.update(playerEnrollments).set({
        recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
        status: "paused",
        updatedAt: now,
      }).where(eq(playerEnrollments.accountId, input.playerId)).run()
      if (input.stopFees && isFinanceActive(tx)) {
        const { active } = agreementsAround(tx, input.playerId, today)
        const month = today.slice(0, 7)
        if (active && active.effectiveFrom.slice(0, 7) <= month) {
          endFeeAgreementInTransaction(tx, {
            agreementId: active.id,
            effectiveThroughPeriod: month,
            expectedRevision: active.recordRevision,
            idempotencyKey: `training-end-now:${createId()}`,
            reason: "Training ended from the player's record",
          }, { actorId: coachId, createId, now })
        }
      }
    }, { behavior: "immediate" })
  } catch (error) {
    return asOperationalError(error)
  }
}
