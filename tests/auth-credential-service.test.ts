import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  ACTIVATION_CLAIM_LIFETIME_MS,
  completeAccountActivation,
  createActivationClaimToken,
  getActivationClaimStatus,
  hasPinCredential,
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  removePinCredential,
  saveActivationClaim,
  setPinCredential,
  validatePin,
  verifyCurrentPassword,
  verifyPinLogin,
} from "@/lib/auth/credential-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { seedDatabase } from "@/lib/db/seed"

const HEAD_COACH_ID = "00000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-08-17T10:00:00+05:30")
const PASSWORD = "A strong academy password!"

let sqlite: Database.Database
let database: SmbaDatabase

function createApprovedPlayer(id: string, fullName: string) {
  database.insert(schema.accounts).values({
    id,
    approvalStatus: "approved",
    approvedAt: NOW,
    approvedByAccountId: HEAD_COACH_ID,
    createdAt: NOW,
    fullName,
    normalizedName: fullName.toLocaleLowerCase("en-IN"),
    requestedRole: "player",
    role: "player",
    updatedAt: NOW,
  }).run()
  const allocation = database.insert(schema.academyIdAllocations).values({
    accountId: id,
    createdAt: NOW,
  }).returning({ serial: schema.academyIdAllocations.serial }).get()
  const academyId = `SMBA#${String(allocation.serial).padStart(4, "0")}`
  database.insert(schema.authMethods).values({
    accountId: id,
    createdAt: NOW,
    id: `auth-method-${id}`,
    identifier: academyId,
    method: "academy_id",
  }).run()
  database.insert(schema.authCredentialStates).values({
    accountId: id,
    status: "pending",
    updatedAt: NOW,
  }).run()
  database.insert(schema.authRecoveryEmails).values({
    accountId: id,
    createdAt: NOW,
    email: `${id}@example.com`,
    updatedAt: NOW,
    verifiedAt: NOW,
  }).run()
  const activationToken = createActivationClaimToken()
  saveActivationClaim({ accountId: id, token: activationToken }, { database, now: NOW })
  return { academyId, activationToken }
}

function createPendingRequest(
  id: string,
  fullName: string,
  requestedRole: "coach" | "player" = "player",
) {
  database.insert(schema.accounts).values({
    id,
    approvalStatus: "pending",
    createdAt: NOW,
    fullName,
    normalizedName: fullName.toLocaleLowerCase("en-IN"),
    requestedRole,
    updatedAt: NOW,
  }).run()
  const activationToken = createActivationClaimToken()
  saveActivationClaim({ accountId: id, token: activationToken }, { database, now: NOW })
  return activationToken
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-with-32-characters"
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
})

afterEach(() => {
  sqlite.close()
  delete process.env.BETTER_AUTH_SECRET
})

