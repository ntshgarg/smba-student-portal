"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  cancelFeeChangeAction,
  cancelTrainingChangeAction,
  changeMonthlyFeeAction,
  changeScheduleAction,
  dismissTrainingNoticeAction,
  endTrainingNowAction,
  giveConcessionAction,
  previewScheduleChangeAction,
  scheduleEndOfTrainingAction,
  stopConcessionAction,
  stopFeePlanAction,
} from "@/app/coach/members/training-actions"
import { useMemberDirectoryPortal } from "@/components/coach/coach-portal-provider"
import { FormShell } from "@/components/coach/members/directory/form-shell"
import styles from "@/components/coach/members/directory/member-training-actions.module.css"
import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import type { OperationalActionResult } from "@/lib/actions/operational-result"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import type { MemberFeeSummary, MemberScheduledChange } from "@/lib/training/member-summaries"
import { defaultMonthlyFeePaise } from "@/lib/finance/config"
import { formatDateKey, formatInr, formatSessionLabel, parseRupeesToPaise } from "@/lib/format"
import { formatTermDate } from "@/lib/sessions/term"
import type { TrainingBatch, TrainingProgramme, TrainingSessionSeries } from "@/lib/sessions/types"
import {
  academyBatchesFor,
  academyPlanAssignmentLimit,
  academyPlanLabel,
  academyPlanRequiredWeekdayCount,
  academyPlansFor,
  type AcademyPlan,
} from "@/lib/training/academy-plans"
import { planThisMonthFeeCorrection } from "@/lib/training/this-month-fee-plan"

const LEVELS: TrainingProgramme[] = ["Beginner", "Intermediate", "Advanced", "Adult", "Elite"]
const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
]

type OpenForm = "change" | "concession" | "end" | "fee" | "start" | "stop-fees" | null

function monthName(dateKey: string) {
  return formatDateKey(`${dateKey.slice(0, 7)}-01`, {
    day: undefined, month: "long", weekday: undefined, year: "numeric",
  })
}

/** The month a change dated the 1st follows: training ends after this one. */
function monthBefore(firstOfMonth: string) {
  const [year, month] = firstOfMonth.split("-").map(Number)
  return monthName(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10))
}

function dayName(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "short", weekday: "short", year: undefined })
}

function dayList(weekdays: number[]) {
  return DAYS.filter((day) => weekdays.includes(day.value)).map((day) => day.label).join(", ")
}

function seriesLabel(series: TrainingSessionSeries) {
  const slot = series.slots[0]
  return formatSessionLabel({
    batch: series.batch,
    durationMinutes: slot?.durationMinutes ?? 0,
    programme: series.programme,
    startTime: slot?.startTime ?? "",
  })
}

function newKey() {
  return crypto.randomUUID()
}

/**
 * The training and fee actions on a player's record. Each opens one form in
 * place, asks once, and refreshes the directory when it is done.
 */
