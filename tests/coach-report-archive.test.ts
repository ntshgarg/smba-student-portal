import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  getCoachPublishedReportDetail,
  listCoachPublishedReportPeriods,
  listCoachPublishedReportSummaries,
} from "@/lib/reports/coach-archive"
import type { SmbaDatabase } from "@/lib/db/client"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import * as schema from "@/lib/db/schema"

const HEAD_COACH_ID = INITIAL_COACH_ACCOUNT_ID
const JUNIOR_COACH_ID = "00000000-0000-4000-8000-000000000021"
const ACTIVE_PLAYER_ID = "00000000-0000-4000-8000-000000000022"
const ARCHIVED_PLAYER_ID = "00000000-0000-4000-8000-000000000023"
const DRAFT_PLAYER_ID = "00000000-0000-4000-8000-000000000024"

let sqlite: Database.Database
let database: SmbaDatabase

function addAccount(input: {
  academyIdSerial: number
  archived?: boolean
  fullName: string
  id: string
  role: "coach" | "player"
}) {
  const instant = new Date("2026-01-10T04:30:00.000Z")
  database.insert(schema.accounts).values({
    id: input.id,
    fullName: input.fullName,
    normalizedName: input.fullName.toLocaleLowerCase("en-IN"),
    requestedRole: input.role,
    role: input.role,
    approvalStatus: "approved",
    approvedAt: instant,
    approvedByAccountId: HEAD_COACH_ID,
    archivedAt: input.archived ? new Date("2026-08-01T04:30:00.000Z") : null,
    archivedByAccountId: input.archived ? HEAD_COACH_ID : null,
    createdAt: instant,
    updatedAt: instant,
  }).run()
  database.insert(schema.academyIdAllocations).values({
    serial: input.academyIdSerial,
    accountId: input.id,
    createdAt: instant,
  }).run()
  if (input.role === "player") {
    database.insert(schema.playerEnrollments).values({
      accountId: input.id,
      trainingStartOn: instant.toISOString().slice(0, 10),
      status: "active",
      updatedAt: instant,
    }).run()
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)

  addAccount({ academyIdSerial: 21, fullName: "Meera Junior", id: JUNIOR_COACH_ID, role: "coach" })
  database.insert(schema.coachProfiles).values({
    accountId: JUNIOR_COACH_ID,
    accessLevel: "junior_coach",
    joinedOn: "2026-01-10",
    createdAt: new Date("2026-01-10T04:30:00.000Z"),
    updatedAt: new Date("2026-01-10T04:30:00.000Z"),
  }).run()
  addAccount({ academyIdSerial: 22, fullName: "Aarav Active", id: ACTIVE_PLAYER_ID, role: "player" })
  addAccount({
    academyIdSerial: 23,
    archived: true,
    fullName: "Bhavna Archived",
    id: ARCHIVED_PLAYER_ID,
    role: "player",
  })
  addAccount({ academyIdSerial: 24, fullName: "Chirag Draft", id: DRAFT_PLAYER_ID, role: "player" })

  const updatedAt = new Date("2026-08-03T04:30:00.000Z")
  database.insert(schema.monthlyReports).values([
    {
      id: "active-july-report",
      accountId: ACTIVE_PLAYER_ID,
      month: "2026-07",
      draftText: "Unpublished revision draft.",
      updatedByAccountId: HEAD_COACH_ID,
      createdAt: updatedAt,
      updatedAt,
    },
    {
      id: "archived-july-report",
      accountId: ARCHIVED_PLAYER_ID,
      month: "2026-07",
      draftText: "Archived player draft.",
      updatedByAccountId: HEAD_COACH_ID,
      createdAt: updatedAt,
      updatedAt,
    },
    {
      id: "draft-only-july-report",
      accountId: DRAFT_PLAYER_ID,
      month: "2026-07",
      draftText: "Draft only.",
      updatedByAccountId: HEAD_COACH_ID,
      createdAt: updatedAt,
      updatedAt,
    },
    {
      id: "active-june-report",
      accountId: ACTIVE_PLAYER_ID,
      month: "2026-06",
      draftText: "June draft.",
      updatedByAccountId: HEAD_COACH_ID,
      createdAt: updatedAt,
      updatedAt,
    },
  ]).run()
  const snapshot = JSON.stringify({
    version: 1,
    month: "2026-07",
    referenceDate: "2026-08-03",
    eligible: 8,
    recorded: 8,
    attended: 7,
    absent: 1,
    pending: 0,
    percentage: 88,
  })
  database.insert(schema.reportPublications).values([
    {
      id: "active-july-r1",
      reportId: "active-july-report",
      revision: 1,
      reportText: "First immutable revision.",
      attendanceSnapshot: snapshot,
      publishedByAccountId: HEAD_COACH_ID,
      publishedAt: new Date("2026-08-01T04:30:00.000Z"),
    },
    {
      id: "active-july-r2",
      reportId: "active-july-report",
      revision: 2,
      reportText: "Second immutable revision.",
      attendanceSnapshot: snapshot,
      publishedByAccountId: HEAD_COACH_ID,
      publishedAt: new Date("2026-08-02T04:30:00.000Z"),
    },
    {
      id: "archived-july-r1",
      reportId: "archived-july-report",
      revision: 1,
      reportText: "Archived player publication.",
      attendanceSnapshot: null,
      publishedByAccountId: HEAD_COACH_ID,
      publishedAt: new Date("2026-08-01T05:30:00.000Z"),
    },
    {
      id: "active-june-r1",
      reportId: "active-june-report",
      revision: 1,
      reportText: "June publication.",
      attendanceSnapshot: snapshot.replace("2026-07", "2026-06"),
      publishedByAccountId: HEAD_COACH_ID,
      publishedAt: new Date("2026-07-01T04:30:00.000Z"),
    },
  ]).run()
})

