import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  getCoachAccessProfile,
  requireHeadAdminAccess,
  requireJuniorCoachAccess,
} from "@/lib/auth/coach-access"
import {
  getStaffAttendanceSummary,
  listJuniorCoachProfiles,
  listStaffAttendanceRecords,
  saveStaffAttendanceRecords,
} from "@/lib/coach/staff-attendance"
import * as memberService from "@/lib/coach/member-service"
import type { SmbaDatabase } from "@/lib/db/client"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"
import * as attendanceAdjustments from "@/lib/attendance/adjustments"
import * as reportService from "@/lib/reports/service"
import * as sessionService from "@/lib/sessions/service"

const HEAD_COACH_ID = INITIAL_COACH_ACCOUNT_ID
const FIRST_JUNIOR_ID = "00000000-0000-4000-8000-000000000010"
const SECOND_JUNIOR_ID = "00000000-0000-4000-8000-000000000011"

let sqlite: Database.Database
let database: SmbaDatabase

function addCoach(input: {
  accountId: string
  academyIdSerial: number
  accessLevel: "head_admin" | "junior_coach"
  fullName: string
  joinedOn: string
}) {
  const instant = new Date(`${input.joinedOn}T06:30:00.000Z`)
  database.insert(schema.accounts).values({
    id: input.accountId,
    fullName: input.fullName,
    normalizedName: input.fullName.toLocaleLowerCase("en-IN"),
    requestedRole: "coach",
    role: "coach",
    approvalStatus: "approved",
    approvedAt: instant,
    approvedByAccountId: HEAD_COACH_ID,
    createdAt: instant,
    updatedAt: instant,
  }).run()
  database.insert(schema.academyIdAllocations).values({
    serial: input.academyIdSerial,
    accountId: input.accountId,
    createdAt: instant,
  }).run()
  database.insert(schema.coachProfiles).values({
    accountId: input.accountId,
    accessLevel: input.accessLevel,
    joinedOn: input.joinedOn,
    createdAt: instant,
    updatedAt: instant,
  }).run()
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
  addCoach({
    accountId: FIRST_JUNIOR_ID,
    academyIdSerial: 2,
    accessLevel: "junior_coach",
    fullName: "Arun Kumar",
    joinedOn: "2026-08-01",
  })
  addCoach({
    accountId: SECOND_JUNIOR_ID,
    academyIdSerial: 3,
    accessLevel: "junior_coach",
    fullName: "Meera Nair",
    joinedOn: "2026-08-03",
  })
})

afterEach(() => {
  sqlite.close()
})

