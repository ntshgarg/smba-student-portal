import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-training-changes-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("training changes from the player's record", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let changes: typeof import("@/lib/training/changes")
  let finance: typeof import("@/lib/finance/service")
  let coachId: string
  let morning: string
  let evening: string

  // Monday 5 October 2026, mid-morning in India.
  const now = new Date("2026-10-05T05:00:00.000Z")
  const players = {
    aarav: "20000000-0000-4000-8000-0000000000a1",
    meera: "20000000-0000-4000-8000-0000000000a2",
    ravi: "20000000-0000-4000-8000-0000000000a3",
    sana: "20000000-0000-4000-8000-0000000000a4",
  }

  function addPlayer(id: string, name: string, serial: number, trainingStartOn: string) {
    database.insert(schema.accounts).values({
      id,
      fullName: name,
      normalizedName: name.toLowerCase(),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({ serial, accountId: id, createdAt: now }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      level: "Beginner",
      batch: "Weekday",
      academyPlan: "weekday-5-day",
      status: "active",
      trainingStartOn,
      onboardingCompletedAt: now,
      updatedAt: now,
    }).run()
  }

  function assign(playerId: string, seriesId: string, effectiveFrom: string, weekdays: number[]) {
    const assignmentId = `assignment-${playerId}-${effectiveFrom}`
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      seriesId,
      effectiveFrom,
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
    weekdays.forEach((weekday) => database.insert(schema.sessionAssignmentWeekdays).values({
      id: `${assignmentId}-${weekday}`,
      assignmentId,
      weekday,
    }).run())
  }

  function mark(playerId: string, seriesId: string, date: string, choice: "present" | "absent") {
    const occurrence = database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.seriesId, seriesId),
      eq(schema.sessionOccurrences.occurrenceDate, date),
    )).get()
    if (!occurrence) throw new Error(`No session on ${date}`)
    database.insert(schema.sessionAttendanceRecords).values({
      id: `mark-${playerId}-${date}`,
      accountId: playerId,
      occurrenceId: occurrence.id,
      choice,
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  function openAssignments(playerId: string) {
    return database.select().from(schema.sessionAssignments).where(and(
      eq(schema.sessionAssignments.accountId, playerId),
      isNull(schema.sessionAssignments.effectiveTo),
    )).all()
  }

  function enrollment(playerId: string) {
    return database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()
  }

  function agreements(playerId: string) {
    return database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()
      .sort((first, second) => first.effectiveFrom.localeCompare(second.effectiveFrom))
  }

  const context = () => ({ coachId, database, now })
  const threeDayEvenings = {
    academyPlan: "weekday-3-day" as const,
    batch: "Weekday" as const,
    level: "Beginner" as const,
    weekdays: [1, 3, 5],
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    changes = await import("@/lib/training/changes")
    finance = await import("@/lib/finance/service")
    const accountService = await import("@/lib/auth/account-service")
    const { createSessionSeriesRecords } = await import("@/lib/sessions/service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    const series = (startTime: string) => createSessionSeriesRecords({
      coachId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: "2026-07-01",
        endsOn: "2027-03-31",
        weekdays: [1, 2, 3, 4, 5],
        startTime,
        durationMinutes: 60,
      },
    })
    morning = series("06:00")
    evening = series("16:00")

    addPlayer(players.aarav, "Aarav Bhat", 9001, "2026-07-01")
    addPlayer(players.meera, "Meera Iyer", 9002, "2026-10-01")
    addPlayer(players.ravi, "Ravi Kumar", 9003, "2026-07-01")
    addPlayer(players.sana, "Sana Shah", 9004, "2026-07-01")
    assign(players.aarav, morning, "2026-07-01", [1, 2, 3, 4, 5])
    assign(players.meera, morning, "2026-10-01", [1, 2, 3, 4, 5])
    assign(players.ravi, morning, "2026-07-01", [1, 2, 3, 4, 5])
    assign(players.sana, morning, "2026-07-01", [1, 2, 3, 4, 5])

    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-training-changes" }, context())
    for (const [playerId, from] of [
      [players.aarav, "2026-07-01"],
      [players.meera, "2026-10-01"],
      [players.ravi, "2026-07-01"],
      [players.sana, "2026-07-01"],
    ]) {
      finance.createOrReplaceFeeAgreement({
        academyPlan: "weekday-5-day",
        agreedMonthlyFeePaise: 400_000,
        batch: "Weekday",
        effectiveFrom: from,
        idempotencyKey: `plan-${playerId}`,
        level: "Beginner",
        playerId,
      }, context())
    }
    finance.prepareMonthlyCharges({ period: "2026-10", idempotencyKey: "prepare-october" }, context())

    mark(players.meera, morning, "2026-10-01", "present")
    mark(players.meera, morning, "2026-10-02", "present")
    mark(players.meera, morning, "2026-10-05", "absent")
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("schedules a change for the 1st of next month and changes nothing today", () => {
    const result = changes.scheduleTrainingChange({
      ...threeDayEvenings,
      monthlyFeePaise: 250_000,
      playerId: players.aarav,
      seriesId: evening,
    }, context())
    expect(result.effectiveOn).toBe("2026-11-01")
    expect(enrollment(players.aarav)?.academyPlan).toBe("weekday-5-day")
    expect(openAssignments(players.aarav).map((item) => item.seriesId)).toEqual([morning])
  })

  it("does not issue next month's fee at the old price while the change is waiting", () => {
    const preview = finance.getCoachMonthlyPreparationPreview("2026-11", {
      coachId,
      database,
      now: new Date("2026-10-20T05:00:00.000Z"),
    })
    // Meera, Ravi and Sana are ready for November; Aarav waits for his change.
    expect(preview.ready).toBe(3)
  })

  it("applies the change on or after the 1st, dated the 1st, all in one go", () => {
    expect(changes.applyDueTrainingChanges({ database, now: new Date("2026-10-31T05:00:00.000Z") }))
      .toEqual({ applied: 0, due: 0 })
    expect(changes.applyDueTrainingChanges({ database, now: new Date("2026-11-03T05:00:00.000Z") }))
      .toEqual({ applied: 1, due: 1 })

    const all = database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, players.aarav)).all()
    expect(all.find((item) => item.seriesId === morning)?.effectiveTo).toBe("2026-11-01")
    const [next] = openAssignments(players.aarav)
    expect(next).toMatchObject({ seriesId: evening, effectiveFrom: "2026-11-01" })
    expect(enrollment(players.aarav)).toMatchObject({ academyPlan: "weekday-3-day", status: "active" })
    const plans = agreements(players.aarav)
    expect(plans.map((plan) => [plan.effectiveFrom, plan.effectiveTo, plan.agreedMonthlyFeePaise, plan.academyPlan]))
      .toEqual([
        ["2026-07-01", "2026-10-31", 400_000, "weekday-5-day"],
        ["2026-11-01", null, 250_000, "weekday-3-day"],
      ])
  })

  it("lets the coach cancel a waiting change", () => {
    const { changeId } = changes.scheduleEndOfTraining({ playerId: players.ravi, stopFees: true }, context())
    changes.cancelTrainingChange({ changeId }, context())
    expect(changes.applyDueTrainingChanges({ database, now: new Date("2026-11-03T05:00:00.000Z") }).due).toBe(0)
    expect(openAssignments(players.ravi)).toHaveLength(1)
  })

  it("refuses a schedule that does not fit the plan or the level", () => {
    expect(() => changes.scheduleTrainingChange({
      ...threeDayEvenings,
      monthlyFeePaise: 250_000,
      playerId: players.ravi,
      seriesId: evening,
      weekdays: [1, 2],
    }, context())).toThrowError(/exactly 3 training days/u)
    expect(() => changes.scheduleTrainingChange({
      ...threeDayEvenings,
      level: "Adult",
      monthlyFeePaise: 250_000,
      playerId: players.ravi,
      seriesId: evening,
    }, context())).toThrow()
  })

  it("changes the schedule from the 1st of this month: clears its marks, starts the right one, fixes the unpaid fee", () => {
    const before = database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, players.meera),
      eq(schema.financialCharges.billingPeriod, "2026-10"),
    )).get()
    expect(before).toBeTruthy()

    const result = changes.changeScheduleThisMonth({
      ...threeDayEvenings,
      monthlyFeePaise: 250_000,
      playerId: players.meera,
      seriesId: morning,
      startsOn: "2026-10-01",
    }, context())

    expect(result.startsOn).toBe("2026-10-01")
    expect(result.clearedMarks.map((item) => item.occurrenceDate))
      .toEqual(["2026-10-01", "2026-10-02", "2026-10-05"])
    const marks = database.select().from(schema.sessionAttendanceRecords)
      .where(eq(schema.sessionAttendanceRecords.accountId, players.meera)).all()
    expect(marks.every((item) => item.choice === "cleared")).toBe(true)

    const all = database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, players.meera)).all()
    const wrong = all.find((item) => item.effectiveTo !== null)
    expect(wrong).toMatchObject({ effectiveFrom: "2026-10-01", effectiveTo: "2026-10-01" })
    expect(openAssignments(players.meera)[0]).toMatchObject({ effectiveFrom: "2026-10-01", seriesId: morning })
    expect(enrollment(players.meera)?.academyPlan).toBe("weekday-3-day")

    // The plan began this month, so it is corrected in place.
    const plans = agreements(players.meera)
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ academyPlan: "weekday-3-day", agreedMonthlyFeePaise: 250_000 })
    const expected = before!.originalAmountPaise - Math.round(before!.originalAmountPaise * 250_000 / 400_000)
    expect(result.adjustment).toEqual({ amountPaise: expected, kind: "manual_credit" })
  })

  it("will not change this month while a change is waiting for next month", () => {
    changes.scheduleTrainingChange({
      ...threeDayEvenings,
      monthlyFeePaise: 250_000,
      playerId: players.sana,
      seriesId: evening,
    }, context())
    expect(() => changes.changeScheduleThisMonth({
      ...threeDayEvenings,
      monthlyFeePaise: 250_000,
      playerId: players.sana,
      seriesId: morning,
      startsOn: "2026-10-01",
    }, context())).toThrowError(/waiting for next month/u)
  })

  it("once this month's fee is paid, allows only a change of session time from a date this month", () => {
    const charge = database.select().from(schema.financialCharges).where(and(
      eq(schema.financialCharges.playerAccountId, players.aarav),
      eq(schema.financialCharges.billingPeriod, "2026-10"),
    )).get()!
    finance.recordPayment({
      amountPaise: 100_000,
      chargeId: charge.id,
      expectedChargeRevision: charge.recordRevision,
      idempotencyKey: "aarav-october-part-payment",
      method: "cash",
      receivedOn: "2026-10-03",
    }, context())
    mark(players.aarav, morning, "2026-10-02", "present")
    mark(players.aarav, morning, "2026-10-05", "present")

    // Aarav's 3-day evening change happened on 1 Nov in an earlier test, so
    // look back at October from inside October for these checks.
    const october = { coachId, database, now }
    database.update(schema.sessionAssignments).set({ effectiveTo: null })
      .where(and(eq(schema.sessionAssignments.accountId, players.aarav), eq(schema.sessionAssignments.seriesId, morning))).run()
    database.delete(schema.sessionAssignmentWeekdays).where(eq(
      schema.sessionAssignmentWeekdays.assignmentId,
      openAssignments(players.aarav).find((item) => item.seriesId === evening)!.id,
    )).run()
    database.delete(schema.sessionAssignments).where(and(
      eq(schema.sessionAssignments.accountId, players.aarav),
      eq(schema.sessionAssignments.seriesId, evening),
    )).run()
    database.update(schema.playerEnrollments).set({ academyPlan: "weekday-5-day" })
      .where(eq(schema.playerEnrollments.accountId, players.aarav)).run()

    expect(() => changes.changeScheduleThisMonth({
      ...threeDayEvenings,
      monthlyFeePaise: 250_000,
      playerId: players.aarav,
      seriesId: evening,
      startsOn: "2026-10-05",
    }, october)).toThrowError(/already been paid/u)

    const result = changes.changeScheduleThisMonth({
      academyPlan: "weekday-5-day",
      batch: "Weekday",
      level: "Beginner",
      monthlyFeePaise: null,
      playerId: players.aarav,
      seriesId: evening,
      startsOn: "2026-10-05",
      weekdays: [1, 2, 3, 4, 5],
    }, october)
    // Only the mark on or after the start date is cleared; 2 Oct stays.
    expect(result.clearedMarks.map((item) => item.occurrenceDate)).toEqual(["2026-10-05"])
    expect(result.adjustment).toBeNull()
    expect(openAssignments(players.aarav)[0]).toMatchObject({ effectiveFrom: "2026-10-05", seriesId: evening })
  })

  it("ends training today when the player has already left, and stops the fees after this month", () => {
    changes.endTrainingNow({ playerId: players.ravi, stopFees: true }, context())
    expect(openAssignments(players.ravi)).toHaveLength(0)
    const ended = database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, players.ravi)).get()
    expect(ended?.effectiveTo).toBe("2026-10-05")
    expect(enrollment(players.ravi)?.status).toBe("paused")
    expect(agreements(players.ravi)[0]).toMatchObject({ effectiveTo: "2026-10-31", status: "ended" })
  })

  it("ends training at the end of the month when scheduled, and stops the fees", () => {
    changes.cancelTrainingChange({
      changeId: database.select().from(schema.trainingChanges).where(and(
        eq(schema.trainingChanges.playerAccountId, players.sana),
        eq(schema.trainingChanges.status, "scheduled"),
      )).get()!.id,
    }, context())
    changes.scheduleEndOfTraining({ playerId: players.sana, stopFees: true }, context())
    expect(enrollment(players.sana)?.status).toBe("active")
    changes.applyDueTrainingChanges({ database, now: new Date("2026-11-02T05:00:00.000Z") })
    expect(enrollment(players.sana)?.status).toBe("paused")
    const all = database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, players.sana)).all()
    expect(all[0]?.effectiveTo).toBe("2026-11-01")
    expect(agreements(players.sana)[0]).toMatchObject({ effectiveTo: "2026-10-31", status: "ended" })
  })
})