afterEach(() => sqlite.close())

describe("coach published-report archive reads", () => {
  it("lists month-scoped latest publications with revision counts and archived players", () => {
    expect(listCoachPublishedReportPeriods(HEAD_COACH_ID, { database }))
      .toEqual(["2026-07", "2026-06"])

    const reports = listCoachPublishedReportSummaries(HEAD_COACH_ID, {
      database,
      period: "2026-07",
    })
    expect(reports).toHaveLength(2)
    expect(reports[0]).toMatchObject({
      academyId: "SMBA#0022",
      latestPublicationId: "active-july-r2",
      latestRevision: 2,
      playerArchived: false,
      revisionCount: 2,
    })
    expect(reports[1]).toMatchObject({
      academyId: "SMBA#0023",
      latestPublicationId: "archived-july-r1",
      playerArchived: true,
      revisionCount: 1,
    })
    expect(reports.some((report) => report.playerName === "Chirag Draft")).toBe(false)
  })

  it("searches the selected month by player name or Academy ID", () => {
    expect(listCoachPublishedReportSummaries(HEAD_COACH_ID, {
      database,
      period: "2026-07",
      query: "bhavna",
    }).map((report) => report.playerName)).toEqual(["Bhavna Archived"])
    expect(listCoachPublishedReportSummaries(HEAD_COACH_ID, {
      database,
      period: "2026-07",
      query: "#0022",
    }).map((report) => report.playerName)).toEqual(["Aarav Active"])
  })

  it("uses Academy ID as the deterministic tie-breaker for duplicate player names", () => {
    const rename = sqlite.prepare(`
      update accounts
      set full_name = 'Aditi Rao', normalized_name = 'aditi rao'
      where id = ?
    `)
    rename.run(ACTIVE_PLAYER_ID)
    rename.run(ARCHIVED_PLAYER_ID)

    expect(listCoachPublishedReportSummaries(HEAD_COACH_ID, {
      database,
      period: "2026-07",
      query: "Aditi Rao",
    }).map((report) => report.academyId)).toEqual(["SMBA#0022", "SMBA#0023"])
  })

  it("loads the exact immutable revision and complete newest-first history", () => {
    const detail = getCoachPublishedReportDetail(
      HEAD_COACH_ID,
      "active-july-r1",
      { database },
    )
    expect(detail).toMatchObject({
      publicationId: "active-july-r1",
      reportText: "First immutable revision.",
      revision: 1,
      attendance: {
        eligible: 8,
        attended: 7,
        percentage: 88,
      },
    })
    expect(detail?.revisions.map(({ publicationId, revision }) => ({ publicationId, revision })))
      .toEqual([
        { publicationId: "active-july-r2", revision: 2 },
        { publicationId: "active-july-r1", revision: 1 },
      ])

    const legacy = getCoachPublishedReportDetail(
      HEAD_COACH_ID,
      "archived-july-r1",
      { database },
    )
    expect(legacy?.attendance).toMatchObject({
      eligible: 0,
      recorded: 0,
      percentage: null,
    })
    expect(getCoachPublishedReportDetail(HEAD_COACH_ID, "missing", { database })).toBeNull()
  })

  it("rejects junior-coach archive access", () => {
    expect(() => listCoachPublishedReportSummaries(JUNIOR_COACH_ID, {
      database,
      period: "2026-07",
    })).toThrow("Head coach access")
  })
})
