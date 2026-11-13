import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-onboarding-first-term-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * A new player's first schedule ends before onboarding's Fee Plan step is done
 * (head coach, 12 Nov 2026): by End schedule, by Members' End training, or by
 * the schedule's last day simply passing. The coach finishes onboarding with
 * that first term -- registration fee plus the months trained -- and then moves
 * or ends the player in Members. Before, the case fell back to the Session
 * step, where every date was refused and nothing on screen could clear it.
 *
 * Also here: the Members leftovers in the same audit group, on the same
 * academy (Thursday 12 November 2026).
 */
describe("onboarding when a first term ends, and the Members leftovers", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let accounts: typeof import("@/lib/auth/account-service")
  let coachData: typeof import("@/lib/coach/database")
  let onboarding: typeof import("@/lib/coach/onboarding-service")
  let sessions: typeof import("@/lib/sessions/service")
  let finance: typeof import("@/lib/finance/service")
  let changes: typeof import("@/lib/training/changes")
  let fees: typeof import("@/lib/training/fees")
  let members: typeof import("@/lib/coach/member-service")
  let domain: typeof import("@/lib/finance/domain")
  let coachId: string
  let autumn: string
  let doomed: string
  let finished: string
  let winter: string
  let thursdays: string

  const october = new Date("2026-10-05T05:00:00.000Z")
  // Thursday 12 November 2026, 10:30 in India.
  const now = new Date("2026-11-12T05:00:00.000Z")
  const today = "2026-11-12"
  const classification = { academyPlan: "weekday-3-day" as const, batch: "Weekday" as const, level: "Beginner" as const }
  const context = (at = now) => ({ coachId, database, now: at })

  function series(startTime: string, startsOn: string, endsOn: string, weekdays = [1, 3, 5]) {
    return sessions.createSessionSeriesRecords({
      coachId,
      database,
      now: october,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn,
        endsOn,
        weekdays,
        startTime,
        durationMinutes: 60,
      },
    })
  }

  function newPlayer(name: string) {
    const playerId = accounts.registerAccount(name, "player")
    accounts.approveRegistration(playerId, coachId, { now: october })
    onboarding.saveOnboardingAssessment({
      coachId,
      database,
      input: { ...classification, expectedRevision: 0, playerId },
      now: october,
    })
    return playerId
  }

  function assign(playerId: string, seriesId: string, effectiveFrom: string, at = now) {
    return sessions.assignSessionRecords({
      coachId,
      confirmTrainingStart: true,
      database,
      effectiveFrom,
      now: at,
      playerId,
      seriesId,
      weekdays: [1, 3, 5],
    })
  }

  function onboardingCase(playerId: string) {
    return coachData.getPlayerOnboardingWorkspace(today).cases.find((item) => item.id === playerId)
  }

  function occurrenceOn(seriesId: string, occurrenceDate: string) {
    const row = database.select().from(schema.sessionOccurrences).where(and(
      eq(schema.sessionOccurrences.seriesId, seriesId),
      eq(schema.sessionOccurrences.occurrenceDate, occurrenceDate),
    )).get()
    if (!row) throw new Error(`No session on ${occurrenceDate}.`)
    return row.id
  }

  function mark(playerId: string, occurrenceId: string, choice: "present" | "absent" | "cleared") {
    database.insert(schema.sessionAttendanceRecords).values({
      id: `mark-${playerId}-${occurrenceId}`,
      accountId: playerId,
      occurrenceId,
      choice,
      markedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  function places(playerId: string) {
    return database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, playerId)).all()
  }

  function plans(playerId: string) {
    return database.select().from(schema.feeAgreements)
      .where(eq(schema.feeAgreements.playerAccountId, playerId)).all()
  }

  function completeOnboarding(playerId: string) {
    const terms = { ...classification, agreedMonthlyFeePaise: 300_000, monthlyDueDay: 5, playerId }
    const preview = finance.previewPlayerOnboardingFinance(terms, context())
    const result = preview.blockers.length
      ? null
      : finance.completePlayerOnboardingFinance({ ...terms, previewFingerprint: preview.fingerprint }, context())
    return { preview, result }
  }

  function onboardedPlayer(name: string, seriesId: string, serial: number) {
    const playerId = `33000000-0000-4000-8000-${String(serial).padStart(12, "0")}`
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: name,
      normalizedName: name.toLowerCase(),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: october,
      createdAt: october,
      updatedAt: october,
    }).run()
    database.insert(schema.academyIdAllocations).values({ serial, accountId: playerId, createdAt: october }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      ...classification,
      status: "active",
      trainingStartOn: "2026-10-01",
      onboardingCompletedAt: october,
      updatedAt: october,
    }).run()
    const assignmentId = `assignment-${playerId}`
    database.insert(schema.sessionAssignments).values({
      id: assignmentId,
      accountId: playerId,
      seriesId,
      effectiveFrom: "2026-10-01",
      effectiveTo: null,
      assignedByAccountId: coachId,
      assignedAt: october,
    }).run()
    for (const weekday of [1, 3, 5]) {
      database.insert(schema.sessionAssignmentWeekdays).values({
        id: `${assignmentId}-${weekday}`,
        assignmentId,
        weekday,
      }).run()
    }
    finance.createOrReplaceFeeAgreement({
      ...classification,
      agreedMonthlyFeePaise: 300_000,
      effectiveFrom: "2026-10-01",
      idempotencyKey: `plan-${playerId}`,
      playerId,
    }, context(october))
    return playerId
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    accounts = await import("@/lib/auth/account-service")
    coachData = await import("@/lib/coach/database")
    onboarding = await import("@/lib/coach/onboarding-service")
    sessions = await import("@/lib/sessions/service")
    finance = await import("@/lib/finance/service")
    changes = await import("@/lib/training/changes")
    fees = await import("@/lib/training/fees")
    members = await import("@/lib/coach/member-service")
    domain = await import("@/lib/finance/domain")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accounts.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    autumn = series("06:00", "2026-10-01", "2027-03-31")
    doomed = series("07:00", "2026-10-01", "2027-03-31")
    finished = series("08:00", "2026-09-01", "2026-10-30")
    winter = series("09:00", "2026-10-01", "2027-03-31")
    thursdays = series("10:00", "2026-10-01", "2027-03-31", [1, 3, 4, 5])
    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-first-term" }, context(october))
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("finishes onboarding with a first schedule ended by End schedule, billing no month after it", () => {
    const asha = newPlayer("Asha First Term")
    assign(asha, doomed, "2026-11-02")
    mark(asha, occurrenceOn(doomed, "2026-11-02"), "present")
    expect(onboardingCase(asha)).toMatchObject({ stage: "feePlan", assignedSession: { standing: "running" } })

    sessions.endSessionSeriesRecords({ coachId, database, now, seriesId: doomed, stopFees: true })

    // The case stays at the Fee Plan step. It used to drop back to the
    // Session step, where no start date could pass.
    expect(onboardingCase(asha)).toMatchObject({
      assignedSession: { standing: "ended" },
      hasRecords: true,
      stage: "feePlan",
    })

    const { preview, result } = completeOnboarding(asha)
    expect(preview.blockers).toEqual([])
    expect(preview.feePlanEndsAfter).toBe("2026-11")
    expect(preview.lines.map((line) => [line.kind, line.period])).toEqual([
      ["registration", null],
      ["monthly_training", "2026-11"],
    ])
    // The weeks actually trained: 2, 4, 6, 9 and 11 November, out of the 13
    // Monday, Wednesday and Friday sessions November would have had. The
    // place's end used to shorten the month too (5 of 5, the whole fee).
    expect(preview.lines[1]).toMatchObject({
      amountPaise: domain.calculateProratedSessionFee(300_000, 5, 13),
      denominator: 13,
      numerator: 5,
    })
    expect(preview.warnings.join(" ")).toContain("stops after November 2026")
    expect(result?.registrationChargeId).toBeTruthy()
    // The plan stops after November, so nothing is left for archiving to wait on.
    expect(plans(asha)).toEqual([
      expect.objectContaining({ effectiveFrom: "2026-11-01", effectiveTo: "2026-11-30", status: "ended" }),
    ])
  })

  it("keeps the fee plan open when the first term only ran out by date", () => {
    const bala = newPlayer("Bala Finished Term")
    assign(bala, finished, "2026-09-07", new Date("2026-09-07T05:00:00.000Z"))

    // Last day 30 October, nobody pressed End schedule: Session is still done.
    expect(onboardingCase(bala)).toMatchObject({
      assignedSession: { endsOn: "2026-10-30", standing: "finished" },
      stage: "feePlan",
    })
    const { preview } = completeOnboarding(bala)
    expect(preview.blockers).toEqual([])
    expect(preview.feePlanEndsAfter).toBeNull()
    // September is before tracking; October billed; November has no session.
    expect(preview.lines.map((line) => [line.kind, line.period])).toEqual([
      ["registration", null],
      ["before_tracking", "2026-09"],
      ["monthly_training", "2026-10"],
    ])
  })

  it("lets a schedule ended before the first training day be cleared, or replaced by a later one", () => {
    const chitra = newPlayer("Chitra Never Started")
    assign(chitra, autumn, "2026-11-16")
    // End training "has left already", before the first day: the place covers
    // no day. Read inclusively, it used to count as one day of training.
    changes.endTrainingNow({ playerId: chitra, stopFees: true }, context())
    expect(places(chitra)[0]).toMatchObject({ effectiveFrom: "2026-11-16", effectiveTo: "2026-11-16" })
    expect(onboardingCase(chitra)).toMatchObject({
      assignedSession: { standing: "unusable" },
      hasRecords: false,
      stage: "session",
    })
    expect(completeOnboarding(chitra).preview.blockers)
      .toContain("Assign a matching session before completing fees.")

    // Nothing is recorded, so a later start on another schedule is allowed.
    // It used to be refused with "clear the existing assignment" and no way to.
    expect(() => assign(chitra, winter, "2026-11-23")).not.toThrow()
    expect(onboardingCase(chitra)).toMatchObject({ stage: "feePlan" })
  })

  it("refuses a later start only while marked days or a held place cover earlier days", () => {
    const dev = newPlayer("Dev Marked Days")
    assign(dev, autumn, "2026-11-02")
    // A Session step left open in another tab: the held place names its own button.
    expect(() => assign(dev, winter, "2026-11-09")).toThrow(/from 2 November 2026[^]*Clear this assignment/u)

    mark(dev, occurrenceOn(autumn, "2026-11-04"), "present")
    expect(() => assign(dev, winter, "2026-11-09"))
      .toThrow(/Attendance is already marked for this player from 4 November 2026[^]*Fee Plan step/u)
    expect(places(dev)).toHaveLength(1)
  })

  it("starts again when a mark was only ticked and unticked, and never points to the Calendar", () => {
    const esha = newPlayer("Esha Unticked")
    assign(esha, autumn, "2026-11-02")
    mark(esha, occurrenceOn(autumn, "2026-11-04"), "cleared")
    changes.scheduleEndOfTraining({ playerId: esha, stopFees: true }, context())

    // A "cleared" mark records nothing, so it no longer blocks the reset.
    expect(onboardingCase(esha)?.hasRecords).toBe(false)
    expect(onboarding.resetOnboardingSessionAssignment({ coachId, database, now, playerId: esha }))
      .toEqual({ playerId: esha, removedAssignments: 1 })
    // The End training booked for this schedule goes with it, so it cannot
    // later pause a player with no schedule.
    expect(database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.playerAccountId, esha)).all())
      .toEqual([expect.objectContaining({ status: "cancelled" })])

    const farhan = newPlayer("Farhan Marked")
    assign(farhan, autumn, "2026-11-02")
    mark(farhan, occurrenceOn(autumn, "2026-11-04"), "present")
    let message = ""
    try {
      onboarding.resetOnboardingSessionAssignment({ coachId, database, now, playerId: farhan })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("1 marked attendance")
    expect(message).toContain("Fee Plan step")
    expect(message).not.toContain("Calendar")
  })

  it("names the Session step when the classification is locked by an ended schedule", () => {
    const gita = newPlayer("Gita Ended Lock")
    assign(gita, autumn, "2026-11-16")
    changes.endTrainingNow({ playerId: gita, stopFees: true }, context())
    const revision = database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, gita)).get()!.recordRevision
    expect(() => onboarding.saveOnboardingAssessment({
      coachId,
      database,
      input: { ...classification, academyPlan: "weekday-5-day", expectedRevision: revision, playerId: gita },
      now,
    })).toThrow(/Use Start again on the Session step/u)
  })

  it("does not add a first schedule to a player whose onboarding is complete", () => {
    const hari = onboardedPlayer("Hari Completed", autumn, 9401)
    changes.endTrainingNow({ playerId: hari, stopFees: false }, context())
    expect(() => assign(hari, winter, "2026-11-16"))
      .toThrow(expect.objectContaining({ code: "CONFLICT" }))
    expect(places(hari)).toHaveLength(1)
  })

  it("keeps today's mark when a player who trained this morning has left already", () => {
    const isha = onboardedPlayer("Isha Left Today", thursdays, 9402)
    mark(isha, occurrenceOn(thursdays, today), "present")
    changes.endTrainingNow({ playerId: isha, stopFees: true }, context())
    // Ending on today took today off their record; the place ends after it now.
    expect(places(isha)[0]?.effectiveTo).toBe("2026-11-13")

    const jay = onboardedPlayer("Jay Left Unmarked", thursdays, 9403)
    changes.endTrainingNow({ playerId: jay, stopFees: true }, context())
    expect(places(jay)[0]?.effectiveTo).toBe(today)
  })

  it("lets this month be changed while an end of training waits, and refuses a fee change after it", () => {
    const kiran = onboardedPlayer("Kiran Ending", autumn, 9404)
    changes.scheduleEndOfTraining({ playerId: kiran, stopFees: true }, context())

    expect(() => fees.changeMonthlyFee({
      idempotencyKey: "fee-after-end",
      monthlyFeePaise: 350_000,
      playerId: kiran,
    }, context())).toThrow(/fees stop from/u)

    // Adjusting the rest of this month used to be refused until the planned
    // end was cancelled; the end still happens after this month.
    expect(changes.changeScheduleThisMonth({
      ...classification,
      monthlyFeePaise: null,
      playerId: kiran,
      seriesId: winter,
      startsOn: today,
      weekdays: [1, 3, 5],
    }, context())).toMatchObject({ startsOn: today })
    expect(database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.playerAccountId, kiran)).all())
      .toEqual([expect.objectContaining({ kind: "end", status: "scheduled" })])
  })

  it("keeps a booked change waiting after a passing fault instead of failing it for good", () => {
    const lata = onboardedPlayer("Lata Passing Fault", autumn, 9405)
    const { changeId } = changes.scheduleTrainingChange({
      ...classification,
      monthlyFeePaise: 300_000,
      playerId: lata,
      seriesId: winter,
      weekdays: [1, 3, 5],
    }, context())
    // Stands in for a dropped connection: an error that is not a refusal.
    database.update(schema.trainingChanges).set({ weekdays: "not a list" })
      .where(eq(schema.trainingChanges.id, changeId)).run()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    expect(changes.applyDueTrainingChanges({ database, now: new Date("2026-12-01T05:00:00.000Z") }))
      .toMatchObject({ retry: 1 })
    expect(database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.id, changeId)).get())
      .toMatchObject({ failureReason: null, status: "scheduled" })

    // Tried again for a couple of days, then shown: a fault that never goes
    // away used to keep the change silently waiting for good.
    expect(changes.applyDueTrainingChanges({ database, now: new Date("2026-12-03T05:00:00.000Z") }))
      .toMatchObject({ retry: 1 })
    expect(changes.applyDueTrainingChanges({ database, now: new Date("2026-12-04T05:00:00.000Z") }))
      .toMatchObject({ applied: 0, retry: 0 })
    expect(database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.id, changeId)).get())
      .toMatchObject({ failureReason: expect.stringContaining("Make the change again"), status: "failed" })
    consoleError.mockRestore()
  })

  it("charges an ended first term for the sessions trained, not the whole month", () => {
    const nina = newPlayer("Nina Left Early")
    assign(nina, autumn, "2026-11-02", new Date("2026-11-01T05:00:00.000Z"))
    // "They have left already" on Wednesday 4 November, before that day's
    // session was marked: the place covers Monday 2 November only.
    changes.endTrainingNow({ playerId: nina, stopFees: true }, context(new Date("2026-11-04T05:00:00.000Z")))

    const { preview } = completeOnboarding(nina)
    expect(preview.blockers).toEqual([])
    // It used to read "1 of 1 eligible sessions" and charge the full fee.
    expect(preview.lines[1]).toMatchObject({
      amountPaise: domain.calculateProratedSessionFee(300_000, 1, 13),
      denominator: 13,
      numerator: 1,
      period: "2026-11",
    })
  })

  it("stops the fee plan at an End training booked while onboarding was open", () => {
    const mira = newPlayer("Mira Booked End")
    assign(mira, autumn, "2026-11-02")
    // The End form offers no fees choice to a player with no fee plan.
    changes.scheduleEndOfTraining({ playerId: mira, stopFees: false }, context())
    expect(database.select().from(schema.trainingChanges)
      .where(eq(schema.trainingChanges.playerAccountId, mira)).get())
      .toMatchObject({ kind: "end", status: "scheduled", stopFees: true })

    const { preview, result } = completeOnboarding(mira)
    expect(preview.blockers).toEqual([])
    expect(preview.feePlanEndsAfter).toBe("2026-11")
    expect(preview.warnings.join(" ")).toContain("as booked in Members")
    expect(result?.registrationChargeId).toBeTruthy()
    expect(plans(mira)).toEqual([
      expect.objectContaining({ effectiveTo: "2026-11-30", status: "ended" }),
    ])

    // On the 1st the end happens and nothing is left open for Archive to wait on.
    changes.applyDueTrainingChanges({ database, now: new Date("2026-12-01T05:00:00.000Z") })
    expect(database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, mira)).get())
      .toMatchObject({ status: "paused" })
    expect(plans(mira)).toEqual([
      expect.objectContaining({ effectiveTo: "2026-11-30", status: "ended" }),
    ])
  })

  it("keeps Archive refused on the server while a start of training is booked", () => {
    const omar = onboardedPlayer("Omar Booked Start", autumn, 9406)
    changes.endTrainingNow({ playerId: omar, stopFees: true }, context())
    changes.scheduleTrainingChange({
      ...classification,
      monthlyFeePaise: 300_000,
      playerId: omar,
      seriesId: winter,
      weekdays: [1, 3, 5],
    }, context())
    const revision = database.select().from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, omar)).get()!.recordRevision
    expect(members.archiveMemberRecord({
      coachId,
      database,
      input: { expectedRevision: revision, memberId: omar },
      now,
    })).toMatchObject({ ok: false, message: expect.stringContaining("booked to start on 1 December 2026") })
  })
})