describe("coach access profiles", () => {
  it("seeds Sathiya as the head admin and resolves typed junior profiles", () => {
    expect(getCoachAccessProfile(HEAD_COACH_ID, { database })).toMatchObject({
      academyId: "SMBA#0001",
      accessLevel: "head_admin",
      fullName: "Sathiya Moorthy",
    })
    expect(requireHeadAdminAccess(HEAD_COACH_ID, { database }).accountId)
      .toBe(HEAD_COACH_ID)
    expect(requireJuniorCoachAccess(FIRST_JUNIOR_ID, { database })).toMatchObject({
      academyId: "SMBA#0002",
      accessLevel: "junior_coach",
      firstName: "Arun",
      initials: "AK",
      joinedOn: "2026-08-01",
    })
    expect(() => requireHeadAdminAccess(FIRST_JUNIOR_ID, { database }))
      .toThrow("Head coach access")
    expect(() => requireJuniorCoachAccess(HEAD_COACH_ID, { database }))
      .toThrow("Junior coach access")
  })

  it("lists active juniors for the head only and rejects non-coach profiles", () => {
    expect(listJuniorCoachProfiles({
      database,
      requesterAccountId: HEAD_COACH_ID,
    }).map(({ academyId, fullName }) => ({ academyId, fullName }))).toEqual([
      { academyId: "SMBA#0002", fullName: "Arun Kumar" },
      { academyId: "SMBA#0003", fullName: "Meera Nair" },
    ])
    expect(() => listJuniorCoachProfiles({
      database,
      requesterAccountId: FIRST_JUNIOR_ID,
    })).toThrow("Head coach access")

    const instant = new Date("2026-08-01T00:00:00.000Z")
    database.insert(schema.accounts).values({
      id: "profiled-player",
      fullName: "Profiled Player",
      normalizedName: "profiled player",
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: instant,
      createdAt: instant,
      updatedAt: instant,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: 4,
      accountId: "profiled-player",
      createdAt: instant,
    }).run()
    database.insert(schema.coachProfiles).values({
      accountId: "profiled-player",
      accessLevel: "junior_coach",
      joinedOn: "2026-08-01",
      createdAt: instant,
      updatedAt: instant,
    }).run()
    expect(getCoachAccessProfile("profiled-player", { database })).toBeNull()

    database.update(schema.accounts).set({ archivedAt: instant })
      .where(eq(schema.accounts.id, SECOND_JUNIOR_ID)).run()
    expect(getCoachAccessProfile(SECOND_JUNIOR_ID, { database })).toBeNull()
  })

  it("rejects junior coaches at every head-only non-finance mutation boundary", () => {
    const denied = "Head coach access"
    const now = new Date("2026-08-08T06:30:00.000Z")

    expect(() => memberService.updateMemberRecord({
      coachId: FIRST_JUNIOR_ID,
      database,
      input: null as never,
      now,
    })).toThrow(denied)
    expect(() => memberService.archiveMemberRecord({
      coachId: FIRST_JUNIOR_ID,
      database,
      input: null as never,
      now,
    })).toThrow(denied)

    expect(() => sessionService.createSessionSeriesRecords({
      coachId: FIRST_JUNIOR_ID,
      database,
      input: null as never,
      now,
    })).toThrow(denied)
    expect(() => sessionService.assignSessionRecords({
      coachId: FIRST_JUNIOR_ID,
      database,
      effectiveFrom: "invalid",
      now,
      playerId: "missing",
      seriesId: "missing",
      weekdays: [],
    })).toThrow(denied)
    expect(() => sessionService.endSessionAssignment({
      assignmentId: "missing",
      coachId: FIRST_JUNIOR_ID,
      database,
      effectiveTo: "invalid",
      now,
    })).toThrow(denied)
    expect(() => sessionService.saveSessionAttendanceRecords({
      changes: [],
      coachId: FIRST_JUNIOR_ID,
      database,
      now,
      referenceDate: "2026-08-08",
    })).toThrow(denied)
    expect(() => sessionService.cancelSessionOccurrence({
      coachId: FIRST_JUNIOR_ID,
      database,
      now,
      occurrenceId: "missing",
      referenceDate: "2026-08-08",
    })).toThrow(denied)
    expect(() => sessionService.replaceSessionOccurrence({
      coachId: FIRST_JUNIOR_ID,
      database,
      dateKey: "invalid",
      durationMinutes: 0,
      now,
      occurrenceId: "missing",
      referenceDate: "2026-08-08",
      startTime: "invalid",
      venue: "",
    })).toThrow(denied)

    expect(() => reportService.saveMonthlyReportDraft({
      month: "invalid",
      playerId: "missing",
      reportText: "",
    }, {
      coachId: FIRST_JUNIOR_ID,
      database,
      now,
    })).toThrow(denied)
    expect(() => reportService.publishMonthlyReport({
      month: "invalid",
      playerId: "missing",
      publicationKey: "invalid",
      reportText: "",
    }, {
      coachId: FIRST_JUNIOR_ID,
      database,
      now,
    })).toThrow(denied)

    expect(() => attendanceAdjustments.publishMakeupAttendanceAdjustment({
      coachId: FIRST_JUNIOR_ID,
      completedOn: "invalid",
      database,
      now,
      playerId: "missing",
      sourceOccurrenceId: "missing",
    })).toThrow(denied)
    expect(() => attendanceAdjustments.voidAttendanceAdjustment({
      adjustmentId: "missing",
      coachId: FIRST_JUNIOR_ID,
      database,
      now,
    })).toThrow(denied)
  })
})

