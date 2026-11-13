import "server-only"

import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or } from "drizzle-orm"

import type { PlayerTrainingProfile } from "@/lib/coach/types"
import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  concessions,
  feeAgreements,
  financialCharges,
  playerEnrollments,
  trainingChanges,
} from "@/lib/db/schema"
import { loadChargeViews } from "@/lib/finance/repository"
import { isFinanceActive } from "@/lib/finance/service"
import { getAcademyDateKey } from "@/lib/format"
import { loadOpenPlaces } from "@/lib/sessions/open-places"
import {
  placeReachesWindow,
  scheduleIsRunning,
  termFinishedOn,
  termFinishedToMove,
} from "@/lib/sessions/term"
import { nextMonthStartOf, waitingFeeChangeOf } from "@/lib/training/changes"
import { feeChangeStartsOn } from "@/lib/training/fees"
import { loadThisMonthFeeBases } from "@/lib/training/this-month-fee"
import type { ThisMonthFeeBasis } from "@/lib/training/this-month-fee-plan"

/*
 * What the Members directory shows on each player's record about their
 * training changes and fees, for every player in a fixed handful of queries
 * rather than the fee record page's per-player read: the directory lists dozens
 * of players and production reads are network round trips.
 */

export type MemberScheduledChange = {
  academyPlan: string | null
  batch: string | null
  effectiveOn: string
  id: string
  kind: "change" | "end"
  level: string | null
  monthlyFeePaise: number | null
  seriesId: string | null
  stopFees: boolean
  weekdays: number[]
}

export type MemberFeeSummary = {
  activeAgreementId: string | null
  activeAgreementRevision: number | null
  concession: {
    endsPeriod: string | null
    id: string
    revision: number
    startsPeriod: string | null
    value: number
    valueKind: "fixed" | "percentage"
  } | null
  /** The 1st of the month a fee change made today would start from. */
  feeChangeStartsOn: string
  monthlyFeePaise: number | null
  nextMonthFeePaise: number | null
  /**
   * A fee change made this month that starts next month, while no fee has
   * been issued on it and the plan it replaced can carry on: "Cancel this fee
   * change" (lib/training/fees.ts cancelFeeChange). Null otherwise.
   */
  waitingFeeChange: {
    agreementId: string
    feePaise: number
    previousFeePaise: number
    revision: number
    startsOn: string
  } | null
  /**
   * Why no fee will be issued next month although the plan has one: no
   * running place reaches into next month and no booked move gives them one.
   * "term-finished" when the player's term has finished
   * (lib/sessions/term.ts), "schedule-ends" when a running schedule ends this
   * month, "no-schedule" otherwise. Null when next month's fee is issued as
   * shown.
   */
  nextMonthNoFee: "no-schedule" | "schedule-ends" | "term-finished" | null
  thisMonth: {
    amountPaise: number
    /**
     * What a level, batch or plan change this month would do to this month's
     * fee, for lib/training/this-month-fee-plan.ts. Null when no plan covers
     * the month.
     */
    basis: ThisMonthFeeBasis | null
    dueDate: string
    receivedPaise: number
  } | null
}

export type MemberTrainingSummary = {
  /** A booked change that could not be applied on its day: shown in red. */
  failed: { effectiveOn: string; reason: string } | null
  fee: MemberFeeSummary | null
  /**
   * A booking that End schedule cancelled because it was onto the schedule
   * being ended, said plainly rather than as a failure.
   */
  note: string | null
  scheduled: MemberScheduledChange | null
}

export type MemberTrainingSummaries = {
  financeActive: boolean
  nextMonthStart: string
  summaries: Record<string, MemberTrainingSummary>
  today: string
}

/**
 * The term-finished players the head coach still has to move: those past
 * Player onboarding with no move or end of training booked for them in
 * Members yet (termFinishedToMove in lib/sessions/term.ts). The dashboard's
 * to-do counts them; Members'
 * "Term finished" filter lists the same players, reading the booked change
 * from listMemberTrainingSummaries below.
 */
export function listTermFinishedPlayersToMove(
  profiles: readonly Pick<PlayerTrainingProfile, "memberId" | "status">[],
  { database = initializeDatabase() }: { database?: SmbaDatabaseExecutor } = {},
) {
  const finished = profiles
    .filter((profile) => profile.status === "finished")
    .map((profile) => profile.memberId)
  if (!finished.length) return []
  const booked = new Set(database.select({ playerId: trainingChanges.playerAccountId })
    .from(trainingChanges)
    .where(and(
      inArray(trainingChanges.playerAccountId, finished),
      eq(trainingChanges.status, "scheduled"),
    ))
    .all()
    .map((row) => row.playerId))
  const inOnboarding = new Set(database.select({ playerId: playerEnrollments.accountId })
    .from(playerEnrollments)
    .where(and(
      inArray(playerEnrollments.accountId, finished),
      isNull(playerEnrollments.onboardingCompletedAt),
    ))
    .all()
    .map((row) => row.playerId))
  return finished.filter((playerId) => termFinishedToMove(
    "finished",
    booked.has(playerId),
    inOnboarding.has(playerId),
  ))
}

