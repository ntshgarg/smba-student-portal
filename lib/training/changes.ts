import "server-only"

import { randomUUID } from "node:crypto"

import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"

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
  pauseUnstartedFeeAgreementInTransaction,
} from "@/lib/finance/service"
import { loadChargeView } from "@/lib/finance/repository"
import { loadThisMonthFeeBases } from "@/lib/training/this-month-fee"
import {
  SCHEDULE_CHANGE_CONCESSION_KEY,
  SCHEDULE_CHANGE_FEE_KEY,
  planThisMonthFeeCorrection,
} from "@/lib/training/this-month-fee-plan"
import { formatSessionLabel, getAcademyDateKey } from "@/lib/format"
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
    onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
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

/*
 * Starting or changing training from Members waits for Player onboarding to
 * finish. Onboarding sets the first schedule, confirms the training start and
 * creates the fee plan with the registration fee, in that order. A Members
 * change made part-way through used to add a schedule and a fee plan behind
 * onboarding's back: the case then sat at the Session step for good (reset
 * and completion both refuse once a fee plan exists), so the player could never
 * sign in and the registration fee was never charged. A level change at the
 * Fee Plan step also left the weeks before it unbilled.
 *
 * Ending training stays open: for a player who leaves part-way through, it is
 * sometimes the only way to take them off a schedule.
 */