describe("junior-coach staff attendance", () => {
  it("persists one auditable record per date and excludes cleared days from summaries", () => {
    const firstSave = new Date("2026-08-08T06:30:00.000Z")
    expect(saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: firstSave,
      changes: [
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-01", choice: "present" },
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-02", choice: "absent" },
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-03", choice: "cleared" },
      ],
    })).toEqual({ applied: 3 })

    const initialRecords = listStaffAttendanceRecords({
      database,
      requesterAccountId: FIRST_JUNIOR_ID,
      coachAccountId: FIRST_JUNIOR_ID,
      from: "2026-08-01",
      to: "2026-08-31",
    })
    expect(initialRecords.map(({ choice, dateKey }) => ({ choice, dateKey }))).toEqual([
      { choice: "present", dateKey: "2026-08-01" },
      { choice: "absent", dateKey: "2026-08-02" },
      { choice: "cleared", dateKey: "2026-08-03" },
    ])
    expect(getStaffAttendanceSummary({
      database,
      requesterAccountId: FIRST_JUNIOR_ID,
      coachAccountId: FIRST_JUNIOR_ID,
      from: "2026-08-01",
      to: "2026-08-31",
    })).toEqual({
      coachAccountId: FIRST_JUNIOR_ID,
      from: "2026-08-01",
      to: "2026-08-31",
      present: 1,
      absent: 1,
      recorded: 2,
      percentage: 50,
    })

    const original = initialRecords[0]
    const correctionTime = new Date("2026-08-09T06:30:00.000Z")
    saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: correctionTime,
      changes: [
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-01", choice: "absent" },
      ],
    })
    const corrected = listStaffAttendanceRecords({
      database,
      requesterAccountId: HEAD_COACH_ID,
      coachAccountId: FIRST_JUNIOR_ID,
      from: "2026-08-01",
      to: "2026-08-01",
    })[0]
    expect(corrected).toMatchObject({ id: original.id, choice: "absent" })
    expect(corrected.createdAt).toBe(original.createdAt)
    expect(corrected.updatedAt).toBe(correctionTime.toISOString())
    expect(database.select().from(schema.staffAttendanceRecords).all()).toHaveLength(3)
  })

  it("allows head reads and own junior reads without exposing another junior", () => {
    expect(getStaffAttendanceSummary({
      database,
      requesterAccountId: HEAD_COACH_ID,
      coachAccountId: FIRST_JUNIOR_ID,
      from: "2026-08-01",
      to: "2026-08-31",
    }).percentage).toBeNull()
    expect(() => listStaffAttendanceRecords({
      database,
      requesterAccountId: FIRST_JUNIOR_ID,
      coachAccountId: SECOND_JUNIOR_ID,
      from: "2026-08-01",
      to: "2026-08-31",
    })).toThrow("only view their own attendance")
    expect(() => saveStaffAttendanceRecords({
      database,
      markedByAccountId: FIRST_JUNIOR_ID,
      now: new Date("2026-08-08T06:30:00.000Z"),
      changes: [
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-08", choice: "present" },
      ],
    })).toThrow("Head coach access")
  })

  it("validates India dates, joining dates, future dates, choices, and duplicate changes atomically", () => {
    const justAfterIndiaMidnight = new Date("2026-08-08T18:45:00.000Z")
    expect(saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: justAfterIndiaMidnight,
      changes: [
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-09", choice: "present" },
      ],
    })).toEqual({ applied: 1 })
    expect(() => saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: justAfterIndiaMidnight,
      changes: [
        { coachAccountId: FIRST_JUNIOR_ID, dateKey: "2026-08-10", choice: "present" },
      ],
    })).toThrow("future date")
    expect(() => saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: justAfterIndiaMidnight,
      changes: [
        { coachAccountId: SECOND_JUNIOR_ID, dateKey: "2026-08-02", choice: "present" },
      ],
    })).toThrow("before the joining date")
    expect(() => saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: justAfterIndiaMidnight,
      changes: [{
        coachAccountId: FIRST_JUNIOR_ID,
        dateKey: "2026-02-30",
        choice: "present",
      }],
    })).toThrow("valid attendance date")
    expect(() => saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: justAfterIndiaMidnight,
      changes: [{
        coachAccountId: FIRST_JUNIOR_ID,
        dateKey: "2026-08-04",
        choice: "late" as never,
      }],
    })).toThrow("valid attendance result")

    expect(() => saveStaffAttendanceRecords({
      database,
      markedByAccountId: HEAD_COACH_ID,
      now: justAfterIndiaMidnight,
      changes: [
        { coachAccountId: SECOND_JUNIOR_ID, dateKey: "2026-08-03", choice: "present" },
        { coachAccountId: SECOND_JUNIOR_ID, dateKey: "2026-08-03", choice: "absent" },
      ],
    })).toThrow("duplicate changes")
    expect(database.select().from(schema.staffAttendanceRecords).all()
      .filter((record) => record.coachAccountId === SECOND_JUNIOR_ID)).toHaveLength(0)
  })

  it("rejects malformed read ranges before querying records", () => {
    expect(() => listStaffAttendanceRecords({
      database,
      requesterAccountId: HEAD_COACH_ID,
      coachAccountId: FIRST_JUNIOR_ID,
      from: "2026-08-31",
      to: "2026-08-01",
    })).toThrow("valid attendance date range")
  })
})
