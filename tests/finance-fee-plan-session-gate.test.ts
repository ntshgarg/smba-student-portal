import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-fee-session-gate-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "fee-session-gate.db")

describe("Fee Plan session-assignment gate", () => {
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let finance: typeof import("@/lib/finance/service")
  let repository: typeof import("@/lib/finance/repository")
  let schema: typeof import("@/lib/db/schema")

  const coachId = "00000000-0000-4000-8000-000000000001"
  const now = new Date("2026-08-16T10:00:00+05:30")
  let nextId = 0
  let nextSerial = 8_000
  const createId = () => `fee-session-gate-${String(nextId += 1).padStart(4, "0")}`

  function createPlayer(label: string) {
    const playerId = `fee-session-${label}`
    database.insert(schema.accounts).values({
      id: playerId,
      fullName: `${label} Player`,
      normalizedName: `${label.toLowerCase()} player`,
      requestedRole: "player",
      role: "player",
      approvalStatus: "approved",
      approvedAt: now,
      approvedByAccountId: coachId,
      createdAt: now,
      updatedAt: now,
    }).run()
    database.insert(schema.academyIdAllocations).values({
      serial: nextSerial += 1,
      accountId: playerId,
      createdAt: now,
    }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      academyPlan: "weekday-3-day",
      level: "Beginner",
      batch: "Weekday",
      status: "unassigned",
      joinedAt: now,
      updatedAt: now,
    }).run()
    return playerId
  }

  function addAssignment({
    batch = "Weekday",
    effectiveFrom = "2026-08-16",
    effectiveTo = null,
    endsOn = null,
    playerId,
    programme = "Beginner",
    startsOn = "2026-08-01",
    status = "active",
  }: {
    batch?: "Weekday" | "Weekend"
    effectiveFrom?: string
    effectiveTo?: string | null
    endsOn?: string | null
    playerId: string
    programme?: "Beginner" | "Intermediate"
    startsOn?: string
    status?: "active" | "ended"
  }) {
    const seriesId = createId()
    database.insert(schema.sessionSeries).values({
      id: seriesId,
      title: `${programme} ${batch}`,
      programme,
      batch,
      venue: "SMBA Court",
      startsOn,
      endsOn,
      status,
      createdByAccountId: coachId,
      createdAt: now,
    }).run()
    database.insert(schema.sessionAssignments).values({
      id: createId(),
      accountId: playerId,
      seriesId,
      effectiveFrom,
      effectiveTo,
      assignedByAccountId: coachId,
      assignedAt: now,
    }).run()
  }

  function agreementInput(playerId: string, idempotencyKey: string) {
    return {
      playerId,
      academyPlan: "weekday-3-day" as const,
      level: "Beginner" as const,
      batch: "Weekday" as const,
      agreedMonthlyFeePaise: 350_000,
      effectiveFrom: "2026-08-01",
      idempotencyKey,
    }
  }

  beforeAll(async () => {
    finance = await import("@/lib/finance/service")
    repository = await import("@/lib/finance/repository")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    finance.activateFinance({
      trackingMonth: "2026-08",
      idempotencyKey: "fee-session-gate-activation",
    }, { coachId, createId, database, now })
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("rejects both current and legacy Fee Plan creation paths before session assignment", () => {
    const currentPlayerId = createPlayer("No Current Assignment")
    const historicalPlayerId = createPlayer("No Historical Assignment")

    expect(finance.getCoachFinancePlayerRecord(currentPlayerId, {
      coachId,
      database,
      now,
    })?.feePlanSetupReady).toBe(false)
    expect(() => finance.createOrReplaceFeeAgreement(
      agreementInput(currentPlayerId, "fee-session-current-create"),
      { coachId, createId, database, now },
    )).toThrow(expect.objectContaining({
      code: "SETUP_REQUIRED",
      field: "playerId",
    }))
    expect(() => finance.setupExistingPlayerFinance({
      ...agreementInput(historicalPlayerId, "fee-session-historical-create"),
      registrationStatus: "unresolved",
    }, { coachId, createId, database, now })).toThrow(expect.objectContaining({
      code: "SETUP_REQUIRED",
      field: "playerId",
    }))

    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      currentPlayerId,
    )).all()).toHaveLength(0)
    expect(database.select().from(schema.feeAgreements).where(eq(
      schema.feeAgreements.playerAccountId,
      historicalPlayerId,
    )).all()).toHaveLength(0)
  })

  it("does not accept mismatched, ended, expired or invalid assignment ranges", () => {
    const playerId = createPlayer("Invalid Assignments")
    addAssignment({ playerId, programme: "Intermediate" })
    addAssignment({ playerId, status: "ended" })
    addAssignment({ playerId, effectiveTo: "2026-08-15", endsOn: "2026-08-15" })
    addAssignment({
      playerId,
      effectiveFrom: "2026-10-01",
      endsOn: "2026-09-30",
      startsOn: "2026-09-01",
    })

    expect(repository.hasCurrentOrFutureMatchingAssignment(
      database,
      playerId,
      "2026-08-16",
      { programme: "Beginner", batch: "Weekday" },
    )).toBe(false)
    expect(() => finance.createOrReplaceFeeAgreement(
      agreementInput(playerId, "fee-session-invalid-assignments"),
      { coachId, createId, database, now },
    )).toThrow(expect.objectContaining({ code: "SETUP_REQUIRED" }))
  })

  it("accepts a matching active assignment that starts in the future", () => {
    const playerId = createPlayer("Future Assignment")
    addAssignment({
      playerId,
      effectiveFrom: "2026-09-01",
      startsOn: "2026-09-01",
    })

    expect(repository.hasCurrentOrFutureMatchingAssignment(
      database,
      playerId,
      "2026-08-16",
      { programme: "Beginner", batch: "Weekday" },
    )).toBe(true)
    expect(finance.getCoachFinancePlayerRecord(playerId, {
      coachId,
      database,
      now,
    })?.feePlanSetupReady).toBe(true)

    expect(finance.createOrReplaceFeeAgreement(
      agreementInput(playerId, "fee-session-future-assignment"),
      { coachId, createId, database, now },
    )).toMatchObject({
      reused: false,
      agreement: { playerAccountId: playerId },
    })
  })
})