describe("production credential lifecycle", () => {
  it("reports browser-bound activation states without exposing the stored token", () => {
    const pendingToken = createPendingRequest("pending-player", "Pending Player")
    const rejectedToken = createPendingRequest("rejected-player", "Rejected Player")
    const expiredToken = createPendingRequest("expired-player", "Expired Player")
    database.update(schema.accounts).set({
      approvalStatus: "rejected",
      rejectedAt: NOW,
      updatedAt: NOW,
    }).where(eq(schema.accounts.id, "rejected-player")).run()

    expect(getActivationClaimStatus(pendingToken, { database, now: NOW })).toMatchObject({
      accountId: "pending-player",
      state: "pending",
    })
    expect(getActivationClaimStatus(rejectedToken, { database, now: NOW })).toEqual({ state: "rejected" })
    expect(getActivationClaimStatus(expiredToken, {
      database,
      now: new Date(NOW.getTime() + ACTIVATION_CLAIM_LIFETIME_MS + 1),
    })).toEqual({ state: "expired" })
    expect(getActivationClaimStatus(createActivationClaimToken(), { database, now: NOW }))
      .toEqual({ state: "missing" })
    expect(database.select().from(schema.authActivationClaims)
      .where(eq(schema.authActivationClaims.accountId, "pending-player")).get()?.tokenHash)
      .not.toContain(pendingToken)
  })

  it("activates an approved account once with only a hashed browser claim", async () => {
    const playerId = "credential-player-one"
    const { academyId, activationToken } = createApprovedPlayer(playerId, "Mira Rao")

    expect(database.select().from(schema.authUsers)
      .where(eq(schema.authUsers.id, playerId)).get()).toBeUndefined()
    expect(database.select().from(schema.authCredentialStates)
      .where(eq(schema.authCredentialStates.accountId, playerId)).get()?.status).toBe("pending")
    const storedClaim = database.select().from(schema.authActivationClaims)
      .where(eq(schema.authActivationClaims.accountId, playerId)).get()
    expect(storedClaim?.tokenHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(storedClaim?.tokenHash).not.toContain(activationToken)
    expect(database.select().from(schema.authAccessCodes).all()).toHaveLength(0)

    await expect(completeAccountActivation({
      token: createActivationClaimToken(),
      password: PASSWORD,
    }, { database, now: NOW })).resolves.toBeNull()

    await expect(completeAccountActivation({
      token: activationToken,
      password: PASSWORD,
    }, { database, now: NOW })).resolves.toMatchObject({
      accountId: playerId,
      academyId,
      role: "player",
    })
    expect(database.select().from(schema.authCredentialStates)
      .where(eq(schema.authCredentialStates.accountId, playerId)).get()?.status).toBe("active")
    expect(database.select().from(schema.authUsers)
      .where(eq(schema.authUsers.id, playerId)).get()?.username).toBe(academyId)
    expect(database.select().from(schema.authProviderAccounts)
      .where(eq(schema.authProviderAccounts.userId, playerId)).get()?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/u)

    await expect(completeAccountActivation({
      token: activationToken,
      password: PASSWORD,
    }, { database, now: new Date(NOW.getTime() + 1_000) })).resolves.toBeNull()
  })

  it("supports PIN setup, change, verification, removal, and permanent password fallback", async () => {
    const playerId = "pin-player"
    const { academyId, activationToken } = createApprovedPlayer(playerId, "Pin Player")
    await completeAccountActivation({ token: activationToken, password: PASSWORD }, { database, now: NOW })

    expect(validatePin("12345")).toBe("Enter exactly 6 digits.")
    expect(validatePin("123456")).toBeNull()
    expect(hasPinCredential(playerId, { database })).toBe(false)
    await expect(setPinCredential({ accountId: playerId, pin: "123456" }, { database, now: NOW }))
      .resolves.toEqual({ created: true })
    expect(hasPinCredential(playerId, { database })).toBe(true)
    await expect(verifyPinLogin({ academyId, pin: "123456" }, { database }))
      .resolves.toEqual({ accountId: playerId, role: "player", twoFactorEnabled: false })
    await expect(verifyPinLogin({ academyId, pin: "654321" }, { database })).resolves.toBeNull()
    await expect(verifyCurrentPassword({ accountId: playerId, password: PASSWORD }, { database }))
      .resolves.toBe(true)

    await expect(setPinCredential({ accountId: playerId, pin: "654321" }, {
      database,
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toEqual({ created: false })
    await expect(verifyPinLogin({ academyId, pin: "123456" }, { database })).resolves.toBeNull()
    await expect(verifyPinLogin({ academyId, pin: "654321" }, { database })).resolves.toMatchObject({
      accountId: playerId,
    })

    expect(removePinCredential(playerId, { database })).toBe(true)
    expect(hasPinCredential(playerId, { database })).toBe(false)
    await expect(verifyCurrentPassword({ accountId: playerId, password: PASSWORD }, { database }))
      .resolves.toBe(true)
  })

  it("allows coach PINs and preserves the authenticator challenge requirement", async () => {
    const coachId = "junior-pin-coach"
    const { academyId, activationToken } = createApprovedPlayer(coachId, "Junior Coach")
    database.update(schema.accounts).set({ requestedRole: "coach", role: "coach" })
      .where(eq(schema.accounts.id, coachId)).run()
    database.insert(schema.coachProfiles).values({
      accessLevel: "junior_coach",
      accountId: coachId,
      createdAt: NOW,
      joinedOn: "2026-08-17",
      updatedAt: NOW,
    }).run()
    await completeAccountActivation({ token: activationToken, password: PASSWORD }, { database, now: NOW })
    await expect(setPinCredential({ accountId: coachId, pin: "112233" }, { database, now: NOW }))
      .resolves.toEqual({ created: true })
    await expect(verifyPinLogin({ academyId, pin: "112233" }, { database })).resolves.toEqual({
      accountId: coachId,
      role: "coach",
      twoFactorEnabled: false,
    })

    await expect(setPinCredential({ accountId: HEAD_COACH_ID, pin: "112233" }, { database, now: NOW }))
      .resolves.toEqual({ created: true })
    database.update(schema.authUsers).set({ twoFactorEnabled: true })
      .where(eq(schema.authUsers.id, coachId)).run()
    await expect(verifyPinLogin({ academyId, pin: "112233" }, { database })).resolves.toEqual({
      accountId: coachId,
      role: "coach",
      twoFactorEnabled: true,
    })
  })

  it("blocks repeated subject and IP failures and clears only the successful subject", () => {
    const subject = { subjectHash: "player-a", ipHash: "shared-ip" }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordLoginFailure(subject, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked(subject, { database, now: NOW })).toBe(true)

    recordLoginSuccess(subject.subjectHash, { database })
    expect(loginIsBlocked(subject, { database, now: NOW })).toBe(false)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      recordLoginFailure({
        ipHash: "saturated-ip",
        subjectHash: `player-${attempt}`,
      }, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked({
      ipHash: "saturated-ip",
      subjectHash: "new-player",
    }, { database, now: NOW })).toBe(true)
  })

})