function requireOnboarded(player: { onboardingCompletedAt: Date | null }) {
  if (!player.onboardingCompletedAt) {
    operationalActionError(
      "BUSINESS_RULE",
      "Finish Player onboarding first. It sets this player's first schedule and fee plan.",
    )
  }
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

/*
 * "Stop fees after <month>": the one way End training (booked or "has left
 * already"), End schedule and Stop fees end a player's fees, so the four
 * cannot drift apart. The plan in force ends with that month, so that month's
 * fee is the last. A plan due to start after it -- a fee change made this
 * month, or a new player whose first fee month is next month -- is paused, so
 * it never bills (lib/finance/service.ts pauseUnstartedFeeAgreementInTransaction
 * says why that state). It used to be skipped quietly, and the family was
 * billed the new fee anyway. Fees already issued never change. Returns whether
 * a plan was stopped.
 */
export function stopFeesAfterMonth(
  tx: Executor,
  input: { finalMonth: string; idempotencyKey: string; playerId: string; reason: string },
  context: { actorId: string; createId: () => string; now: Date },
) {
  const active = tx.select().from(feeAgreements).where(and(
    eq(feeAgreements.playerAccountId, input.playerId),
    eq(feeAgreements.status, "active"),
  )).get()
  if (!active) return false
  if (active.effectiveFrom.slice(0, 7) <= input.finalMonth) {
    endFeeAgreementInTransaction(tx, {
      agreementId: active.id,
      effectiveThroughPeriod: input.finalMonth,
      expectedRevision: active.recordRevision,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    }, context)
  } else {
    pauseUnstartedFeeAgreementInTransaction(tx, {
      agreementId: active.id,
      expectedRevision: active.recordRevision,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      startsAfter: monthEndOf(`${input.finalMonth}-01`),
    }, context)
  }
  return true
}

/*
 * The notice a change that did not happen leaves on the player's record (see
 * `trainingChanges` in lib/db/schema.ts): the red "could not be applied" for a
 * failed change, and the plain note for a booking End schedule cancelled. Both
 * go once the player's schedule is changed or ended afterwards; the note also
 * goes once the coach books something new. Either can be dismissed.
 */
export function clearTrainingNotices(
  tx: Executor,
  playerId: string,
  now: Date,
  {
    failuresOnly = false,
    notesOnly = false,
  }: {
    /**
     * Clear only the red "could not be applied" notices, and leave the blue
     * notes on cancelled bookings until a new booking or Dismiss (End
     * schedule: ending a player's schedule deals with an older failure, but
     * not with a note that another schedule's ending wrote).
     */
    failuresOnly?: boolean
    notesOnly?: boolean
  } = {},
) {
  const failed = eq(trainingChanges.status, "failed")
  const notes = and(eq(trainingChanges.status, "cancelled"), isNotNull(trainingChanges.failureReason))
  tx.update(trainingChanges).set({ dismissedAt: now }).where(and(
    eq(trainingChanges.playerAccountId, playerId),
    isNull(trainingChanges.dismissedAt),
    notesOnly ? notes : failuresOnly ? failed : or(failed, notes),
  )).run()
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dayAfter(dateKey: string) {
  return addDays(dateKey, 1)
}

function dayBefore(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/**
 * The plan a waiting fee change replaced, when the change can still be
 * cancelled: the plan in force starts after today and nothing has been issued
 * on it, and the plan before it was closed on the day before it, which is
 * what a fee change does (createAgreement in lib/finance/service.ts). Shared
 * with the Members summary, so the button is offered exactly when this allows
 * it.
 */
export function waitingFeeChangeOf<Plan extends {
  effectiveFrom: string
  effectiveTo: string | null
  id: string
  status: string
}>(plans: readonly Plan[], today: string, issuedPlanIds: ReadonlySet<string>) {
  const change = plans.find((plan) => plan.status === "active")
  if (!change || change.effectiveFrom <= today || issuedPlanIds.has(change.id)) return null
  const replaced = plans.find((plan) => (
    plan.status === "ended" && plan.effectiveTo === dayBefore(change.effectiveFrom)
  ))
  return replaced ? { change, replaced } : null
}

/**
 * The refusal when a fee plan already starts next month. It names "Cancel
 * this fee change" only when Members offers that button (a fee change made
 * this month, nothing issued on it yet); a new player whose first fee plan
 * starts next month has no such button, so they are told to wait instead.
 */
function nextMonthFeeRefusal(tx: Executor, playerId: string, today: string, then: string): never {
  const plans = tx.select().from(feeAgreements).where(and(
    eq(feeAgreements.playerAccountId, playerId),
    ne(feeAgreements.status, "paused"),
  )).all()
  const issued = new Set(tx.select({ planId: financialCharges.feeAgreementId }).from(financialCharges).where(and(
    eq(financialCharges.playerAccountId, playerId),
    eq(financialCharges.lifecycle, "issued"),
  )).all().flatMap((row) => (row.planId ? [row.planId] : [])))
  if (waitingFeeChangeOf(plans, today, issued)) {
    operationalActionError(
      "CONFLICT",
      `A new fee already starts next month. Use Cancel this fee change under Monthly fee first, then ${then}.`,
    )
  }
  operationalActionError(
    "CONFLICT",
    "This player's fee plan only starts next month, so their training cannot be changed yet. Change it once next month has started.",
  )
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
    requireOnboarded(requirePlayer(tx, input.playerId))
    const today = getAcademyDateKey(now)
    const effectiveOn = nextMonthStartOf(today)
    const { weekdays } = validateSelection(tx, input, effectiveOn)
    const financeActive = isFinanceActive(tx)
    const fee = validateFee(input.monthlyFeePaise, financeActive)
    if (financeActive) {
      const { active } = agreementsAround(tx, input.playerId, today)
      if (active && active.effectiveFrom >= effectiveOn) {
        nextMonthFeeRefusal(tx, input.playerId, today, "change training")
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
    clearTrainingNotices(tx, input.playerId, now, { notesOnly: true })
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
    const player = requirePlayer(tx, input.playerId)
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
      // A player still in onboarding has no fee plan yet, and the form offers
      // no fees choice; the plan made when onboarding finishes stops with this
      // end (lib/finance/service.ts buildOnboardingFinancePreview), so the
      // booking says so rather than "fee plan kept".
      stopFees: Boolean(input.stopFees) || !player.onboardingCompletedAt,
      updatedAt: now,
      weekdays: "[]",
    }
    clearTrainingNotices(tx, input.playerId, now, { notesOnly: true })
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
  const player = requirePlayer(tx, change.playerAccountId)
  // A change scheduled before this rule existed fails visibly instead.
  if (change.kind === "change") requireOnboarded(player)

  if (change.kind === "end") {
    endOpenAssignments(tx, change.playerAccountId, effectiveOn)
    clearTrainingNotices(tx, change.playerAccountId, now)
    tx.update(playerEnrollments).set({
      recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
      status: "paused",
      updatedAt: now,
    }).where(eq(playerEnrollments.accountId, change.playerAccountId)).run()
    if (change.stopFees && isFinanceActive(tx)) {
      stopFeesAfterMonth(tx, {
        finalMonth: previousMonthKey(effectiveOn),
        idempotencyKey: `training-end:${change.id}`,
        playerId: change.playerAccountId,
        reason: "Training ended from the player's record",
      }, { actorId, createId, now })
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
  clearTrainingNotices(tx, change.playerAccountId, now)
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

/** How a schedule is named in notes on a player's record, e.g. "Beginner Weekday 6:00 PM". */
export function scheduleLabel(
  database: Executor,
  series: typeof sessionSeries.$inferSelect,
) {
  const slot = database.select().from(sessionRecurrenceRules)
    .where(eq(sessionRecurrenceRules.seriesId, series.id))
    .orderBy(asc(sessionRecurrenceRules.weekday))
    .get()
  return formatSessionLabel({
    batch: series.batch,
    durationMinutes: slot?.durationMinutes ?? 0,
    programme: series.programme,
    startTime: slot?.startTime ?? "",
  })
}

/*
 * How many days after its own date a booked change that hit an unexpected
 * fault (not a rule refusing it) is still tried again. A passing fault -- a
 * dropped connection, a busy database -- clears itself within that; one that
 * never goes away (a bad stored row, a bug) would otherwise leave the change
 * silently waiting for ever while the player trains and is billed on the old
 * terms. After this it fails visibly, as a refused change does.
 */
export const TRAINING_CHANGE_RETRY_DAYS = 2

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
  let retry = 0
  for (const change of due) {
    let cancelled = false
    try {
      database.transaction((tx) => {
        const current = tx.select({ status: trainingChanges.status }).from(trainingChanges)
          .where(eq(trainingChanges.id, change.id)).get()
        if (current?.status !== "scheduled") return
        // A booking onto a schedule that has since ended (one booked before
        // End schedule cancelled such bookings, or a race with it) is
        // cancelled with a plain note, not marked as a red failure.
        const target = change.kind === "change" && change.seriesId
          ? tx.select().from(sessionSeries).where(eq(sessionSeries.id, change.seriesId)).get()
          : undefined
        if (target?.status === "ended") {
          tx.update(trainingChanges).set({
            failureReason: `Booked move to ${scheduleLabel(tx, target)} cancelled: that schedule was ended.`,
            resolvedAt: now,
            status: "cancelled",
            updatedAt: now,
          }).where(eq(trainingChanges.id, change.id)).run()
          cancelled = true
          return
        }
        applyChange(tx, change, { createId, now })
        tx.update(trainingChanges).set({ resolvedAt: now, status: "applied", updatedAt: now })
          .where(eq(trainingChanges.id, change.id)).run()
      }, { behavior: "immediate" })
      if (!cancelled) applied += 1
    } catch (error) {
      /*
       * A change its rule refused is final at once. A passing fault -- a
       * dropped connection, a busy database -- used to be final too, so a
       * player meant to stop on the 1st kept training and stayed billable
       * until the coach noticed and redid it a month late. Such a change now
       * stays booked and is tried again (nothing was written: the transaction
       * rolled back), but only for TRAINING_CHANGE_RETRY_DAYS after its date.
       * A fault still there after that is not passing, and the change fails
       * visibly so the coach can make it another way.
       */
      const refused = error instanceof OperationalActionError || error instanceof FinanceServiceError
      if (!refused && today <= addDays(change.effectiveOn, TRAINING_CHANGE_RETRY_DAYS)) {
        console.error("A scheduled training change could not be applied; it will be tried again.", error)
        retry += 1
        continue
      }
      if (!refused) console.error("A scheduled training change could not be applied.", error)
      const reason = refused
        ? error.message
        : "Something went wrong each time it was tried. Make the change again from this record."
      database.update(trainingChanges).set({
        failureReason: reason,
        resolvedAt: now,
        status: "failed",
        updatedAt: now,
      }).where(and(eq(trainingChanges.id, change.id), eq(trainingChanges.status, "scheduled"))).run()
    }
  }
  return { applied, due: due.length, retry }
}

/*
 * Pages and actions call this on every request. A new change is always dated
 * the 1st of a later month, so once a server instance has looked on a given
 * day nothing else can fall due that day; the memo makes every later call that
 * day free, which matters because production reads are network round trips.
 *
 * A change that hit a passing fault is tried again, but not by every request:
 * at most once every few minutes, so a fault that lasts does not put a
 * write-locked transaction in front of every page.
 */
const RETRY_AFTER_MS = 5 * 60 * 1000
let checkedOn: string | null = null
let retryAfter = 0

export function ensureDueTrainingChangesApplied(now = new Date()) {
  const today = getAcademyDateKey(now)
  if (checkedOn === today) return
  if (now.getTime() < retryAfter) return
  try {
    const { retry } = applyDueTrainingChanges({ now })
    if (retry) {
      retryAfter = now.getTime() + RETRY_AFTER_MS
    } else {
      checkedOn = today
      retryAfter = 0
    }
  } catch (error) {
    // Never let this stop a page from loading; a later request tries again.
    console.error("Scheduled training changes could not be applied.", error)
    retryAfter = now.getTime() + RETRY_AFTER_MS
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
  /** What is due for this month after the change, when its fee was corrected. */
  newAmountPaise: number | null
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
      requireOnboarded(player)
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
      // A waiting move would be undone by this change; a waiting end of
      // training is not -- it still ends their training after this month, so
      // the coach can adjust the rest of the month without cancelling it.
      if (scheduledChange(tx, input.playerId)?.kind === "change") {
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
      clearTrainingNotices(tx, input.playerId, now)
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
        newAmountPaise: null,
        startsOn,
      }
      // A change of session time alone leaves the fee exactly as it is.
      if (!financeActive || !profileChanges) return result

      const fee = validateFee(input.monthlyFeePaise, true) as number
      const { active, covering } = agreementsAround(tx, input.playerId, monthStart)
      if (active && active.effectiveFrom > monthStart) {
        nextMonthFeeRefusal(tx, input.playerId, getAcademyDateKey(now), "change this month")
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
      // Nothing has been paid on this month's fee (a payment locks the level,
      // batch and plan above), so the whole correction lands on what is due.
      const basis = loadThisMonthFeeBases(tx, [{
        feePaise: covering.agreedMonthlyFeePaise,
        id: monthCharge.charge.id,
        originalAmountPaise: monthCharge.charge.originalAmountPaise,
      }]).get(monthCharge.charge.id)
      if (!basis) return result
      const plan = planThisMonthFeeCorrection(basis, fee)
      const posts = [
        {
          amountPaise: plan.grossDeltaPaise,
          key: SCHEDULE_CHANGE_FEE_KEY,
          reason,
        },
        {
          // More concession is a credit, less is a debit.
          amountPaise: -plan.concessionDeltaPaise,
          key: SCHEDULE_CHANGE_CONCESSION_KEY,
          reason: `Concession recalculated for the new fee in ${monthLabel}`,
        },
      ].filter((post) => post.amountPaise !== 0)
        // Debits first, so a credit never runs ahead of what is due.
        .sort((first, second) => second.amountPaise - first.amountPaise)
      for (const post of posts) {
        const due = thisMonthCharge(tx, input.playerId, monthStart, now)?.outstandingPaise ?? 0
        const amountPaise = post.amountPaise > 0 ? post.amountPaise : Math.min(-post.amountPaise, due)
        if (amountPaise <= 0) continue
        const kind = post.amountPaise > 0 ? "manual_debit" as const : "manual_credit" as const
        applyChargeAdjustmentInTransaction(tx, {
          amountPaise,
          chargeId: monthCharge.charge.id,
          idempotencyKey: `${post.key}${createId()}`,
          kind,
          reason: post.reason,
        }, { actorId: coachId, createId, now })
        if (post.key === SCHEDULE_CHANGE_FEE_KEY) result.adjustment = { amountPaise, kind }
      }
      result.newAmountPaise = thisMonthCharge(tx, input.playerId, monthStart, now)?.outstandingPaise ?? null
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
      const open = openAssignments(tx, input.playerId)
      if (!open.length) {
        operationalActionError("BUSINESS_RULE", "This player is not on any schedule.")
      }
      const waiting = scheduledChange(tx, input.playerId)
      if (waiting) {
        tx.update(trainingChanges).set({ resolvedAt: now, status: "cancelled", updatedAt: now })
          .where(eq(trainingChanges.id, waiting.id)).run()
      }
      /*
       * "They have left already" takes them off today. A place's end date is
       * the first day it no longer covers, so ending it today also took today
       * off their record -- and a session this morning they were marked at
       * silently vanished from their attendance. When today is already marked
       * for them, the place ends after today instead: the mark stays, and
       * nothing later is covered.
       */
      const markedToday = tx.select({ id: sessionAttendanceRecords.id }).from(sessionAttendanceRecords)
        .innerJoin(sessionOccurrences, eq(sessionOccurrences.id, sessionAttendanceRecords.occurrenceId))
        .where(and(
          eq(sessionAttendanceRecords.accountId, input.playerId),
          ne(sessionAttendanceRecords.choice, "cleared"),
          eq(sessionOccurrences.occurrenceDate, today),
          inArray(sessionOccurrences.seriesId, open.map((assignment) => assignment.seriesId)),
        ))
        .get()
      endOpenAssignments(tx, input.playerId, markedToday ? dayAfter(today) : today)
      clearTrainingNotices(tx, input.playerId, now)
      tx.update(playerEnrollments).set({
        recordRevision: sql`${playerEnrollments.recordRevision} + 1`,
        status: "paused",
        updatedAt: now,
      }).where(eq(playerEnrollments.accountId, input.playerId)).run()
      if (input.stopFees && isFinanceActive(tx)) {
        stopFeesAfterMonth(tx, {
          finalMonth: today.slice(0, 7),
          idempotencyKey: `training-end-now:${createId()}`,
          playerId: input.playerId,
          reason: "Training ended from the player's record",
        }, { actorId: coachId, createId, now })
      }
    }, { behavior: "immediate" })
  } catch (error) {
    return asOperationalError(error)
  }
}

/* ------------------------------------------------------------------ */
/* Stop fees for a player on no schedule                               */
/* ------------------------------------------------------------------ */

/*
 * A fee plan kept for a break ("Keep the fee plan" on End training or End
 * schedule) has to be ended some day, or the player can never be archived
 * (head coach, 12 Nov 2026). Stop fees is that way: for a player on no
 * schedule with nothing booked, it ends the plan after this month exactly as
 * End training's "Stop fees" does. A player still holding a place, even on a
 * schedule whose term has finished, uses End training instead; a player with
 * a booking keeps what was arranged.
 */
export function stopFeePlan(
  input: { playerId: string },
  { coachId, createId = randomUUID, database = initializeDatabase(), now = new Date() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  try {
    return database.transaction((tx) => {
      requirePlayer(tx, input.playerId)
      if (!isFinanceActive(tx)) {
        operationalActionError("BUSINESS_RULE", "Financial tracking is not switched on.")
      }
      if (openAssignments(tx, input.playerId).length) {
        operationalActionError(
          "BUSINESS_RULE",
          "This player is still on a schedule. Use End training, which stops fees too.",
        )
      }
      const waiting = scheduledChange(tx, input.playerId)
      if (waiting) {
        operationalActionError(
          "CONFLICT",
          `This player has a change booked for ${waiting.effectiveOn}. Cancel it first to stop fees instead.`,
        )
      }
      const finalMonth = getAcademyDateKey(now).slice(0, 7)
      const stopped = stopFeesAfterMonth(tx, {
        finalMonth,
        idempotencyKey: `stop-fees:${createId()}`,
        playerId: input.playerId,
        reason: "Fees stopped from the player's record",
      }, { actorId: coachId, createId, now })
      if (!stopped) operationalActionError("NOT_FOUND", "This player has no fee plan to stop.")
      return { finalMonth }
    }, { behavior: "immediate" })
  } catch (error) {
    return asOperationalError(error)
  }
}

/** Dismisses the notice a change that did not happen left on the player's record. */
export function dismissTrainingNotice(
  input: { playerId: string },
  { coachId, database = initializeDatabase(), now = new Date() }: TrainingContext,
) {
  requireHeadAdminAccess(coachId, { database })
  database.transaction((tx) => {
    requirePlayer(tx, input.playerId)
    clearTrainingNotices(tx, input.playerId, now)
  }, { behavior: "immediate" })
}
