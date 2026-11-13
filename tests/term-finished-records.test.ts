import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-term-finished-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

/*
 * A schedule that simply runs out (12 Nov 2026). Nothing is written when its
 * last day passes; every read below works the finished term out from the
 * places the players still hold.
 */
describe("term-finished players across the coach's and the family's records", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")
  let coachDatabase: typeof import("@/lib/coach/database")
  let memberService: typeof import("@/lib/coach/member-service")
  let readModels: typeof import("@/lib/coach/session-read-models")
  let finance: typeof import("@/lib/finance/service")
  let summaries: typeof import("@/lib/training/member-summaries")
  let coachId: string
  let autumn: string
  let season: string

  // Monday 5 October 2026: both schedules are running and fee plans are set.
  const setupNow = new Date("2026-10-05T05:00:00.000Z")
  // Thursday 12 November 2026: the autumn schedule's last day (31 Oct) has passed.
  const laterNow = new Date("2026-11-12T05:00:00.000Z")
  const later = "2026-11-12"
  const players = {
    booked: "31000000-0000-4000-8000-0000000000c1",
    ending: "31000000-0000-4000-8000-0000000000c7",
    finished: "31000000-0000-4000-8000-0000000000c2",
    keptPlan: "31000000-0000-4000-8000-0000000000c3",
    mixed: "31000000-0000-4000-8000-0000000000c4",
    resting: "31000000-0000-4000-8000-0000000000c5",
    running: "31000000-0000-4000-8000-0000000000c6",
  }
  const fiveDay = { academyPlan: "weekday-5-day" as const, batch: "Weekday" as const, level: "Beginner" as const }
  const context = (at = setupNow) => ({ coachId, database, now: at })

  function addPlayer(id: string, name: string, serial: number, seriesIds: string[]) {
    database.insert(schema.accounts).values({
      id,
      fullName: name,
      normalizedName: name.toLowerCase(),
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: setupNow,
      createdAt: setupNow,
      updatedAt: setupNow,
    }).run()
    database.insert(schema.academyIdAllocations).values({ serial, accountId: id, createdAt: setupNow }).run()
    database.insert(schema.authMethods).values({
      id: `method-${id}`,
      accountId: id,
      method: "academy_id",
      identifier: `SMBA#${serial}`,
      createdAt: setupNow,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: id,
      ...fiveDay,
      status: "active",
      trainingStartOn: "2026-07-01",
      onboardingCompletedAt: setupNow,
      updatedAt: setupNow,
    }).run()
    seriesIds.forEach((seriesId) => {
      const assignmentId = `assignment-${id}-${seriesId}`
      database.insert(schema.sessionAssignments).values({
        id: assignmentId,
        accountId: id,
        seriesId,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        assignedByAccountId: coachId,
        assignedAt: setupNow,
      }).run()
      database.insert(schema.sessionAssignmentWeekdays).values({
        id: `${assignmentId}-1`,
        assignmentId,
        weekday: 1,
      }).run()
    })
  }

  function bookChange(playerId: string, kind: "change" | "end", seriesId: string | null) {
    database.insert(schema.trainingChanges).values({
      id: `change-${playerId}`,
      playerAccountId: playerId,
      kind,
      effectiveOn: "2026-12-01",
      status: "scheduled",
      ...(kind === "change" ? { ...fiveDay, monthlyFeePaise: 450_000, weekdays: "[1]" } : {}),
      seriesId,
      stopFees: false,
      createdByAccountId: coachId,
      createdAt: laterNow,
      updatedAt: laterNow,
    }).run()
  }

  beforeAll(async () => {
    schema = await import("@/lib/db/schema")
    coachDatabase = await import("@/lib/coach/database")
    memberService = await import("@/lib/coach/member-service")
    readModels = await import("@/lib/coach/session-read-models")
    finance = await import("@/lib/finance/service")
    summaries = await import("@/lib/training/member-summaries")
    const sessions = await import("@/lib/sessions/service")
    const accountService = await import("@/lib/auth/account-service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    coachId = coach.accountId

    const series = (startTime: string, endsOn: string) => sessions.createSessionSeriesRecords({
      coachId,
      database,
      now: setupNow,
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
    autumn = series("06:00", "2026-10-31")
    season = series("16:00", "2027-03-31")

    addPlayer(players.finished, "Asha Iyer", 9201, [autumn])
    addPlayer(players.mixed, "Bala Menon", 9202, [autumn, season])
    addPlayer(players.running, "Chitra Rao", 9203, [season])
    addPlayer(players.resting, "Dinesh Pai", 9204, [season])
    addPlayer(players.booked, "Ela Shah", 9205, [autumn])
    addPlayer(players.keptPlan, "Firoz Khan", 9206, [season])
    addPlayer(players.ending, "Gita Nair", 9207, [autumn])

    finance.activateFinance({ trackingMonth: "2026-10", idempotencyKey: "activate-term-finished" }, context())
    for (const playerId of Object.values(players)) {
      finance.createOrReplaceFeeAgreement({
        ...fiveDay,
        agreedMonthlyFeePaise: 400_000,
        effectiveFrom: "2026-07-01",
        idempotencyKey: `plan-${playerId}`,
        playerId,
      }, context())
    }

    // A player on a break with the fee plan kept: no open place at all.
    database.update(schema.sessionAssignments).set({ effectiveTo: "2026-10-05" })
      .where(eq(schema.sessionAssignments.accountId, players.resting)).run()
    database.update(schema.playerEnrollments).set({ status: "paused" })
      .where(eq(schema.playerEnrollments.accountId, players.resting)).run()

    bookChange(players.booked, "change", season)
    bookChange(players.keptPlan, "end", null)
    bookChange(players.ending, "end", null)
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  function profile(playerId: string, today: string) {
    return coachDatabase.listApprovedPlayerRecords(today).trainingProfiles
      .find((item) => item.memberId === playerId)
  }

  it("shows Members a term-finished player only once the last day has passed", () => {
    expect(profile(players.finished, "2026-10-31")).toMatchObject({
      status: "active",
      termFinishedOn: null,
    })
    expect(profile(players.finished, "2026-11-01")).toMatchObject({
      activeSessionIds: [autumn],
      status: "finished",
      termFinishedOn: "2026-10-31",
    })
    expect(profile(players.mixed, later)).toMatchObject({ status: "active", termFinishedOn: null })
    expect(profile(players.running, later)).toMatchObject({ status: "active", termFinishedOn: null })
    expect(profile(players.resting, later)).toMatchObject({
      activeSessionIds: [],
      status: "paused",
      termFinishedOn: null,
    })
    expect(coachDatabase.listOperationalPlayerRecords([players.finished], later).trainingProfiles)
      .toEqual([expect.objectContaining({ status: "finished", termFinishedOn: "2026-10-31" })])
  })

  it("keeps a term-finished player finished after a saved edit", () => {
    expect(memberService.readCanonicalPlayerRecord(database, players.finished, later)?.training)
      .toMatchObject({ status: "finished", termFinishedOn: "2026-10-31" })

    const current = memberService.readCanonicalPlayerRecord(database, players.finished, later)
    if (!current) throw new Error("The term-finished player was not found.")
    const saved = memberService.updateMemberRecord({
      coachId,
      database,
      input: {
        expectedRevision: current.training.recordRevision,
        memberId: players.finished,
        profile: { fullName: "Asha R Iyer", primaryContact: current.member.primaryContact },
        training: {
          academyPlan: current.training.academyPlan,
          batch: current.training.batch,
          level: current.training.level,
        },
      },
      now: laterNow,
    })
    expect(saved).toMatchObject({
      ok: true,
      record: { training: { status: "finished", termFinishedOn: "2026-10-31" } },
    })
  })

  it("says why next month has no fee instead of showing one that will never be issued", () => {
    const read = summaries.listMemberTrainingSummaries(Object.values(players), {
      database,
      now: laterNow,
    }).summaries
    expect(read[players.finished].fee).toMatchObject({ nextMonthFeePaise: 400_000, nextMonthNoFee: "term-finished" })
    expect(read[players.resting].fee).toMatchObject({ nextMonthNoFee: "no-schedule" })
    // A booked end takes them off on the 1st, even with the fee plan kept.
    expect(read[players.keptPlan].fee).toMatchObject({ nextMonthNoFee: "no-schedule" })
    expect(read[players.running].fee).toMatchObject({ nextMonthFeePaise: 400_000, nextMonthNoFee: null })
    expect(read[players.mixed].fee).toMatchObject({ nextMonthNoFee: null })
    // A move already booked for the 1st gives them a place, and its fee, next month.
    expect(read[players.booked].fee).toMatchObject({ nextMonthFeePaise: 450_000, nextMonthNoFee: null })

    // Before the last day, a schedule that stops this month still leaves next month without a fee.
    const october = summaries.listMemberTrainingSummaries([players.finished], {
      database,
      now: setupNow,
    }).summaries
    expect(october[players.finished].fee).toMatchObject({ nextMonthNoFee: "schedule-ends" })
  })

  it("counts only the term-finished players with nothing booked as the head coach's to-do", () => {
    const profiles = coachDatabase.listApprovedPlayerRecords(later).trainingProfiles
    // Ela's move and Gita's end are booked for 1 December: both are still
    // "Term finished" until then, but neither is left to move.
    expect(profiles.find((item) => item.memberId === players.booked)?.status).toBe("finished")
    expect(profiles.find((item) => item.memberId === players.ending)?.status).toBe("finished")
    expect(summaries.listTermFinishedPlayersToMove(profiles, { database })).toEqual([players.finished])

    // Someone still in Player onboarding cannot be moved yet, so is not counted.
    const onboarding = (completedAt: Date | null) => database.update(schema.playerEnrollments)
      .set({ onboardingCompletedAt: completedAt })
      .where(eq(schema.playerEnrollments.accountId, players.finished))
      .run()
    onboarding(null)
    expect(summaries.listTermFinishedPlayersToMove(profiles, { database })).toEqual([])
    onboarding(setupNow)

    // Members reads the same booked changes for its "Term finished" filter.
    const read = summaries.listMemberTrainingSummaries([players.booked, players.ending, players.finished], {
      database,
      now: laterNow,
    }).summaries
    expect(read[players.booked].scheduled?.kind).toBe("change")
    expect(read[players.ending].scheduled?.kind).toBe("end")
    expect(read[players.finished].scheduled).toBeNull()
  })

  it("bills a booked move's month instead of calling it a month with no fee", () => {
    expect(finance.getPlayerFeeRecord(players.booked, { database, now: laterNow })).toMatchObject({
      termFeeResumesOn: "2026-12-01",
      termFinishedOn: "2026-10-31",
    })
    // A booked end gives no month back: there is no fee after the term.
    expect(finance.getPlayerFeeRecord(players.ending, { database, now: laterNow })).toMatchObject({
      termFeeResumesOn: null,
      termFinishedOn: "2026-10-31",
    })
    // A running player's booked change is not about a finished term at all.
    expect(finance.getPlayerFeeRecord(players.keptPlan, { database, now: laterNow })).toMatchObject({
      termFeeResumesOn: null,
      termFinishedOn: null,
    })
  })

  it("carries the finished term to the player's fee record", () => {
    expect(finance.getPlayerFeeRecord(players.finished, { database, now: laterNow })?.termFinishedOn)
      .toBe("2026-10-31")
    expect(finance.getPlayerFeeRecord(players.finished, { database, now: laterNow })?.termFeeResumesOn)
      .toBeNull()
    expect(finance.getPlayerFeeRecord(players.running, { database, now: laterNow })?.termFinishedOn)
      .toBeNull()
    expect(finance.getPlayerFeeRecord(players.finished, { database, now: setupNow })?.termFinishedOn)
      .toBeNull()
  })

  it("tells the player their term finished", async () => {
    const { SqlitePortalRepository } = await import("@/lib/data/sqlite-portal-repository")
    vi.useFakeTimers()
    vi.setSystemTime(laterNow)
    try {
      const repository = new SqlitePortalRepository()
      expect(await repository.getPlayer(players.finished)).toMatchObject({
        status: "active",
        termFinishedOn: "2026-10-31",
      })
      expect(await repository.getPlayer(players.mixed)).toMatchObject({ termFinishedOn: null })
      // What the head coach has booked is what the family is told.
      expect(await repository.getPlayer(players.booked)).toMatchObject({
        nextScheduleStartsOn: "2026-12-01",
        trainingEndsOn: null,
      })
      expect(await repository.getPlayer(players.ending)).toMatchObject({
        nextScheduleStartsOn: null,
        trainingEndsOn: "2026-12-01",
      })
      // A paused player has no open place, but a booked return still counts.
      expect(await repository.getPlayer(players.resting)).toMatchObject({ nextScheduleStartsOn: null })
      bookChange(players.resting, "change", season)
      expect(await repository.getPlayer(players.resting)).toMatchObject({
        nextScheduleStartsOn: "2026-12-01",
        status: "paused",
        trainingEndsOn: null,
      })
    } finally {
      database.delete(schema.trainingChanges)
        .where(eq(schema.trainingChanges.playerAccountId, players.resting)).run()
      vi.useRealTimers()
    }
  })

  it("leaves a finished term's players out of the next year's register", () => {
    const selection = { batch: "Weekday" as const, programme: "Beginner" as const }
    const rows = (year: number) => readModels.getCoachAttendanceRegisterSnapshot({ ...selection, year })
      .sessionAssignments.map((assignment) => `${assignment.playerId}:${assignment.seriesId}`)

    const nextYear = rows(2027)
    expect(nextYear).toContain(`${players.running}:${season}`)
    expect(nextYear).toContain(`${players.mixed}:${season}`)
    expect(nextYear).not.toContain(`${players.finished}:${autumn}`)
    expect(nextYear).not.toContain(`${players.mixed}:${autumn}`)

    const thisYear = rows(2026)
    expect(thisYear).toContain(`${players.finished}:${autumn}`)
    expect(thisYear).toContain(`${players.mixed}:${autumn}`)
  })
})
