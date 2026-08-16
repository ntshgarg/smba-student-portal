import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-operational-players-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "academy.db")

describe("coach operational player projection", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let coachDatabase: typeof import("@/lib/coach/database")
  let sessionReadModels: typeof import("@/lib/coach/session-read-models")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    coachDatabase = await import("@/lib/coach/database")
    sessionReadModels = await import("@/lib/coach/session-read-models")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("excludes Academy IDs and private contact fields from operational routes", () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created")

    const registrationId = accountService.registerAccount("Projection Player", "player")
    const approved = accountService.approveRegistration(registrationId, coach.accountId)
    database.update(schema.playerEnrollments).set({
      primaryContactName: "GUARDIAN_SENTINEL_NAME",
      primaryContactRelationship: "Guardian",
      primaryContactPhone: "+91 99999 77777",
    }).where(eq(schema.playerEnrollments.accountId, registrationId)).run()

    const operational = coachDatabase.listOperationalPlayerRecords()
    const complete = coachDatabase.listApprovedPlayerRecords()
    const serializedOperational = JSON.stringify(operational)

    expect(serializedOperational).not.toContain("GUARDIAN_SENTINEL_NAME")
    expect(serializedOperational).not.toContain("+91 99999 77777")
    expect(serializedOperational).not.toContain("primaryContact")
    expect(serializedOperational).not.toContain("academyId")
    expect(operational.members).toContainEqual(expect.objectContaining({
      id: registrationId,
      fullName: "Projection Player",
    }))
    expect(complete.members).toContainEqual(expect.objectContaining({
      academyId: approved.academyId,
      primaryContact: {
        name: "GUARDIAN_SENTINEL_NAME",
        relationship: "Guardian",
        phone: "+91 99999 77777",
      },
    }))

    database.update(schema.accounts).set({
      archivedAt: new Date("2026-08-12T12:00:00+05:30"),
    }).where(eq(schema.accounts.id, registrationId)).run()

    expect(coachDatabase.listOperationalPlayerRecords().members)
      .not.toContainEqual(expect.objectContaining({ id: registrationId }))
    expect(coachDatabase.listAttendanceRegisterPlayerRecords().members)
      .toContainEqual(expect.objectContaining({
        id: registrationId,
        fullName: "Projection Player",
      }))
    expect(JSON.stringify(coachDatabase.listAttendanceRegisterPlayerRecords()))
      .not.toContain("GUARDIAN_SENTINEL_NAME")
  })

  it("retains an archived player's identity and saved result in the annual register", () => {
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created")
    const playerId = accountService.registerAccount("Archived Register Player", "player")
    accountService.approveRegistration(playerId, coach.accountId)
    const instant = new Date("2026-08-10T12:00:00+05:30")

    database.update(schema.playerEnrollments).set({
      academyPlan: "weekday-3-day",
      batch: "Weekday",
      joinedAt: new Date("2023-08-01T06:00:00+05:30"),
      level: "Beginner",
      status: "paused",
    }).where(eq(schema.playerEnrollments.accountId, playerId)).run()
    database.insert(schema.sessionSeries).values({
      id: "archived-register-series",
      title: "Archived register series",
      programme: "Beginner",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2023-08-01",
      endsOn: "2023-08-31",
      status: "ended",
      createdByAccountId: coach.accountId,
      createdAt: instant,
    }).run()
    database.insert(schema.sessionOccurrences).values({
      id: "archived-register-occurrence",
      seriesId: "archived-register-series",
      occurrenceDate: "2023-08-07",
      startsAt: new Date("2023-08-07T06:00:00+05:30"),
      durationMinutes: 60,
      venue: "SMBA Court",
      status: "scheduled",
      createdAt: instant,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: "archived-register-assignment",
      accountId: playerId,
      seriesId: "archived-register-series",
      effectiveFrom: "2023-08-01",
      effectiveTo: "2023-08-08",
      assignedByAccountId: coach.accountId,
      assignedAt: instant,
    }).run()
    database.insert(schema.sessionAssignmentWeekdays).values({
      id: "archived-register-weekday",
      assignmentId: "archived-register-assignment",
      weekday: 1,
    }).run()
    database.insert(schema.sessionAttendanceRecords).values({
      id: "archived-register-attendance",
      accountId: playerId,
      occurrenceId: "archived-register-occurrence",
      choice: "present",
      markedByAccountId: coach.accountId,
      createdAt: instant,
      updatedAt: instant,
    }).run()
    database.update(schema.accounts).set({ archivedAt: instant })
      .where(eq(schema.accounts.id, playerId)).run()

    const snapshot = sessionReadModels.getCoachAttendanceRegisterSnapshot({
      batch: "Weekday",
      programme: "Beginner",
      year: 2023,
    })

    expect(snapshot.members).toContainEqual(expect.objectContaining({
      id: playerId,
      fullName: "Archived Register Player",
    }))
    expect(snapshot.attendanceRecords["archived-register-occurrence"]?.[playerId])
      .toBe("present")
    expect(coachDatabase.listOperationalPlayerRecords().members)
      .not.toContainEqual(expect.objectContaining({ id: playerId }))
  })
})
