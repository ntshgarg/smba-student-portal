import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-member-service-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

describe("member directory service", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let coachDatabase: typeof import("@/lib/coach/database")
  let memberService: typeof import("@/lib/coach/member-service")
  let sessionService: typeof import("@/lib/sessions/service")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-02T04:30:00.000Z"))
    accountService = await import("@/lib/auth/account-service")
    coachDatabase = await import("@/lib/coach/database")
    memberService = await import("@/lib/coach/member-service")
    sessionService = await import("@/lib/sessions/service")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
  })

  afterAll(() => {
    vi.useRealTimers()
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("validates, versions, archives and preserves immutable member history", () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    const legacyCoachRequestId = accountService.registerAccount("Legacy Coach Request", "coach")
    expect(() => accountService.approveRegistration(
      legacyCoachRequestId,
      coach.accountId,
      { requestedRole: "player" },
    )).toThrow("This registration has a different account role.")
    expect(database.select().from(schema.accounts)
      .where(eq(schema.accounts.id, legacyCoachRequestId)).get()?.approvalStatus).toBe("pending")
    const playerId = accountService.registerAccount("Mira Rao", "player")
    const secondPlayerId = accountService.registerAccount("Dev Shah", "player")
    const approved = accountService.approveRegistration(playerId, coach.accountId, {
      chooseAcademyIdIndex: () => 0,
    })
    const secondApproved = accountService.approveRegistration(secondPlayerId, coach.accountId, {
      chooseAcademyIdIndex: () => 0,
    })
    expect(approved.academyId).toBe("SMBA#0002")
    expect(secondApproved.academyId).toBe("SMBA#0003")

    const initial = coachDatabase.listApprovedPlayerRecords()
      .trainingProfiles.find((profile) => profile.memberId === playerId)
    expect(initial?.recordRevision).toBe(0)
    const initialTrainingStart = database.select({ value: schema.playerEnrollments.trainingStartOn })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.value
    if (!initialTrainingStart) throw new Error("The player training start date is unavailable.")
    expect(memberService.updateMemberRecord({
      coachId: coach.accountId,
      database,
      input: null as never,
    })).toMatchObject({ ok: false, code: "VALIDATION" })
    expect(memberService.archiveMemberRecord({
      coachId: coach.accountId,
      database,
      input: null as never,
    })).toMatchObject({ ok: false, code: "NOT_FOUND" })

    const validInput = {
      memberId: playerId,
      expectedRevision: 0,
      profile: {
        fullName: "  Mira   Rao ",
        trainingStartOn: "2026-07-15",
        primaryContact: {
          name: "  Asha   Rao ",
          relationship: "Parent",
          phone: "+91 98765 43210",
        },
      },
      training: {
        academyPlan: "weekday-3-day" as const,
        batch: "Weekday" as const,
        level: "Beginner" as const,
      },
    }
    const saved = memberService.updateMemberRecord({
      coachId: coach.accountId,
      database,
      input: validInput,
    })
    expect(saved).toMatchObject({
      ok: true,
      record: {
        member: {
          academyId: "SMBA#0002",
          fullName: "Mira Rao",
          primaryContact: { name: "Asha Rao" },
        },
        training: { recordRevision: 1, status: "unassigned" },
      },
    })
    expect(database.select({ value: schema.playerEnrollments.trainingStartOn })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.value)
      .toBe(initialTrainingStart)

    expect(memberService.updateMemberRecord({
      coachId: coach.accountId,
      database,
      input: validInput,
    })).toMatchObject({
      ok: false,
      code: "STALE_RECORD",
    })
    expect(memberService.updateMemberRecord({
      coachId: coach.accountId,
      database,
      input: {
        ...validInput,
        expectedRevision: 1,
        profile: null as never,
        training: null as never,
      },
    })).toMatchObject({ ok: false, code: "VALIDATION" })
    expect(memberService.updateMemberRecord({
      coachId: coach.accountId,
      database,
      input: {
        ...validInput,
        expectedRevision: 1,
        profile: {
          ...validInput.profile,
          primaryContact: { name: "", relationship: "Parent", phone: "123" },
        },
      },
    })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: {
        "primaryContact.name": expect.any(String),
        "primaryContact.phone": expect.any(String),
      },
    })

    const now = new Date()
    const seriesId = sessionService.createSessionSeriesRecords({
      coachId: coach.accountId,
      database,
      now,
      input: {
        programme: "Beginner",
        batch: "Weekday",
        venue: "SMBA Court",
        startsOn: initialTrainingStart,
        endsOn: "2026-09-30",
        weekdays: [1, 3, 5],
        startTime: "06:00",
        durationMinutes: 60,
      },
    })
    sessionService.assignSessionRecords({
      coachId: coach.accountId,
      database,
      effectiveFrom: initialTrainingStart,
      now,
      playerId,
      seriesId,
      weekdays: [1, 3, 5],
    })
    expect(database.select({ revision: schema.playerEnrollments.recordRevision })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.revision).toBe(2)

    database.update(schema.playerEnrollments).set({ status: "paused" })
      .where(eq(schema.playerEnrollments.accountId, playerId)).run()
    expect(coachDatabase.listApprovedPlayerRecords().trainingProfiles
      .find((profile) => profile.memberId === playerId)?.status).toBe("active")

    expect(memberService.updateMemberRecord({
      coachId: coach.accountId,
      database,
      input: {
        ...validInput,
        expectedRevision: 2,
        training: { ...validInput.training, level: "Intermediate" },
      },
    })).toMatchObject({ ok: false, code: "ACTIVE_ASSIGNMENTS" })
    expect(database.select({ value: schema.playerEnrollments.trainingStartOn })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.value)
      .toBe(initialTrainingStart)
    expect(memberService.archiveMemberRecord({
      coachId: coach.accountId,
      database,
      input: { memberId: playerId, expectedRevision: 2 },
    })).toMatchObject({ ok: false, code: "ACTIVE_ASSIGNMENTS" })

    const assignment = database.select().from(schema.sessionAssignments)
      .where(and(
        eq(schema.sessionAssignments.accountId, playerId),
        isNull(schema.sessionAssignments.effectiveTo),
      )).get()
    if (!assignment) throw new Error("Session assignment was not created.")
    sessionService.endSessionAssignment({
      assignmentId: assignment.id,
      coachId: coach.accountId,
      database,
      effectiveTo: "2026-08-02",
      now,
    })
    expect(database.select({ revision: schema.playerEnrollments.recordRevision })
      .from(schema.playerEnrollments)
      .where(eq(schema.playerEnrollments.accountId, playerId)).get()?.revision).toBe(3)

    database.update(schema.playerEnrollments).set({ status: "active" })
      .where(eq(schema.playerEnrollments.accountId, playerId)).run()
    expect(coachDatabase.listApprovedPlayerRecords().trainingProfiles
      .find((profile) => profile.memberId === playerId)?.status).toBe("paused")

    database.update(schema.authMethods).set({ revokedAt: now }).where(and(
      eq(schema.authMethods.accountId, secondPlayerId),
      isNull(schema.authMethods.revokedAt),
    )).run()
    const secondListed = coachDatabase.listApprovedPlayerRecords().members
      .find((member) => member.id === secondPlayerId)
    expect(secondListed?.academyId).toBe("SMBA#0003")

    const occurrence = database.select().from(schema.sessionOccurrences)
      .where(eq(schema.sessionOccurrences.seriesId, seriesId)).get()
    if (!occurrence) throw new Error("Session occurrence was not generated.")
    database.insert(schema.sessionAttendanceRecords).values({
      id: "member-archive-attendance",
      accountId: playerId,
      occurrenceId: occurrence.id,
      choice: "present",
      markedByAccountId: coach.accountId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.monthlyReports).values({
      id: "member-archive-report",
      accountId: playerId,
      month: "2026-07",
      draftText: "Historical feedback.",
      updatedByAccountId: coach.accountId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.authSessions).values({
      tokenHash: "member-active-session",
      accountId: playerId,
      expiresAt: new Date("2026-08-09T04:30:00.000Z"),
      createdAt: now,
    }).run()

    expect(memberService.archiveMemberRecord({
      coachId: coach.accountId,
      database,
      input: { memberId: playerId, expectedRevision: 2 },
    })).toMatchObject({ ok: false, code: "STALE_RECORD" })
    expect(memberService.archiveMemberRecord({
      coachId: coach.accountId,
      database,
      input: { memberId: playerId, expectedRevision: 3 },
    })).toEqual({ ok: true, memberId: playerId })

    expect(database.select().from(schema.accounts)
      .where(eq(schema.accounts.id, playerId)).get()?.archivedAt).toBeInstanceOf(Date)
    expect(database.select().from(schema.authMethods)
      .where(eq(schema.authMethods.accountId, playerId)).get()?.revokedAt).toBeInstanceOf(Date)
    expect(database.select().from(schema.authSessions)
      .where(eq(schema.authSessions.accountId, playerId)).all()).toHaveLength(0)
    expect(database.select().from(schema.authCredentialStates)
      .where(eq(schema.authCredentialStates.accountId, playerId)).get()?.status).toBe("revoked")
    expect(database.select().from(schema.authRuntimeSessions)
      .where(eq(schema.authRuntimeSessions.userId, playerId)).all()).toHaveLength(0)
    expect(database.select().from(schema.sessionAssignments)
      .where(eq(schema.sessionAssignments.accountId, playerId)).all()).toHaveLength(1)
    expect(database.select().from(schema.sessionAttendanceRecords)
      .where(eq(schema.sessionAttendanceRecords.accountId, playerId)).all()).toHaveLength(1)
    expect(database.select().from(schema.monthlyReports)
      .where(eq(schema.monthlyReports.accountId, playerId)).all()).toHaveLength(1)
    expect(coachDatabase.listApprovedPlayerRecords().members
      .some((member) => member.id === playerId)).toBe(false)
  })
})