export function MemberTrainingActions({ player }: { player: PlayerMemberRecord }) {
  const data = useMemberTraining()
  const { sessionAssignments, sessionSeries } = useMemberDirectoryPortal()
  const router = useRouter()
  const [open, setOpen] = useState<OpenForm>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ActionFeedback | null>(null)

  const memberId = player.member.id
  const summary = data?.summaries[memberId] ?? null
  const current = useMemo(() => sessionAssignments.filter((assignment) => (
    assignment.playerId === memberId && assignment.effectiveTo === null
  )), [memberId, sessionAssignments])
  const seriesById = useMemo(
    () => new Map(sessionSeries.map((series) => [series.id, series])),
    [sessionSeries],
  )
  if (!data || !summary) return null

  // Starting or changing training waits for Player onboarding to finish (the
  // server refuses it too, lib/training/changes.ts). A level, batch and plan
  // are set part-way through onboarding, so they are not the signal.
  const onboarded = player.member.onboardingCompletedAt !== undefined
    ? Boolean(player.member.onboardingCompletedAt)
    : player.training.level !== "Assessment pending"
      && player.training.batch !== "Assessment pending"
      && Boolean(player.training.academyPlan)
  const scheduled = summary.scheduled
  const fee = summary.fee
  // "active" means at least one running place (lib/sessions/term.ts). A
  // player on no schedule, or whose term has finished, has no fee to change:
  // the server refuses it, so the button is not offered.
  const hasRunningPlace = player.training.status === "active"
  // Stop fees is for a kept fee plan with nothing else to end it: no place at
  // all (End training is offered while there is one, and stops fees too) and
  // nothing booked (a booking keeps what was arranged).
  const canStopFees = data.financeActive
    && Boolean(summary.fee?.activeAgreementId)
    && !current.length
    && !summary.scheduled
  const nextMonth = monthName(data.nextMonthStart)
  const thisMonth = monthName(data.today)

  async function submit<T>(
    action: () => Promise<OperationalActionResult<T>>,
    success: (data: T) => string,
  ) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await action()
      if (!result.ok) {
        setNotice({ message: result.message, tone: "error" })
        return
      }
      setNotice({ message: success(result.data), tone: "success" })
      setOpen(null)
      router.refresh()
    } catch {
      setNotice({ message: "This could not be saved. Check your connection and try again.", tone: "error" })
    } finally {
      setBusy(false)
    }
  }

  function toggle(form: OpenForm) {
    setNotice(null)
    setOpen((value) => (value === form ? null : form))
  }

  const scheduledSeries = scheduled?.seriesId ? seriesById.get(scheduled.seriesId) : null

  return (
    <section className={styles.section} aria-labelledby={`training-actions-${memberId}`}>
      <div className={styles.columns}>
        <div className={styles.column}>
          <span className={styles.eyebrow}>Training</span>
          <h4 id={`training-actions-${memberId}`}>Change or end</h4>

          {scheduled ? (
            <div className={styles.scheduled}>
              <strong>
                {scheduled.kind === "end"
                  ? `Training ends after ${monthBefore(scheduled.effectiveOn)}`
                  : `Scheduled for 1 ${nextMonth}`}
              </strong>
              <span>
                {scheduled.kind === "end"
                  ? `Paused from ${dayName(scheduled.effectiveOn)}${scheduled.stopFees ? " · fees stop" : " · fee plan kept"}`
                  : [
                    scheduledSeries ? seriesLabel(scheduledSeries) : "New schedule",
                    dayList(scheduled.weekdays),
                    academyPlanLabel(scheduled.academyPlan as AcademyPlan | null),
                    scheduled.monthlyFeePaise !== null ? `${formatInr(scheduled.monthlyFeePaise)} a month` : null,
                  ].filter(Boolean).join(" · ")}
              </span>
            </div>
          ) : null}

          {/* A change that did not happen. The red notice and the plain note
              go once the schedule is changed or ended afterwards (the note
              also once something new is booked), or when dismissed. */}
          {summary.failed || summary.note ? (
            <div className={styles.trainingNotice}>
              <InlineNotice
                message={summary.failed
                  ? `The change for ${dayName(summary.failed.effectiveOn)} could not be applied: ${summary.failed.reason}`
                  : summary.note}
                reserveSpace={false}
                tone={summary.failed ? "error" : "info"}
              />
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void submit(
                  () => dismissTrainingNoticeAction({ playerId: memberId }),
                  () => "Notice dismissed",
                )}
                type="button"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div className={styles.actions}>
            {!onboarded ? (
              <>
                <p className={styles.help}>
                  Finish <Link href={`/coach/onboarding?player=${encodeURIComponent(memberId)}`}>Player onboarding</Link> first. It sets this player&apos;s first schedule and fee plan.
                </p>
                {/* A player who leaves part-way through can still be taken off their schedule. */}
                {current.length ? (
                  <button className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => toggle("end")} type="button">
                    End training
                  </button>
                ) : null}
              </>
            ) : current.length ? (
              <>
                <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => toggle("change")} type="button">
                  {scheduled?.kind === "change" ? "Edit scheduled change" : "Change schedule"}
                </button>
                <button className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => toggle("end")} type="button">
                  End training
                </button>
              </>
            ) : (
              <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => toggle("start")} type="button">
                {scheduled?.kind === "change" ? "Edit scheduled start" : "Start training"}
              </button>
            )}
            {scheduled ? (
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void submit(
                  () => cancelTrainingChangeAction({ changeId: scheduled.id }),
                  () => "Scheduled change cancelled",
                )}
                type="button"
              >
                Cancel scheduled change
              </button>
            ) : null}
          </div>
        </div>

        {data.financeActive ? (
          <div className={styles.column}>
            <span className={styles.eyebrow}>Fees</span>
            <h4>Monthly fee</h4>
            {fee ? (
              <dl className={styles.facts}>
                <div><dt>Monthly fee</dt><dd>{fee.monthlyFeePaise !== null ? formatInr(fee.monthlyFeePaise) : "None"}</dd></div>
                <div>
                  <dt>{thisMonth} fee</dt>
                  <dd>{fee.thisMonth
                    ? `${formatInr(fee.thisMonth.amountPaise)} · ${fee.thisMonth.receivedPaise >= fee.thisMonth.amountPaise
                      ? "paid"
                      : fee.thisMonth.receivedPaise > 0
                        ? `${formatInr(fee.thisMonth.receivedPaise)} paid`
                        : `due ${dayName(fee.thisMonth.dueDate)}`}`
                    : "Not issued yet"}</dd>
                </div>
                <div><dt>From {nextMonth}</dt><dd>{fee.nextMonthNoFee === "term-finished"
                  ? "No fee: term finished"
                  : fee.nextMonthNoFee === "no-schedule"
                    ? "No fee: not on a schedule"
                    : fee.nextMonthFeePaise !== null ? formatInr(fee.nextMonthFeePaise) : "No fee"}</dd></div>
                <div>
                  <dt>Concession</dt>
                  <dd>{fee.concession
                    ? `${fee.concession.valueKind === "percentage" ? `${fee.concession.value / 100}%` : formatInr(fee.concession.value)} off · ${fee.concession.endsPeriod === fee.concession.startsPeriod ? monthName(`${fee.concession.startsPeriod}-01`) : `from ${monthName(`${fee.concession.startsPeriod}-01`)}${fee.concession.endsPeriod ? ` to ${monthName(`${fee.concession.endsPeriod}-01`)}` : ""}`}`
                    : "None"}</dd>
                </div>
              </dl>
            ) : (
              <p className={styles.help}>No fee plan yet. It is set during Player onboarding.</p>
            )}
            {/* Without a running place there is no fee to change. A booked
                move carries its own fee, edited with that change; a booked
                end needs nothing more. A player on no schedule at all, with
                nothing booked, can have their kept fee plan stopped; one
                still holding a place (a finished term, say) uses End
                training, which stops fees too. */}
            {fee?.activeAgreementId && !hasRunningPlace && !scheduled ? (
              <p className={styles.help}>
                {canStopFees
                  ? "Not on a schedule, so no fee is issued. Move them to a schedule to change their fee, or stop fees to end the fee plan."
                  : "Move them to a schedule first to change their fee."}
              </p>
            ) : null}
            {fee?.waitingFeeChange ? (
              <p className={styles.help}>
                New fee of {formatInr(fee.waitingFeeChange.feePaise)} starts with {monthName(fee.waitingFeeChange.startsOn)}&apos;s fee. Cancel it to keep {formatInr(fee.waitingFeeChange.previousFeePaise)} a month.
              </p>
            ) : null}
            {fee?.activeAgreementId && scheduled?.kind === "change" ? (
              <p className={styles.help}>
                Their fee from {monthName(scheduled.effectiveOn)} is set in the scheduled change.
              </p>
            ) : null}
            {fee?.activeAgreementId && scheduled?.kind === "end" && scheduled.stopFees ? (
              <p className={styles.help}>
                Fees stop after {monthBefore(scheduled.effectiveOn)} with the planned end of training.
              </p>
            ) : null}
            {fee?.activeAgreementId ? (
              <div className={styles.actions}>
                {/* Not while a booking decides the fee: a waiting move carries
                    its own fee (the server refuses Change fee then), and after
                    a waiting end that stops fees there is no later fee to
                    change -- a new one would only be cancelled again. */}
                {hasRunningPlace && !(scheduled?.kind === "change")
                  && !(scheduled?.kind === "end" && scheduled.stopFees) ? (
                  <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => toggle("fee")} type="button">
                    Change fee
                  </button>
                ) : null}
                {fee.waitingFeeChange ? (
                  <button
                    className={styles.button}
                    disabled={busy}
                    onClick={() => {
                      const waiting = fee.waitingFeeChange
                      if (!waiting) return
                      void submit(
                        () => cancelFeeChangeAction({
                          agreementId: waiting.agreementId,
                          expectedRevision: waiting.revision,
                          playerId: memberId,
                        }),
                        (result) => `Fee change cancelled. ${formatInr(result.monthlyFeePaise)} a month carries on`,
                      )
                    }}
                    type="button"
                  >
                    Cancel this fee change
                  </button>
                ) : null}
                {canStopFees ? (
                  <button className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => toggle("stop-fees")} type="button">
                    Stop fees
                  </button>
                ) : null}
                {fee.concession ? (
                  <button
                    className={styles.button}
                    disabled={busy}
                    onClick={() => {
                      if (!fee.concession) return
                      const concession = fee.concession
                      void submit(
                        () => stopConcessionAction({
                          concessionId: concession.id,
                          expectedRevision: concession.revision,
                          mutationId: newKey(),
                        }),
                        () => "Concession stopped",
                      )
                    }}
                    type="button"
                  >
                    Stop concession
                  </button>
                ) : (
                  <button className={styles.button} disabled={busy} onClick={() => toggle("concession")} type="button">
                    Give concession
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <InlineNotice className={styles.notice} message={notice?.message} reserveSpace={false} tone={notice?.tone} />

      {open === "change" || open === "start" ? (
        <TrainingForm
          busy={busy}
          currentSeriesIds={current.map((item) => item.seriesId)}
          currentWeekdays={[...new Set(current.flatMap((item) => item.weekdays))]}
          financeActive={data.financeActive}
          fee={fee}
          mode={open}
          monthStart={`${data.today.slice(0, 7)}-01`}
          nextMonthStart={data.nextMonthStart}
          today={data.today}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
          player={player}
          scheduled={scheduled}
          series={sessionSeries}
        />
      ) : null}
      {open === "end" ? (
        <EndForm
          busy={busy}
          financeActive={data.financeActive && Boolean(fee?.activeAgreementId)}
          inOnboarding={!onboarded}
          name={player.member.fullName}
          nextMonthStart={data.nextMonthStart}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
          playerId={memberId}
          termFinishedOn={player.training.termFinishedOn}
          thisMonth={thisMonth}
        />
      ) : null}
      {open === "fee" && fee && hasRunningPlace ? (
        <FeeForm
          busy={busy}
          currentFee={fee.monthlyFeePaise}
          name={player.member.fullName}
          startsMonth={monthName(fee.feeChangeStartsOn)}
          startsThisMonth={fee.feeChangeStartsOn <= data.today}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
          playerId={memberId}
          thisMonth={thisMonth}
        />
      ) : null}
      {open === "stop-fees" && canStopFees ? (
        <StopFeesForm
          busy={busy}
          name={player.member.fullName}
          nextMonth={nextMonth}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
          playerId={memberId}
          thisMonth={thisMonth}
        />
      ) : null}
      {open === "concession" && fee ? (
        <ConcessionForm
          busy={busy}
          monthlyFee={fee.nextMonthFeePaise ?? fee.monthlyFeePaise}
          name={player.member.fullName}
          nextMonth={nextMonth}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
          playerId={memberId}
        />
      ) : null}
    </section>
  )
}

type Submit = <T>(
  action: () => Promise<OperationalActionResult<T>>,
  success: (data: T) => string,
) => Promise<void>

function TrainingForm({
  busy,
  currentSeriesIds,
  currentWeekdays,
  fee,
  financeActive,
  mode,
  monthStart,
  nextMonthStart,
  onCancel,
  onSubmit,
  player,
  scheduled,
  series,
  today,
}: {
  busy: boolean
  currentSeriesIds: string[]
  currentWeekdays: number[]
  fee: MemberFeeSummary | null
  financeActive: boolean
  mode: "change" | "start"
  monthStart: string
  nextMonthStart: string
  onCancel: () => void
  onSubmit: Submit
  player: PlayerMemberRecord
  scheduled: MemberScheduledChange | null
  series: TrainingSessionSeries[]
  today: string
}) {
  const editing = scheduled?.kind === "change"
  const current = {
    academyPlan: player.training.academyPlan as AcademyPlan,
    batch: player.training.batch as TrainingBatch,
    level: player.training.level as TrainingProgramme,
  }
  // A paused player restarts from next month; an edit of a waiting change stays
  // there. A waiting end of training does not stop a change this month (it
  // still ends their training after this month), but a start date has to fall
  // on or after their training start, so a player who only starts after today
  // has no day this month to offer.
  const canStartThisMonth = mode === "change" && !editing && player.member.trainingStartOn <= today
  const endWaiting = scheduled?.kind === "end"
  const [when, setWhen] = useState<"next" | "this">(canStartThisMonth ? "this" : "next")
  const [date, setDate] = useState(today)
  const startsOn = when === "next" ? nextMonthStart : date
  const thisMonthPaid = financeActive && (fee?.thisMonth?.receivedPaise ?? 0) > 0
  const lockProfile = when === "this" && thisMonthPaid

  const [level, setLevel] = useState<TrainingProgramme>(
    (editing ? scheduled?.level : current.level) as TrainingProgramme,
  )
  const [batch, setBatch] = useState<TrainingBatch>(
    (editing ? scheduled?.batch : current.batch) as TrainingBatch,
  )
  const [plan, setPlan] = useState<AcademyPlan>(
    (editing ? scheduled?.academyPlan : current.academyPlan) as AcademyPlan,
  )
  const [seriesId, setSeriesId] = useState(editing ? scheduled?.seriesId ?? "" : "")
  const [weekdays, setWeekdays] = useState<number[]>(editing ? scheduled?.weekdays ?? [] : [])
  const [feeText, setFeeText] = useState("")
  const [feeTouched, setFeeTouched] = useState(false)
  const [marks, setMarks] = useState<Array<{ choice: string; occurrenceDate: string }> | null>(null)
  // A check that failed is not "nothing to clear": it used to read as if no
  // mark would be cleared, the coach confirmed, and the marks went anyway.
  const [marksFailed, setMarksFailed] = useState(false)
  const [marksAttempt, setMarksAttempt] = useState(0)

  useEffect(() => {
    if (when !== "this" || !date) return
    let live = true
    void previewScheduleChangeAction({ playerId: player.member.id, startsOn: date }).then((preview) => {
      if (live) setMarks(preview.marks)
    }).catch(() => {
      if (live) setMarksFailed(true)
    })
    return () => {
      live = false
    }
  }, [date, marksAttempt, player.member.id, when])

  function chooseWhen(next: "next" | "this") {
    if (next === "this" && when !== "this") {
      setMarks(null)
      setMarksFailed(false)
    }
    setWhen(next)
    if (next === "this" && thisMonthPaid) {
      // A paid month keeps its level, batch and plan; only the session time moves.
      setLevel(current.level)
      setBatch(current.batch)
      setPlan(current.academyPlan)
      setSeriesId("")
      setWeekdays([])
    }
  }

  const batches = academyBatchesFor(level)
  const plans = academyPlansFor(level, batch)
  const options = series.filter((item) => (
    item.status === "active"
    && item.programme === level
    && item.batch === batch
    && item.startsOn <= startsOn
    && (!item.endsOn || item.endsOn >= startsOn)
  ))
  const chosen = options.find((item) => item.id === seriesId) ?? null
  const offered = chosen ? [...new Set(chosen.slots.map((slot) => slot.weekday))] : []
  const required = plan ? academyPlanRequiredWeekdayCount(plan) : null
  const limit = plan ? academyPlanAssignmentLimit(plan) : 0
  const daysOk = required === null ? weekdays.length > 0 && weekdays.length <= limit : weekdays.length === required

  const profileChanges = level !== current.level || batch !== current.batch || plan !== current.academyPlan
  const standard = plan ? defaultMonthlyFeePaise({ academyPlan: plan, batch, level }) : null
  const suggestedFee = editing && scheduled?.monthlyFeePaise
    ? scheduled.monthlyFeePaise
    : !profileChanges && fee?.monthlyFeePaise ? fee.monthlyFeePaise : standard ?? fee?.monthlyFeePaise ?? null
  const feePaise = feeTouched ? parseRupeesToPaise(feeText) : suggestedFee
  // This month, a fee is asked for only when the level, batch or plan changes.
  const askFee = financeActive && (when === "next" || profileChanges)
  const feeOk = !askFee || (feePaise !== null && feePaise > 0)
  const dateOk = when === "next" || (date >= monthStart && date <= today && date >= player.member.trainingStartOn)

  function chooseSeries(id: string) {
    setSeriesId(id)
    const item = options.find((option) => option.id === id)
    const offeredDays = item ? new Set(item.slots.map((slot) => slot.weekday)) : new Set<number>()
    const keep = currentWeekdays.filter((day) => offeredDays.has(day))
    setWeekdays(required !== null && keep.length === required ? keep : required === null ? keep.slice(0, limit) : [])
  }

  function toggleDay(day: number) {
    setWeekdays((value) => {
      if (value.includes(day)) return value.filter((item) => item !== day)
      if (value.length >= limit) return value
      return [...value, day].sort((first, second) => first - second)
    })
  }

  const thisMonth = monthName(monthStart)
  const label = chosen ? seriesLabel(chosen) : "the new schedule"
  const thisMonthFee = fee?.thisMonth?.amountPaise ?? null
  // The same sum the server runs when it posts the correction, so the figure
  // confirmed here is the figure billed (concessions included).
  const thisMonthBasis = fee?.thisMonth?.basis ?? null
  const correctedThisMonth = when === "this" && profileChanges && thisMonthBasis && feePaise
    ? planThisMonthFeeCorrection(thisMonthBasis, feePaise).newAmountPaise
    : null

  const summary = chosen && daysOk && dateOk ? [
    when === "this"
      ? `From ${dayName(startsOn)}: ${label} on ${dayList(weekdays)}${profileChanges ? `, ${academyPlanLabel(plan)}` : ""}`
      : `From ${dayName(startsOn)}: ${label} on ${dayList(weekdays)}, ${academyPlanLabel(plan)}`,
    when === "this"
      ? marks?.length
        ? `Clear ${marks.length} ${marks.length === 1 ? "mark" : "marks"} in the old schedule from ${dayName(startsOn)}; mark ${marks.length === 1 ? "it" : "them"} again`
        : "No attendance marks to clear"
      : `Keep ${thisMonth} exactly as it is`,
    ...(askFee && feePaise
      ? [when === "this"
        ? `Monthly fee ${formatInr(feePaise)}${correctedThisMonth !== null && thisMonthFee !== null && correctedThisMonth !== thisMonthFee ? `; ${thisMonth}'s fee becomes ${formatInr(correctedThisMonth)}` : thisMonthFee === null ? `; ${thisMonth}'s fee is issued at this amount` : ""}`
        : `From ${monthName(startsOn)}: ${formatInr(feePaise)} a month`]
      : financeActive && when === "this" ? ["Keep the fee as it is"] : []),
  ] : []

  return (
    <FormShell
      busy={busy}
      confirmLabel={when === "next" ? (editing ? "Save scheduled change" : "Schedule the change") : "Change schedule"}
      disabled={!chosen || !daysOk || !feeOk || !dateOk || (when === "this" && (marks === null || marksFailed))}
      eyebrow={mode === "start" ? "Start training" : "Change schedule"}
      onCancel={onCancel}
      onConfirm={() => {
        if (!chosen) return
        void onSubmit(
          () => changeScheduleAction({
            academyPlan: plan,
            batch,
            level,
            monthlyFeePaise: askFee ? feePaise : null,
            playerId: player.member.id,
            seriesId: chosen.id,
            startsOn,
            weekdays,
            when,
          }),
          (outcome) => {
            if (outcome.kind === "scheduled") return `Scheduled for ${dayName(outcome.startsOn)}`
            const parts = [`Schedule changed from ${dayName(outcome.startsOn)}`]
            const cleared = outcome.result?.clearedMarks.length ?? 0
            if (cleared) parts.push(`${cleared} ${cleared === 1 ? "mark" : "marks"} cleared; mark ${cleared === 1 ? "it" : "them"} again`)
            if (outcome.result?.newAmountPaise != null) {
              parts.push(`${thisMonth}'s fee is now ${formatInr(outcome.result.newAmountPaise)}`)
            }
            return parts.join(". ")
          },
        )
      }}
      summary={summary}
      title={mode === "start"
        ? `Start ${player.member.fullName}'s training`
        : `Change ${player.member.fullName}'s schedule`}
    >
      <fieldset className={styles.field}>
        <legend className={styles.label}>Starts</legend>
        {canStartThisMonth ? (
          <label className={`${styles.option} ${when === "this" ? styles.optionOn : ""}`}>
            <input name={`when-${player.member.id}`} type="radio" checked={when === "this"} onChange={() => chooseWhen("this")} />
            <span>
              <strong>This month</strong>
              <small>From a day you choose, up to today</small>
            </span>
          </label>
        ) : null}
        {when === "this" ? (
          <label className={styles.inlineField}>
            <span>From</span>
            <input
              name="startsOn"
              type="date"
              min={monthStart > player.member.trainingStartOn ? monthStart : player.member.trainingStartOn}
              max={today}
              value={date}
              onChange={(event) => {
                setMarks(null)
                setMarksFailed(false)
                setDate(event.target.value)
              }}
            />
          </label>
        ) : null}
        <label className={`${styles.option} ${when === "next" ? styles.optionOn : ""}`}>
          <input name={`when-${player.member.id}`} type="radio" checked={when === "next"} onChange={() => chooseWhen("next")} />
          <span>
            <strong>From {dayName(nextMonthStart)}</strong>
            <small>
              Next month. {thisMonth} stays exactly as it is.
              {endWaiting ? " This replaces the planned end of training." : ""}
            </small>
          </span>
        </label>
        {endWaiting && when === "this" ? (
          <p className={styles.help}>Their training still ends after {thisMonth}, as planned.</p>
        ) : null}
      </fieldset>

      <div className={styles.field}>
        <span className={styles.label}>Level, batch and plan</span>
        <div className={styles.selects}>
          <label>
            <span className="sr-only">Level</span>
            <select name="level" disabled={lockProfile} value={level} onChange={(event) => {
              const next = event.target.value as TrainingProgramme
              setLevel(next)
              const nextBatch = academyBatchesFor(next).includes(batch) ? batch : academyBatchesFor(next)[0]
              setBatch(nextBatch)
              setPlan(academyPlansFor(next, nextBatch)[0])
              setSeriesId("")
              setWeekdays([])
            }}>
              {LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Batch</span>
            <select name="batch" disabled={lockProfile} value={batch} onChange={(event) => {
              const next = event.target.value as TrainingBatch
              setBatch(next)
              setPlan(academyPlansFor(level, next)[0])
              setSeriesId("")
              setWeekdays([])
            }}>
              {batches.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Academy plan</span>
            <select name="academyPlan" disabled={lockProfile} value={plan} onChange={(event) => {
              setPlan(event.target.value as AcademyPlan)
              setWeekdays([])
            }}>
              {plans.map((item) => <option key={item} value={item}>{academyPlanLabel(item)}</option>)}
            </select>
          </label>
        </div>
        {lockProfile ? (
          <p className={styles.help}>
            {thisMonth}&apos;s fee has already been paid, so only the session time can change this month.
            To change the level, batch or plan, start from {dayName(nextMonthStart)}.
          </p>
        ) : null}
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Schedule ({level} · {batch})</legend>
        {options.length ? options.map((item) => (
          <label className={`${styles.option} ${seriesId === item.id ? styles.optionOn : ""}`} key={item.id}>
            <input name={`series-${player.member.id}`} type="radio" checked={seriesId === item.id} onChange={() => chooseSeries(item.id)} />
            <span>
              <strong>{seriesLabel(item)}</strong>
              <small>{dayList([...new Set(item.slots.map((slot) => slot.weekday))])}{currentSeriesIds.includes(item.id) ? " · current schedule" : ""}</small>
            </span>
          </label>
        )) : <p className={styles.help}>No {level} · {batch} schedule is running on {dayName(startsOn)}. Create one in Schedules &amp; rosters first.</p>}
      </fieldset>

      {chosen ? (
        <fieldset className={styles.field}>
          <legend className={styles.label}>
            Training days · {required === null ? `up to ${limit}` : `choose ${required}`}
          </legend>
          <div className={styles.days}>
            {DAYS.filter((day) => offered.includes(day.value)).map((day) => (
              <label className={`${styles.day} ${weekdays.includes(day.value) ? styles.dayOn : ""}`} key={day.value}>
                <input name={`day-${player.member.id}`} type="checkbox" checked={weekdays.includes(day.value)} onChange={() => toggleDay(day.value)} />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {askFee ? (
        <div className={styles.field}>
          <label>
            <span className={styles.label}>{when === "this" ? "Monthly fee for this plan" : `Monthly fee from ${monthName(startsOn)}`}</span>
            <span className={styles.money}>
              <span aria-hidden="true">₹</span>
              <input
                name="monthlyFee"
                inputMode="decimal"
                value={feeTouched ? feeText : suggestedFee !== null ? String(suggestedFee / 100) : ""}
                onChange={(event) => {
                  setFeeTouched(true)
                  setFeeText(event.target.value)
                }}
              />
            </span>
          </label>
          <p className={styles.help}>
            {standard !== null ? `Standard fee for ${level} · ${academyPlanLabel(plan)}: ${formatInr(standard)}.` : "No standard fee for this plan; agree one with the player."}
            {when === "this" && thisMonthFee !== null && correctedThisMonth !== null && correctedThisMonth !== thisMonthFee
              ? ` ${thisMonth}'s fee is not paid yet, so it changes too: ${formatInr(thisMonthFee)} becomes ${formatInr(correctedThisMonth)}. The player sees the new amount.`
              : ""}
          </p>
        </div>
      ) : null}

      {when === "this" ? (
        <div className={styles.field}>
          <span className={styles.label}>Attendance that will be cleared</span>
          {marksFailed ? (
            <p className={styles.help}>
              Could not check which marks would be cleared. Check your connection, then{" "}
              <button
                className={styles.button}
                onClick={() => {
                  setMarks(null)
                  setMarksFailed(false)
                  setMarksAttempt((value) => value + 1)
                }}
                type="button"
              >
                check again
              </button>
            </p>
          ) : marks === null ? <p className={styles.help}>Checking…</p> : marks.length ? (
            <ul className={styles.marks}>
              {marks.map((item) => (
                <li key={item.occurrenceDate}><span>{dayName(item.occurrenceDate)}</span><s>{item.choice === "present" ? "Present" : "Absent"}</s></li>
              ))}
            </ul>
          ) : <p className={styles.help}>No marks in the old schedule from this date, so nothing is cleared.</p>}
          <p className={styles.help}>Days before the start date stay in the old schedule. Mark any cleared days again on the new schedule.</p>
        </div>
      ) : null}
    </FormShell>
  )
}

function EndForm({
  busy,
  financeActive,
  inOnboarding,
  name,
  nextMonthStart,
  onCancel,
  onSubmit,
  playerId,
  termFinishedOn,
  thisMonth,
}: {
  busy: boolean
  financeActive: boolean
  /** The player has not finished Player onboarding (head coach, 12 Nov 2026). */
  inOnboarding: boolean
  name: string
  nextMonthStart: string
  onCancel: () => void
  onSubmit: Submit
  playerId: string
  /** Set when the player's term has finished; the ending itself is unchanged. */
  termFinishedOn: string | null
  thisMonth: string
}) {
  const [leftAlready, setLeftAlready] = useState(false)
  const [stopFees, setStopFees] = useState(true)
  return (
    <FormShell
      busy={busy}
      confirmLabel="End training"
      danger
      eyebrow="End training"
      onCancel={onCancel}
      onConfirm={() => {
        void onSubmit<unknown>(
          () => leftAlready
            ? endTrainingNowAction({ playerId, stopFees: financeActive && stopFees })
            : scheduleEndOfTrainingAction({ playerId, stopFees: financeActive && stopFees }),
          () => leftAlready ? "Training ended today" : `Training ends after ${thisMonth}`,
        )
      }}
      summary={[
        leftAlready ? "Take them off their schedule today" : `Keep them on their schedule until the end of ${thisMonth}`,
        leftAlready ? "Pause them from today" : `Pause them from ${dayName(nextMonthStart)}`,
        ...(financeActive ? [stopFees ? `Stop fees after ${thisMonth}` : "Keep the fee plan"] : []),
      ]}
      title={`${name} stops training`}
    >
      {termFinishedOn ? (
        <p className={styles.help}>Their term finished on {formatTermDate(termFinishedOn)}.</p>
      ) : null}
      {inOnboarding ? (
        <p className={styles.help}>
          {name} has not finished Player onboarding, so they have no fee plan and cannot sign in
          yet. Ending training keeps the days they were on their first schedule. Afterwards,
          finish onboarding to charge the registration fee and the months they trained.
        </p>
      ) : null}
      <div className={styles.field}>
        <span className={styles.label}>Last month of training</span>
        <div className={styles.fixed}>{thisMonth} · this month</div>
      </div>
      {financeActive ? (
        <fieldset className={styles.field}>
          <legend className={styles.label}>Fees</legend>
          <label className={`${styles.option} ${stopFees ? styles.optionOn : ""}`}>
            <input name={`fees-${playerId}`} type="radio" checked={stopFees} onChange={() => setStopFees(true)} />
            <span><strong>Stop fees after {thisMonth}</strong><small>{thisMonth}&apos;s fee stays as it is.</small></span>
          </label>
          <label className={`${styles.option} ${!stopFees ? styles.optionOn : ""}`}>
            <input name={`fees-${playerId}`} type="radio" checked={!stopFees} onChange={() => setStopFees(false)} />
            <span><strong>Keep the fee plan</strong><small>For a break. No fee is issued while they are on no schedule.</small></span>
          </label>
        </fieldset>
      ) : null}
      <label className={styles.check}>
        <input name="leftAlready" type="checkbox" checked={leftAlready} onChange={(event) => setLeftAlready(event.target.checked)} />
        <span><strong>They have left already.</strong> Take them off their schedule today instead of at the end of the month.</span>
      </label>
    </FormShell>
  )
}

/*
 * Stop fees for a player on no schedule whose fee plan was kept (head coach,
 * 12 Nov 2026). The same ending as End training's "Stop fees": the plan ends
 * after this month, a plan due to start next month never bills, and fees
 * already issued do not change. Archive then has nothing left to wait for
 * but money owed.
 */
function StopFeesForm({
  busy,
  name,
  nextMonth,
  onCancel,
  onSubmit,
  playerId,
  thisMonth,
}: {
  busy: boolean
  name: string
  nextMonth: string
  onCancel: () => void
  onSubmit: Submit
  playerId: string
  thisMonth: string
}) {
  return (
    <FormShell
      busy={busy}
      confirmLabel="Stop fees"
      danger
      eyebrow="Stop fees"
      onCancel={onCancel}
      onConfirm={() => {
        void onSubmit(
          () => stopFeePlanAction({ playerId }),
          () => `Fees stop after ${thisMonth}`,
        )
      }}
      summary={[
        `Stop fees after ${thisMonth}`,
        `Issue no fee from ${nextMonth}`,
        "Leave fees already issued as they are",
      ]}
      title={`Stop fees for ${name}`}
    >
      <p className={styles.help}>
        They are not on a schedule. To train again later, use Start training, which sets a new fee.
      </p>
    </FormShell>
  )
}

function FeeForm({
  busy,
  currentFee,
  name,
  onCancel,
  onSubmit,
  playerId,
  startsMonth,
  startsThisMonth,
  thisMonth,
}: {
  busy: boolean
  currentFee: number | null
  name: string
  onCancel: () => void
  onSubmit: Submit
  playerId: string
  /** The month the new fee takes, worked out on the server (lib/training/fees.ts). */
  startsMonth: string
  /** On the 1st, before this month's fee is issued, the new fee takes this month. */
  startsThisMonth: boolean
  thisMonth: string
}) {
  const [text, setText] = useState(currentFee !== null ? String(currentFee / 100) : "")
  const [key] = useState(newKey)
  const amount = parseRupeesToPaise(text)
  return (
    <FormShell
      busy={busy}
      confirmLabel="Save new fee"
      disabled={amount === null || amount <= 0 || amount === currentFee}
      eyebrow="Change fee"
      onCancel={onCancel}
      onConfirm={() => {
        if (amount === null) return
        void onSubmit(
          () => changeMonthlyFeeAction({ idempotencyKey: `member-fee:${key}`, monthlyFeePaise: amount, playerId }),
          (result) => `New fee from ${monthName(result.startsOn)}`,
        )
      }}
      summary={amount && amount !== currentFee ? [
        startsThisMonth
          ? `${thisMonth}'s fee is not issued yet, so it uses the new fee`
          : `Keep ${thisMonth} as it is`,
        `Charge ${formatInr(amount)} a month from ${startsMonth}`,
      ] : []}
      title={`New monthly fee for ${name}`}
    >
      <div className={styles.field}>
        <label>
          <span className={styles.label}>New monthly fee</span>
          <span className={styles.money}>
            <span aria-hidden="true">₹</span>
            <input name="newMonthlyFee" inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} />
          </span>
        </label>
        <p className={styles.help}>Now {currentFee !== null ? formatInr(currentFee) : "no fee"}. Starts with {startsMonth}&apos;s fee{startsThisMonth ? ", which is not issued yet" : ""}; fees already issued do not change.</p>
      </div>
    </FormShell>
  )
}

function ConcessionForm({
  busy,
  monthlyFee,
  name,
  nextMonth,
  onCancel,
  onSubmit,
  playerId,
}: {
  busy: boolean
  monthlyFee: number | null
  name: string
  nextMonth: string
  onCancel: () => void
  onSubmit: Submit
  playerId: string
}) {
  const [kind, setKind] = useState<"fixed" | "percentage">("fixed")
  const [text, setText] = useState("")
  const [duration, setDuration] = useState<"one" | "months" | "open">("one")
  const [months, setMonths] = useState("3")
  const [key] = useState(newKey)
  const value = kind === "fixed" ? parseRupeesToPaise(text) : Number(text)
  const valid = kind === "fixed"
    ? value !== null && value > 0
    : Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100
  const off = valid && monthlyFee !== null
    ? Math.min(monthlyFee, kind === "fixed" ? value as number : Math.round(monthlyFee * (value as number) / 100))
    : null
  return (
    <FormShell
      busy={busy}
      confirmLabel="Give concession"
      disabled={!valid || (duration === "months" && !(Number(months) >= 1 && Number(months) <= 24))}
      eyebrow="Give concession"
      onCancel={onCancel}
      onConfirm={() => {
        void onSubmit(
          () => giveConcessionAction({
            duration,
            months: duration === "months" ? Number(months) : undefined,
            mutationId: key,
            playerId,
            value: value as number,
            valueKind: kind,
          }),
          () => "Concession given",
        )
      }}
      summary={valid && off !== null ? [
        `Take ${formatInr(off)} off ${duration === "one" ? `${nextMonth}'s fee` : duration === "months" ? `${months} monthly fees from ${nextMonth}` : `every monthly fee from ${nextMonth} until you stop it`}`,
      ] : []}
      title={`Concession for ${name}`}
    >
      <fieldset className={styles.field}>
        <legend className={styles.label}>How much off</legend>
        <div className={styles.inline}>
          <label className={`${styles.option} ${kind === "fixed" ? styles.optionOn : ""}`}>
            <input name={`concession-kind-${playerId}`} type="radio" checked={kind === "fixed"} onChange={() => setKind("fixed")} />
            <strong>Amount</strong>
          </label>
          <label className={`${styles.option} ${kind === "percentage" ? styles.optionOn : ""}`}>
            <input name={`concession-kind-${playerId}`} type="radio" checked={kind === "percentage"} onChange={() => setKind("percentage")} />
            <strong>Percentage</strong>
          </label>
        </div>
        <span className={styles.money}>
          <span aria-hidden="true">{kind === "fixed" ? "₹" : "%"}</span>
          <input name="concessionValue" inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} aria-label={kind === "fixed" ? "Amount off" : "Percentage off"} />
        </span>
      </fieldset>
      <fieldset className={styles.field}>
        <legend className={styles.label}>For how long</legend>
        {([
          ["one", "One month", `${nextMonth} only`],
          ["months", "A number of months", `From ${nextMonth}`],
          ["open", "Until I stop it", `From ${nextMonth}`],
        ] as const).map(([valueKey, labelText, hint]) => (
          <label className={`${styles.option} ${duration === valueKey ? styles.optionOn : ""}`} key={valueKey}>
            <input name={`concession-duration-${playerId}`} type="radio" checked={duration === valueKey} onChange={() => setDuration(valueKey)} />
            <span><strong>{labelText}</strong><small>{hint}</small></span>
          </label>
        ))}
        {duration === "months" ? (
          <label className={styles.inlineField}>
            <span>Months</span>
            <input name="concessionMonths" inputMode="numeric" value={months} onChange={(event) => setMonths(event.target.value)} />
          </label>
        ) : null}
      </fieldset>
      {valid && off !== null && monthlyFee !== null ? (
        <p className={styles.help}>{nextMonth}: {formatInr(monthlyFee)} − {formatInr(off)} = {formatInr(monthlyFee - off)}. The player sees the lower fee, not the reason.</p>
      ) : null}
    </FormShell>
  )
}