function covers(
  agreement: { effectiveFrom: string; effectiveTo: string | null },
  dateKey: string,
) {
  return agreement.effectiveFrom <= dateKey && (!agreement.effectiveTo || agreement.effectiveTo >= dateKey)
}

export function listMemberTrainingSummaries(
  playerIds: string[],
  { database = initializeDatabase(), now = new Date() }: { database?: SmbaDatabaseExecutor; now?: Date } = {},
): MemberTrainingSummaries {
  const today = getAcademyDateKey(now)
  const nextMonthStart = nextMonthStartOf(today)
  const thisPeriod = today.slice(0, 7)
  const nextPeriod = nextMonthStart.slice(0, 7)
  const summaries: Record<string, MemberTrainingSummary> = {}
  for (const id of playerIds) summaries[id] = { failed: null, fee: null, note: null, scheduled: null }
  const financeActive = isFinanceActive(database)
  if (!playerIds.length) return { financeActive, nextMonthStart, summaries, today }

  // A booking the coach cancelled leaves nothing; one End schedule cancelled
  // carries its reason (lib/sessions/service.ts) and leaves a note.
  const changes = database.select().from(trainingChanges).where(and(
    inArray(trainingChanges.playerAccountId, playerIds),
    or(
      inArray(trainingChanges.status, ["scheduled", "failed", "applied"]),
      and(eq(trainingChanges.status, "cancelled"), isNotNull(trainingChanges.failureReason)),
    ),
  )).orderBy(desc(trainingChanges.updatedAt)).all()
  const seen = new Set<string>()
  for (const change of changes) {
    const summary = summaries[change.playerAccountId]
    if (change.status === "scheduled") {
      summary.scheduled = {
        academyPlan: change.academyPlan,
        batch: change.batch,
        effectiveOn: change.effectiveOn,
        id: change.id,
        kind: change.kind,
        level: change.level,
        monthlyFeePaise: change.monthlyFeePaise,
        seriesId: change.seriesId,
        stopFees: change.stopFees,
        weekdays: JSON.parse(change.weekdays) as number[],
      }
      continue
    }
    // Only the most recent outcome matters: a failure that was followed by a
    // successful change is history, not something to show. A notice goes
    // once it is dismissed, or once a later change to the player's schedule
    // dealt with it (lib/training/changes.ts clearTrainingNotices).
    if (seen.has(change.playerAccountId)) continue
    seen.add(change.playerAccountId)
    if (change.dismissedAt) continue
    if (change.status === "failed") {
      summary.failed = {
        effectiveOn: change.effectiveOn,
        reason: change.failureReason ?? "The change could not be applied.",
      }
    }
    if (change.status === "cancelled" && change.failureReason) summary.note = change.failureReason
  }

  if (!financeActive) return { financeActive, nextMonthStart, summaries, today }

  const agreements = database.select().from(feeAgreements).where(and(
    inArray(feeAgreements.playerAccountId, playerIds),
    ne(feeAgreements.status, "paused"),
    or(isNull(feeAgreements.effectiveTo), gte(feeAgreements.effectiveTo, today)),
  )).all()
  const charges = database.select({
    amountPaise: financialCharges.originalAmountPaise,
    dueDate: financialCharges.dueDate,
    id: financialCharges.id,
    playerId: financialCharges.playerAccountId,
  }).from(financialCharges).where(and(
    inArray(financialCharges.playerAccountId, playerIds),
    eq(financialCharges.type, "monthly_training"),
    eq(financialCharges.billingPeriod, thisPeriod),
    eq(financialCharges.lifecycle, "issued"),
  )).all()
  // Whether this month's fee has any payment decides what a schedule change
  // this month may alter (lib/training/changes.ts), so the form needs it.
  const chargeViews = loadChargeViews(database, charges.map((charge) => charge.id), now)
  const activeConcessions = database.select().from(concessions).where(and(
    inArray(concessions.playerAccountId, playerIds),
    eq(concessions.lifecycle, "active"),
    eq(concessions.mode, "recurring"),
    or(isNull(concessions.endsPeriod), gte(concessions.endsPeriod, nextPeriod)),
  )).all()

  const monthStart = `${thisPeriod}-01`
  const monthAgreements = !charges.length ? [] : database.select({
    agreedMonthlyFeePaise: feeAgreements.agreedMonthlyFeePaise,
    effectiveFrom: feeAgreements.effectiveFrom,
    effectiveTo: feeAgreements.effectiveTo,
    playerAccountId: feeAgreements.playerAccountId,
  }).from(feeAgreements).where(and(
    inArray(feeAgreements.playerAccountId, charges.map((charge) => charge.playerId)),
    ne(feeAgreements.status, "paused"),
  )).all()
  // The plan covering the 1st is the one a change this month corrects
  // (agreementsAround in lib/training/changes.ts).
  const feeBases = loadThisMonthFeeBases(database, charges.flatMap((charge) => {
    const covering = monthAgreements.find((agreement) => (
      agreement.playerAccountId === charge.playerId && covers(agreement, monthStart)
    ))
    return covering
      ? [{ feePaise: covering.agreedMonthlyFeePaise, id: charge.id, originalAmountPaise: charge.amountPaise }]
      : []
  }))

  // Fee issuing bills a month only for a place whose dates reach into it
  // (lib/finance/repository.ts hasAssignmentInPeriod), so a plan's next fee is
  // only real while a running place, or a booked move, carries into next month.
  const openPlaces = loadOpenPlaces(database, playerIds)
  const monthAfterNextStart = nextMonthStartOf(nextMonthStart)

  for (const playerId of playerIds) {
    const own = agreements.filter((agreement) => agreement.playerAccountId === playerId)
    const current = own.find((agreement) => covers(agreement, today)) ?? null
    const next = own.find((agreement) => covers(agreement, nextMonthStart)) ?? null
    const active = own.find((agreement) => agreement.status === "active") ?? null
    const charge = charges.find((item) => item.playerId === playerId)
    const concession = activeConcessions.find((item) => item.playerAccountId === playerId)
    if (!current && !next && !active && !charge) continue
    const waiting = summaries[playerId].scheduled
    const scheduledFee = waiting?.kind === "change" ? waiting.monthlyFeePaise : null
    // Training that ends this month with its fees stopped has no fee next month.
    const feesStop = waiting?.kind === "end" && waiting.stopFees
    const places = openPlaces.get(playerId) ?? []
    // A booked move starts a place on the 1st; a booked end closes them all.
    const placeNextMonth = waiting?.kind === "change" || (waiting?.kind !== "end" && places.some((place) => (
      scheduleIsRunning(place, today)
      && placeReachesWindow(place, place, nextMonthStart, monthAfterNextStart)
    )))
    const waitingFee = waitingFeeChangeOf(own, today)
    summaries[playerId].fee = {
      activeAgreementId: active?.id ?? null,
      activeAgreementRevision: active?.recordRevision ?? null,
      concession: concession
        ? {
          endsPeriod: concession.endsPeriod,
          id: concession.id,
          revision: concession.recordRevision,
          startsPeriod: concession.startsPeriod,
          value: concession.value,
          valueKind: concession.valueKind,
        }
        : null,
      feeChangeStartsOn: active
        ? feeChangeStartsOn({ activePlanFrom: active.effectiveFrom, thisMonthIssued: Boolean(charge), today })
        : nextMonthStart,
      monthlyFeePaise: current?.agreedMonthlyFeePaise ?? null,
      nextMonthFeePaise: feesStop ? null : scheduledFee ?? next?.agreedMonthlyFeePaise ?? null,
      nextMonthNoFee: placeNextMonth || feesStop
        ? null
        : termFinishedOn(places, today)
          ? "term-finished"
          : places.some((place) => scheduleIsRunning(place, today) && place.endsOn && place.endsOn < nextMonthStart)
            ? "schedule-ends"
            : "no-schedule",
      waitingFeeChange: waitingFee
        ? {
          agreementId: waitingFee.change.id,
          feePaise: waitingFee.change.agreedMonthlyFeePaise,
          previousFeePaise: waitingFee.replaced.agreedMonthlyFeePaise,
          revision: waitingFee.change.recordRevision,
          startsOn: waitingFee.change.effectiveFrom,
        }
        : null,
      thisMonth: charge
        ? {
          amountPaise: chargeViews.get(charge.id)?.effectiveAmountPaise ?? charge.amountPaise,
          basis: feeBases.get(charge.id) ?? null,
          dueDate: charge.dueDate,
          receivedPaise: chargeViews.get(charge.id)?.receivedPaise ?? 0,
        }
        : null,
    }
  }
  return { financeActive, nextMonthStart, summaries, today }
}
