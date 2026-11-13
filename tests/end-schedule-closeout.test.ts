import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-end-schedule-closeout-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * End schedule finishes the job, and no fee plan is left that nothing can end
 * (head coach, 12 Nov 2026). One academy, one sequence of head-coach actions:
 * fee plans made in October, End schedule and the Members actions on
 * Thursday 12 November, then December's fees.
 */
describe("End schedule closes out its players, and every kept fee plan can be stopped", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let changes: typeof import("@/lib/training/changes")
  let fees: typeof import("@/lib/training/fees")
  let finance: typeof import("@/lib/finance/service")
  let members: typeof import("@/lib/coach/member-service")
  let sessions: typeof import("@/lib/sessions/service")
  let summaries: typeof import("@/lib/training/member-summaries")
  let coachId: string
  let morning: string
  let evening: string
  let autumn: string
  let finishedEarly: string
  let finishedLate: string
  let winter: string
  let spring: string

  const october = new Date("2026-10-05T05:00:00.000Z")
  // Thursday 12 November 2026, 10:30 in India: before the day's 18:00 session.
  const now = new Date("2026-11-12T05:00:00.000Z")
  const firstDecember = new Date("2026-12-01T05:00:00.000Z")
  const secondDecember = new Date("2026-12-02T05:00:00.000Z")
  const fiveDay = { academyPlan: "weekday-5-day" as const, batch: "Weekday" as const, level: "Beginner" as const }
  const players = {
    asha: "22000000-0000-4000-8000-0000000000c1",
    bala: "22000000-0000-4000-8000-0000000000c2",
    chitra: "22000000-0000-4000-8000-0000000000c3",
    dev: "22000000-0000-4000-8000-0000000000c4",
    esha: "22000000-0000-4000-8000-0000000000c5",
    farhan: "22000000-0000-4000-8000-0000000000c6",
    gita: "22000000-0000-4000-8000-0000000000c7",
    hari: "22000000-0000-4000-8000-0000000000c8",
    isha: "22000000-0000-4000-8000-0000000000c9",
    jay: "22000000-0000-4000-8000-0000000000ca",
    kiran: "22000000-0000-4000-8000-0000000000cb",
    lata: "22000000-0000-4000-8000-0000000000cc",
    mohan: "22000000-0000-4000-8000-0000000000cd",
    nina: "22000000-0000-4000-8000-0000000000ce",
    om: "22000000-0000-4000-8000-0000000000cf",
    priya: "22000000-0000-4000-8000-0000000000d0",
    quinn: "22000000-0000-4000-8000-0000000000d1",
    roshan: "22000000-0000-4000-8000-0000000000d2",
  }
  let nextMutation = 0
  const mutationId = () => `00000000-0000-4000-8000-${String(nextMutation += 1).padStart(12, "0")}`
  const context = (at = now) => ({ coachId, database, now: at })

  function addPlayer(
    id: string,
    name: string,
    serial: number,
    seriesIds: string[],
    { onboarded = true }: { onboarded?: boolean } = {},
  ) {
    database.insert(schema.accounts).values({
      id,
      fullName: name,
      normalizedName: name.toLowerCase(),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: october,
      createdAt: october,
      updatedAt: october,
    }).run()
    database.insert(schema.academyIdAllocations).values({ serial, accountId: id, createdAt: october }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      ...fiveDay,
      status: "active",
      trainingStartOn: "2026-07-01",
      onboardingCompletedAt: onboarded ? october : null,
      updatedAt: october,
    }).run()
    for (const seriesId of seriesIds) {
      const assignmentId = `assignment-${id}-${seriesId}`
      database.insert(schema.sessionAssignments).values({
        id: assignmentId,
        accountId: id,
        seriesId,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        assignedByAccountId: coachId,
        assignedAt: october,
      }).run()
      for (const weekday of [1, 2, 3, 4, 5]) {
        database.insert(schema.sessionAssignmentWeekdays).values({
          id: `${assignmentId}-${weekday}`,
          assignmentId,
          weekday,
        }).run()
      }
    }
  }

  function plans(playerId: string) {
    return database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()
      .sort((first, second) => first.effectiveFrom.localeCompare(second.effectiveFrom))
  }

  function activePlan(playerId: string) {
    return plans(playerId).find((plan) => plan.status === "active") ?? null
  }

  function enrollment(playerId: string) {
    return database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()!
  }

  function openPlaces(playerId: string) {
    return database.select().from(schema.sessionAssignments).where(and(
      eq(schema.sessionAssignments.accountId, playerId),
      isNull(schema.sessionAssignments.effectiveTo),
    )).all()
  }

  function bookings(playerId: string) {
    return database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.playerAccountId, playerId)).all()
  }

  function summaryOf(playerId: string, at = now) {
    return summaries.listMemberTrainingSummaries([playerId], { database, now: at }).summaries[playerId]
  }

  function charge(playerId: string, period: string) {
    return database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, playerId),
      eq(schema.financialCharges.billingPeriod, period),
      eq(schema.financialCharges.lifecycle, "issued"),
    )).get()
  }

  function changeFee(playerId: string, monthlyFeePaise: number) {
    expect(fees.changeMonthlyFee({
      idempotencyKey: `fee-change-${playerId}`,
      monthlyFeePaise,
      playerId,
    }, context())).toMatchObject({ startsOn: "2026-12-01" })
  }

  function pay(playerId: string, period: string) {
    const fee = charge(playerId, period)!
    finance.recordAllocatedPayment({
      allocations: [{ amountPaise: fee.originalAmountPaise, chargeId: fee.id, expectedChargeRevision: fee.recordRevision }],
      amountPaise: fee.originalAmountPaise,
      method: "cash",
      mutationId: mutationId(),
      playerId,
      receivedOn: "2026-11-12",
    }, context())
  }

  function archive(playerId: string) {
    return members.archiveMemberRecord({
      coachId,
      database,
      input: { expectedRevision: enrollment(playerId).recordRevision, memberId: playerId },
      now,
    })
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    changes = await import("@/lib/training/changes")
    fees = await import("@/lib/training/fees")
    finance = await import("@/lib/finance/service")
    members = await import("@/lib/coach/member-service")
    sessions = await import("@/lib/sessions/service")
    summaries = await import("@/lib/training/member-summaries")
    const accountService = await import("@/lib/auth/account-service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    const series = (startTime: string, endsOn: string) => sessions.createSessionSeriesRecords({
      coachId,
      database,
      now: october,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-07-01",
        endsOn,
        weekdays: [1, 2, 3, 4, 5],
        startTime,
        durationMinutes: 60,
      },
    })
    morning = series("06:00", "2027-03-31")
    evening = series("16:00", "2027-03-31")
    autumn = series("18:00", "2027-03-31")
    finishedEarly = series("07:00", "2026-10-31")
    finishedLate = series("08:00", "2026-10-31")
    winter = series("09:00", "2027-03-31")
    spring = series("10:00", "2027-03-31")

    addPlayer(players.asha, "Asha Rao", 9201, [autumn])
    addPlayer(players.bala, "Bala Iyer", 9202, [autumn, morning])
    addPlayer(players.chitra, "Chitra Nair", 9203, [autumn])
    addPlayer(players.dev, "Dev Menon", 9204, [autumn])
    addPlayer(players.esha, "Esha Das", 9205, [morning])
    addPlayer(players.farhan, "Farhan Ali", 9206, [autumn])
    addPlayer(players.gita, "Gita Shah", 9207, [autumn], { onboarded: false })
    addPlayer(players.hari, "Hari Pillai", 9208, [finishedEarly])
    addPlayer(players.isha, "Isha Bose", 9209, [morning])
    addPlayer(players.jay, "Jay Patel", 9210, [morning])
    addPlayer(players.kiran, "Kiran Joshi", 9211, [morning])
    addPlayer(players.lata, "Lata Kapoor", 9212, [morning])
    addPlayer(players.mohan, "Mohan Reddy", 9213, [finishedLate])
    addPlayer(players.nina, "Nina George", 9214, [morning])
    addPlayer(players.om, "Om Varma", 9215, [morning])
    addPlayer(players.priya, "Priya Sen", 9216, [morning])

    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-end-schedule" }, context(october))
    for (const playerId of Object.values(players)) {
      // Gita is still in onboarding; Quinn and Roshan join later.
      if (playerId === players.gita || playerId === players.quinn || playerId === players.roshan) continue
      finance.createOrReplaceFeeAgreement({
        ...fiveDay,
        agreedMonthlyFeePaise: 400_000,
        effectiveFrom: "2026-07-01",
        idempotencyKey: `plan-${playerId}`,
        playerId,
      }, context(october))
    }
    finance.prepareMonthlyCharges({ period: "2026-10", idempotencyKey: "prepare-october-closeout" }, context(october))
    finance.prepareMonthlyCharges({ period: "2026-11", idempotencyKey: "prepare-november-closeout" }, context())

    // Booked in Members before the schedule is ended.
    changes.scheduleEndOfTraining({ playerId: players.chitra, stopFees: false }, context())
    changes.scheduleTrainingChange({
      ...fiveDay,
      monthlyFeePaise: 450_000,
      playerId: players.dev,
      seriesId: autumn,
      weekdays: [1, 2, 3, 4, 5],
    }, context())
    changes.scheduleTrainingChange({
      ...fiveDay,
      monthlyFeePaise: 400_000,
      playerId: players.esha,
      seriesId: autumn,
      weekdays: [1, 2, 3, 4, 5],
    }, context())
    changeFee(players.farhan, 450_000)
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("shows the head coach who is on the schedule and what will happen to each before anything changes", () => {
    const preview = sessions.previewEndSessionSeries({ coachId, database, now, seriesId: autumn })

    expect(preview).toMatchObject({ endsPlacesOn: "2026-11-12", financeActive: true, termFinished: false })
    const byName = new Map(preview.players.map((player) => [player.fullName, player]))
    expect(byName.get("Bala Iyer")).toMatchObject({ onAnotherSchedule: true })
    expect(byName.get("Chitra Nair")).toMatchObject({ bookingKept: { kind: "end" }, bookingOntoThis: null })
    expect(byName.get("Dev Menon")).toMatchObject({ bookingKept: null, bookingOntoThis: { kind: "change" } })
    expect(byName.get("Gita Shah")).toMatchObject({ hasFeePlan: false, inOnboarding: true })
    expect(preview.bookedOnto).toEqual([
      { effectiveOn: "2026-12-01", fullName: "Esha Das", playerId: players.esha },
    ])
    // Nothing was written.
    expect(openPlaces(players.asha)).toHaveLength(1)
    expect(bookings(players.esha)[0]?.status).toBe("scheduled")
  })

  it("ends the schedule with Stop fees: pauses, stops fees, keeps bookings elsewhere and cancels bookings onto it openly", () => {
    const novemberAsha = charge(players.asha, "2026-11")!
    const result = sessions.endSessionSeriesRecords({
      coachId,
      database,
      now,
      seriesId: autumn,
      stopFees: true,
    })

    const names = (list: Array<{ fullName: string }>) => list.map((item) => item.fullName).sort()
    expect(names(result.takenOff)).toEqual([
      "Asha Rao", "Bala Iyer", "Chitra Nair", "Dev Menon", "Farhan Ali", "Gita Shah",
    ])
    expect(names(result.keptActive)).toEqual(["Bala Iyer"])
    expect(names(result.bookingKept)).toEqual(["Chitra Nair"])
    expect(names(result.bookingCancelled)).toEqual(["Dev Menon", "Esha Das"])
    expect(result.bookingCancelled[0]?.schedule).toMatch(/^Beginner · Weekday/u)
    expect(names(result.feesStopped)).toEqual(["Asha Rao", "Dev Menon", "Farhan Ali"])
    expect(names(result.inOnboarding)).toEqual(["Gita Shah"])

    // Taken off today, paused, fee plan ends after November.
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.id, `assignment-${players.asha}-${autumn}`)).get()?.effectiveTo)
      .toBe("2026-11-12")
    expect(enrollment(players.asha).status).toBe("paused")
    expect(plans(players.asha)).toEqual([expect.objectContaining({ effectiveTo: "2026-11-30", status: "ended" })])
    // November's fee, already issued, is exactly as it was.
    expect(charge(players.asha, "2026-11")).toMatchObject({
      id: novemberAsha.id,
      lifecycle: "issued",
      originalAmountPaise: novemberAsha.originalAmountPaise,
    })

    // Still training on another schedule: active, fee plan untouched.
    expect(enrollment(players.bala).status).toBe("active")
    expect(openPlaces(players.bala).map((place) => place.seriesId)).toEqual([morning])
    expect(activePlan(players.bala)).toMatchObject({ effectiveTo: null, status: "active" })

    // A booked End training keeps what was arranged: still booked, plan kept.
    expect(bookings(players.chitra)).toEqual([expect.objectContaining({ kind: "end", status: "scheduled", stopFees: false })])
    expect(activePlan(players.chitra)).toMatchObject({ effectiveTo: null })

    // A booking that kept Dev on this schedule could never happen: cancelled
    // openly, then Dev is treated like everyone else.
    expect(bookings(players.dev)[0]).toMatchObject({ status: "cancelled" })
    expect(enrollment(players.dev).status).toBe("paused")
    expect(activePlan(players.dev)).toBeNull()

    // Esha's booked move onto it is cancelled; she stays where she is.
    expect(bookings(players.esha)[0]).toMatchObject({ status: "cancelled" })
    expect(openPlaces(players.esha).map((place) => place.seriesId)).toEqual([morning])
    expect(activePlan(players.esha)).toMatchObject({ agreedMonthlyFeePaise: 400_000, status: "active" })
  })

  it("notes a cancelled booking plainly on the record, not as a failure", () => {
    const esha = summaryOf(players.esha)
    expect(esha.failed).toBeNull()
    expect(esha.scheduled).toBeNull()
    expect(esha.note).toMatch(/^Booked move to Beginner · Weekday · .+ cancelled: that schedule was ended on 12 November 2026\.$/u)
    expect(summaryOf(players.dev).note).toMatch(/^Booked change of days or fee on Beginner · Weekday · .+ cancelled: that schedule was ended on 12 November 2026\.$/u)
  })

  it("stops a fee plan that was due to start next month when End schedule stops fees", () => {
    // The fee change made this month would have started in December.
    expect(plans(players.farhan)).toEqual([
      expect.objectContaining({ effectiveTo: "2026-11-30", status: "ended" }),
      expect.objectContaining({ agreedMonthlyFeePaise: 450_000, effectiveFrom: "2026-12-01", status: "paused" }),
    ])
    expect(activePlan(players.farhan)).toBeNull()
  })

  it("ends a finished schedule's places today, and Keep the fee plan keeps it", () => {
    expect(sessions.previewEndSessionSeries({ coachId, database, now, seriesId: finishedEarly }))
      .toMatchObject({ endsPlacesOn: "2026-11-12", termFinished: true, upcomingSessions: 0 })
    const result = sessions.endSessionSeriesRecords({
      coachId,
      database,
      now,
      seriesId: finishedEarly,
      stopFees: false,
    })

    expect(result).toMatchObject({ cancelledOccurrences: 0, endsPlacesOn: "2026-11-12", feesStopped: [] })
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, players.hari)).get()?.effectiveTo).toBe("2026-11-12")
    expect(enrollment(players.hari).status).toBe("paused")
    expect(activePlan(players.hari)).toMatchObject({ effectiveTo: null, status: "active" })
  })

  it("offers Stop fees for a kept fee plan, and Archive then works", () => {
    pay(players.hari, "2026-10")
    expect(archive(players.hari)).toMatchObject({
      code: "FINANCIAL_CLOSEOUT_REQUIRED",
      hasOpenFeePlan: true,
      ok: false,
    })

    // Still on a schedule: End training is the way, not Stop fees.
    expect(() => changes.stopFeePlan({ playerId: players.bala }, context()))
      .toThrow("This player is still on a schedule. Use End training, which stops fees too.")
    expect(changes.stopFeePlan({ playerId: players.hari }, context())).toEqual({ finalMonth: "2026-11" })
    expect(plans(players.hari)).toEqual([expect.objectContaining({ effectiveTo: "2026-11-30", status: "ended" })])
    expect(archive(players.hari)).toEqual({ memberId: players.hari, ok: true })
  })

  it("stops a fee change waiting for next month when End training stops fees, either way", () => {
    // "They have left already", with Stop fees.
    changeFee(players.isha, 450_000)
    changes.endTrainingNow({ playerId: players.isha, stopFees: true }, context())
    expect(plans(players.isha).map((plan) => [plan.effectiveTo, plan.status])).toEqual([
      ["2026-11-30", "ended"],
      [null, "paused"],
    ])

    // End training at the end of the month, with Stop fees, applied on the 1st.
    changeFee(players.jay, 450_000)
    changes.scheduleEndOfTraining({ playerId: players.jay, stopFees: true }, context())
    expect(summaryOf(players.jay).fee?.nextMonthFeePaise).toBeNull()

    // "Keep the fee plan", then Stop fees from the record.
    changeFee(players.kiran, 450_000)
    changes.endTrainingNow({ playerId: players.kiran, stopFees: false }, context())
    expect(activePlan(players.kiran)).toMatchObject({ effectiveFrom: "2026-12-01" })
    expect(changes.stopFeePlan({ playerId: players.kiran }, context())).toEqual({ finalMonth: "2026-11" })
    expect(activePlan(players.kiran)).toBeNull()
    expect(plans(players.kiran).at(-1)).toMatchObject({ effectiveFrom: "2026-12-01", status: "paused" })
  })

  it("cancels a fee change waiting for next month and puts the earlier fee back", () => {
    changeFee(players.lata, 450_000)
    const waiting = summaryOf(players.lata).fee?.waitingFeeChange
    expect(waiting).toMatchObject({ feePaise: 450_000, previousFeePaise: 400_000, startsOn: "2026-12-01" })
    // Offered only where a fee change is waiting.
    expect(summaryOf(players.esha).fee?.waitingFeeChange).toBeNull()
    // Start training's refusal points to that button, which is offered here.
    expect(() => changes.scheduleTrainingChange({
      ...fiveDay,
      monthlyFeePaise: 400_000,
      playerId: players.lata,
      seriesId: evening,
      weekdays: [1, 2, 3, 4, 5],
    }, context())).toThrow("A new fee already starts next month. Use Cancel this fee change under Monthly fee first, then change training.")

    expect(fees.cancelFeeChange({
      agreementId: waiting!.agreementId,
      expectedRevision: waiting!.revision,
      playerId: players.lata,
    }, context())).toEqual({ monthlyFeePaise: 400_000, startsOn: "2026-12-01" })
    expect(plans(players.lata).map((plan) => [plan.agreedMonthlyFeePaise, plan.effectiveTo, plan.status])).toEqual([
      [400_000, null, "active"],
      [450_000, null, "paused"],
    ])
    expect(summaryOf(players.lata).fee).toMatchObject({ nextMonthFeePaise: 400_000, waitingFeeChange: null })
    // It cannot be cancelled twice.
    expect(() => fees.cancelFeeChange({
      agreementId: waiting!.agreementId,
      expectedRevision: waiting!.revision,
      playerId: players.lata,
    }, context())).toThrow("There is no fee change waiting to start that can be cancelled.")
  })

  it("clears the red notice once the schedule is changed, and lets it be dismissed", () => {
    for (const playerId of [players.om, players.priya]) {
      database.insert(schema.trainingChanges).values({
        id: `failed-${playerId}`,
        playerAccountId: playerId,
        kind: "change",
        effectiveOn: "2026-11-01",
        status: "failed",
        failureReason: "Choose an active schedule.",
        createdByAccountId: coachId,
        createdAt: october,
        updatedAt: new Date("2026-11-01T05:00:00.000Z"),
        resolvedAt: new Date("2026-11-01T05:00:00.000Z"),
      }).run()
      expect(summaryOf(playerId).failed).toMatchObject({ reason: "Choose an active schedule." })
    }

    changes.changeScheduleThisMonth({
      ...fiveDay,
      monthlyFeePaise: null,
      playerId: players.om,
      seriesId: evening,
      startsOn: "2026-11-12",
      weekdays: [1, 2, 3, 4, 5],
    }, context())
    expect(summaryOf(players.om).failed).toBeNull()

    changes.dismissTrainingNotice({ playerId: players.priya }, context())
    expect(summaryOf(players.priya).failed).toBeNull()

    // The plain note goes once something new is booked, or when dismissed.
    changes.scheduleTrainingChange({
      ...fiveDay,
      monthlyFeePaise: 350_000,
      playerId: players.dev,
      seriesId: morning,
      weekdays: [1, 2, 3, 4, 5],
    }, context())
    expect(summaryOf(players.dev).note).toBeNull()
    changes.dismissTrainingNotice({ playerId: players.esha }, context())
    expect(summaryOf(players.esha).note).toBeNull()
  })

  it("issues December's fees only to players still on a schedule with a running fee plan", () => {
    // Nina is on a break with her fee plan kept, then her level changes.
    changes.endTrainingNow({ playerId: players.nina, stopFees: false }, context())
    database.update(schema.playerEnrollments).set({ level: "Intermediate" })
      .where(eq(schema.playerEnrollments.accountId, players.nina)).run()
    // On the 1st: Chitra's and Jay's booked ends and Dev's new start apply.
    // The bookings End schedule cancelled are not among them, so nothing fails.
    expect(changes.applyDueTrainingChanges({ database, now: firstDecember })).toEqual({ applied: 3, due: 3, retry: 0 })
    expect(database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.status, "failed")).all()
      .map((row) => row.playerAccountId).sort()).toEqual([players.om, players.priya].sort())

    // Jay's booked end applied on the 1st, so his December plan never bills.
    expect(plans(players.jay).map((plan) => [plan.effectiveTo, plan.status])).toEqual([
      ["2026-11-30", "ended"],
      [null, "paused"],
    ])

    const preview = finance.getCoachMonthlyPreparationPreview("2026-12", context(secondDecember))

    const prepared = finance.prepareMonthlyCharges({
      period: "2026-12",
      idempotencyKey: "prepare-december-closeout",
    }, context(secondDecember))
    expect(prepared.createdChargeIds).toHaveLength(preview.ready)
    const billed = database.select().from(schema.financialCharges)
      .where(eq(schema.financialCharges.billingPeriod, "2026-12")).all()
    const fee = (playerId: string) => billed.find((item) => item.playerAccountId === playerId)?.originalAmountPaise
    expect(new Set(billed.map((item) => item.playerAccountId))).toEqual(new Set([
      players.bala, players.dev, players.esha, players.lata, players.om, players.priya,
    ]))
    // The earlier fee after a cancelled fee change; Dev's new start at its own fee.
    expect(fee(players.lata)).toBe(400_000)
    expect(fee(players.dev)).toBe(350_000)
    // Stopped plans bill nothing, including the ones that were due to start in December.
    for (const playerId of [players.asha, players.farhan, players.isha, players.jay, players.kiran]) {
      expect(fee(playerId)).toBeUndefined()
    }
  })

  it("tells a repeat End schedule that it was already ended, and changes nothing", () => {
    const before = database.select().from(schema.trainingChanges).all()
    expect(sessions.endSessionSeriesRecords({
      coachId,
      database,
      now,
      seriesId: autumn,
      stopFees: true,
    })).toMatchObject({ alreadyEnded: true, takenOff: [] })
    expect(database.select().from(schema.trainingChanges).all()).toEqual(before)
  })

  it("keeps the note on a cancelled booking when the player's own schedule is ended later", () => {
    // 05:00 in India on 2 December, before either schedule's session.
    const earlyDecember = new Date("2026-12-01T23:30:00.000Z")
    addPlayer(players.quinn, "Quinn Dsouza", 9217, [winter])
    finance.createOrReplaceFeeAgreement({
      ...fiveDay,
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-12-01",
      idempotencyKey: `plan-${players.quinn}`,
      playerId: players.quinn,
    }, context(earlyDecember))
    changes.scheduleTrainingChange({
      ...fiveDay,
      monthlyFeePaise: 400_000,
      playerId: players.quinn,
      seriesId: spring,
      weekdays: [1, 2, 3, 4, 5],
    }, context(earlyDecember))

    sessions.endSessionSeriesRecords({ coachId, database, now: earlyDecember, seriesId: spring, stopFees: true })
    const note = summaryOf(players.quinn, earlyDecember).note
    expect(note).toMatch(/^Booked move to Beginner · Weekday · .+ cancelled: that schedule was ended on 2 December 2026\.$/u)

    // Ending Quinn's own schedule takes Quinn off, but the note stays until a
    // new booking or Dismiss.
    const result = sessions.endSessionSeriesRecords({
      coachId,
      database,
      now: earlyDecember,
      seriesId: winter,
      stopFees: true,
    })
    expect(result.takenOff.map((item) => item.fullName)).toEqual(["Quinn Dsouza"])
    expect(summaryOf(players.quinn, earlyDecember).note).toBe(note)
  })

  it("lets a withdrawal refund be recorded after a fee change was cancelled", () => {
    // Lata's December fee was issued on the earlier plan; the cancelled fee
    // change is paused and must not count as an overlapping plan.
    const midDecember = new Date("2026-12-16T05:00:00.000Z")
    const december = charge(players.lata, "2026-12")!
    const payment = finance.recordAllocatedPayment({
      allocations: [{ amountPaise: december.originalAmountPaise, chargeId: december.id, expectedChargeRevision: december.recordRevision }],
      amountPaise: december.originalAmountPaise,
      method: "cash",
      mutationId: mutationId(),
      playerId: players.lata,
      receivedOn: "2026-12-14",
    }, context(midDecember))
    // A withdrawal refund is recorded once the player's training has ended
    // (head coach, 13 Nov 2026): "They have left already", fees stopped.
    changes.endTrainingNow({ playerId: players.lata, stopFees: true }, context(midDecember))
    const preview = finance.previewRefundAllocations({
      amountPaise: 100_000,
      expectedPaymentRevision: 0,
      paymentId: payment.receipt.id,
      withdrawalEffectiveOn: "2026-12-15",
    }, context(midDecember))
    const allocation = preview.allocations[0]!
    const refund = finance.recordRefund({
      allocations: preview.allocations.map(({ amountPaise, paymentAllocationId }) => ({ amountPaise, paymentAllocationId })),
      amountPaise: 100_000,
      expectedAgreementRevision: allocation.expectedAgreementRevision,
      expectedChargeRevision: allocation.expectedChargeRevision,
      expectedPaymentRevision: 0,
      method: "cash",
      mutationId: mutationId(),
      paymentId: payment.receipt.id,
      refundedOn: "2026-12-16",
      withdrawalEffectiveOn: "2026-12-15",
    }, context(midDecember))
    expect(refund.reused).toBe(false)
  })

  it("cancels, with a note, a booking onto a schedule that had already ended, instead of failing it", () => {
    database.insert(schema.trainingChanges).values({
      id: `stale-${players.esha}`,
      playerAccountId: players.esha,
      kind: "change",
      effectiveOn: "2027-01-01",
      ...fiveDay,
      seriesId: finishedEarly,
      weekdays: "[1,2,3,4,5]",
      monthlyFeePaise: 400_000,
      createdByAccountId: coachId,
      createdAt: october,
      updatedAt: october,
    }).run()
    const firstJanuary = new Date("2027-01-01T05:00:00.000Z")
    expect(changes.applyDueTrainingChanges({ database, now: firstJanuary })).toEqual({ applied: 0, due: 1, retry: 0 })
    expect(bookings(players.esha).find((row) => row.id === `stale-${players.esha}`)).toMatchObject({ status: "cancelled" })
    const esha = summaryOf(players.esha, firstJanuary)
    expect(esha.failed).toBeNull()
    expect(esha.note).toMatch(/^Booked move to Beginner · Weekday · .+ cancelled: that schedule was ended\.$/u)
    expect(openPlaces(players.esha).map((place) => place.seriesId)).toEqual([morning])
  })

  it("does not point a new player whose first fee starts next month to a button they do not have", () => {
    addPlayer(players.roshan, "Roshan Kumar", 9218, [morning])
    database.update(schema.playerEnrollments).set({ trainingStartOn: "2026-12-01" })
      .where(eq(schema.playerEnrollments.accountId, players.roshan)).run()
    finance.createOrReplaceFeeAgreement({
      ...fiveDay,
      agreedMonthlyFeePaise: 400_000,
      effectiveFrom: "2026-12-01",
      idempotencyKey: `plan-${players.roshan}`,
      playerId: players.roshan,
    }, context())
    expect(summaryOf(players.roshan).fee?.waitingFeeChange).toBeNull()
    expect(() => changes.scheduleTrainingChange({
      ...fiveDay,
      monthlyFeePaise: 400_000,
      playerId: players.roshan,
      seriesId: evening,
      weekdays: [1, 2, 3, 4, 5],
    }, context())).toThrow("This player's fee plan only starts next month, so their training cannot be changed yet. Change it once next month has started.")

    // End training with Stop fees pauses the plan that had not started.
    changes.endTrainingNow({ playerId: players.roshan, stopFees: true }, context())
    expect(plans(players.roshan)).toEqual([expect.objectContaining({ effectiveFrom: "2026-12-01", status: "paused" })])
  })
})
