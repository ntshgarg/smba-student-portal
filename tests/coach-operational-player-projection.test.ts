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
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    coachDatabase = await import("@/lib/coach/database")
    const client = await import("@/lib/db/client")
    schema = await import("@/lib/db/schema")
    database = client.initializeDatabase()
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
  })
})
