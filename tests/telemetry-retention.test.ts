import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { undoRegistrationRejection } from "@/lib/auth/account-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { INITIAL_COACH_ACCOUNT_ID, seedDatabase } from "@/lib/db/seed"
import {
  purgeExpiredTelemetry,
  purgeExpiredTelemetryOccasionally,
  resetTelemetryPurgeThrottle,
} from "@/lib/telemetry/retention"

const NOW = new Date("2026-11-05T10:00:00Z")
const day = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

let sqlite: Database.Database
let database: SmbaDatabase

function addClientError(id: string, occurredAt: Date) {
  database.insert(schema.clientErrorReports).values({
    id,
    boundary: "root",
    errorName: "Error",
    eventType: "client_error",
    fingerprint: id,
    occurredAt,
    routePath: "/login",
  }).run()
}

function addServerError(id: string, occurredAt: Date) {
  database.insert(schema.operationalEvents).values({
    id,
    eventType: "application_error",
    fingerprint: id,
    occurredAt,
    routePath: "/login",
  }).run()
}

function addSecurityEvent(id: string, occurredAt: Date) {
  database.insert(schema.authSecurityEvents).values({
    id,
    eventType: "login_failed",
    occurredAt,
    outcome: "failure",
  }).run()
}

beforeEach(() => {
  resetTelemetryPurgeThrottle()
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  seedDatabase(database)
})

afterEach(() => {
  sqlite.close()
})

describe("retention of operational telemetry", () => {
  it("deletes application errors past 90 days and security events past 180", () => {
    addClientError("client-old", day(91))
    addClientError("client-new", day(89))
    addServerError("server-old", day(91))
    addServerError("server-new", day(89))
    // 120 days is past the application-error limit but inside the security one.
    addSecurityEvent("auth-120", day(120))
    addSecurityEvent("auth-old", day(181))
    addSecurityEvent("auth-new", day(1))

    const removed = purgeExpiredTelemetry({ database, now: NOW })

    expect(removed).toMatchObject({ clientErrors: 1, securityEvents: 1, serverErrors: 1 })
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort()
    expect(ids(database.select().from(schema.clientErrorReports).all())).toEqual(["client-new"])
    expect(ids(database.select().from(schema.operationalEvents).all())).toEqual(["server-new"])
    expect(ids(database.select().from(schema.authSecurityEvents).all()))
      .toEqual(["auth-120", "auth-new"])
  })

  it("keeps a row exactly at the limit and deletes nothing from an empty table", () => {
    expect(purgeExpiredTelemetry({ database, now: NOW })).toEqual({
      clientErrors: 0,
      emailCodes: 0,
      expiredSessions: 0,
      rateLimits: 0,
      registrationRequests: 0,
      securityEvents: 0,
      serverErrors: 0,
    })
    addClientError("edge", day(90))
    expect(purgeExpiredTelemetry({ database, now: NOW }).clientErrors).toBe(0)
  })

  it("runs at most once an hour when triggered from a write path", () => {
    addClientError("old-1", day(100))
    purgeExpiredTelemetryOccasionally({ database, now: NOW })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(0)

    addClientError("old-2", day(100))
    purgeExpiredTelemetryOccasionally({ database, now: new Date(NOW.getTime() + 30 * 60_000) })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(1)

    purgeExpiredTelemetryOccasionally({ database, now: new Date(NOW.getTime() + 61 * 60_000) })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(0)
  })

  it("never lets a failed purge break the write that triggered it", () => {
    sqlite.close()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => purgeExpiredTelemetryOccasionally({ database, now: NOW })).not.toThrow()
    spy.mockRestore()
    sqlite = new Database(":memory:")
  })
})

function addEmailCode(id: string, expiresAt: Date, purpose: "verify_email" | "password_reset" = "verify_email") {
  database.insert(schema.authEmailChallenges).values({
    createdAt: new Date(expiresAt.getTime() - 10 * 60_000),
    email: `${id}@example.com`,
    expiresAt,
    id,
    purpose,
    secretHash: `secret-${id}`,
    subjectHash: `subject-${id}`,
    updatedAt: expiresAt,
  }).run()
}

/*
 * The policy's "expired email challenges, sessions and rate-limit records: no
 * more than 90 days after expiry" row had no code behind it. An email code row
 * keeps the address it was sent to, so everyone who ever asked for one stayed
 * on the database for good.
 */
describe("retention of expired sign-in records", () => {
  it("deletes email codes 90 days after they expire, whether or not they were used", () => {
    // Someone started registering and gave up: the code was never entered.
    addEmailCode("abandoned-registration", day(91))
    // A parent asked for a password-recovery code and used it.
    addEmailCode("used-recovery", day(120), "password_reset")
    database.update(schema.authEmailChallenges)
      .set({ consumedAt: day(120) })
      .where(eq(schema.authEmailChallenges.id, "used-recovery"))
      .run()
    addEmailCode("expired-recently", day(89))
    addEmailCode("still-live", new Date(NOW.getTime() + 5 * 60_000))

    expect(purgeExpiredTelemetry({ database, now: NOW }).emailCodes).toBe(2)
    expect(database.select({ id: schema.authEmailChallenges.id }).from(schema.authEmailChallenges)
      .all().map((row) => row.id).sort()).toEqual(["expired-recently", "still-live"])
  })

  it("deletes sessions, verifications and rate-limit records long past expiry", () => {
    database.insert(schema.authSessions).values([
      { accountId: INITIAL_COACH_ACCOUNT_ID, createdAt: day(130), expiresAt: day(100), tokenHash: "old" },
      { accountId: INITIAL_COACH_ACCOUNT_ID, createdAt: day(2), expiresAt: day(1), tokenHash: "recent" },
    ]).run()
    database.insert(schema.authRuntimeSessions).values([
      { createdAt: day(130), expiresAt: day(100), id: "old", token: "old", updatedAt: day(130), userId: INITIAL_COACH_ACCOUNT_ID },
      { createdAt: day(1), expiresAt: day(-6), id: "live", token: "live", updatedAt: day(1), userId: INITIAL_COACH_ACCOUNT_ID },
    ]).run()
    database.insert(schema.authVerifications).values([
      { createdAt: day(100), expiresAt: day(99), id: "old", identifier: "two-factor", updatedAt: day(100), value: "x" },
      { createdAt: day(1), expiresAt: day(1), id: "recent", identifier: "two-factor", updatedAt: day(1), value: "y" },
    ]).run()
    database.insert(schema.authRateLimits).values([
      { count: 3, id: "old", key: "old", lastRequest: day(95).getTime() },
      { count: 1, id: "recent", key: "recent", lastRequest: day(1).getTime() },
    ]).run()
    database.insert(schema.authLoginAttempts).values([
      { failedCount: 2, key: "subject:old", updatedAt: day(95), windowStartedAt: day(95) },
      { blockedUntil: day(1), failedCount: 5, key: "subject:recent", updatedAt: day(1), windowStartedAt: day(1) },
    ]).run()

    const removed = purgeExpiredTelemetry({ database, now: NOW })

    expect(removed).toMatchObject({ emailCodes: 1, expiredSessions: 2, rateLimits: 2 })
    expect(database.select().from(schema.authSessions).all().map((row) => row.tokenHash)).toEqual(["recent"])
    expect(database.select().from(schema.authRuntimeSessions).all().map((row) => row.id)).toEqual(["live"])
    expect(database.select().from(schema.authVerifications).all().map((row) => row.id)).toEqual(["recent"])
    expect(database.select().from(schema.authRateLimits).all().map((row) => row.id)).toEqual(["recent"])
    expect(database.select().from(schema.authLoginAttempts).all().map((row) => row.key))
      .toEqual(["subject:recent"])
  })

  it("does not count a purge as done when the transaction it ran in is rolled back", () => {
    addClientError("old", day(100))

    // A sign-in step writes its security event inside its own transaction,
    // which then fails. Anything purged in there is put back by the rollback.
    expect(() => database.transaction((tx) => {
      purgeExpiredTelemetryOccasionally({ database: tx, now: NOW })
      throw new Error("the step failed")
    })).toThrow("the step failed")
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(1)

    // So the next ordinary write within the hour still clears it.
    purgeExpiredTelemetryOccasionally({ database, now: new Date(NOW.getTime() + 60_000) })
    expect(database.select().from(schema.clientErrorReports).all()).toHaveLength(0)
  })
})

function addRegistrationRequest(id: string, input: { createdAt: Date; rejectedAt?: Date }) {
  const settledAt = input.rejectedAt ?? input.createdAt
  database.insert(schema.accounts).values({
    approvalStatus: input.rejectedAt ? "rejected" : "pending",
    contactEmail: `${id}@example.com`,
    createdAt: input.createdAt,
    fullName: id,
    id,
    normalizedName: id,
    registrationIdentityKey: `identity-${id}`,
    rejectedAt: input.rejectedAt,
    rejectedByAccountId: input.rejectedAt ? INITIAL_COACH_ACCOUNT_ID : undefined,
    requestedRole: "player",
    updatedAt: settledAt,
  }).run()
  database.insert(schema.authRecoveryEmails).values({
    accountId: id,
    createdAt: input.createdAt,
    email: `${id}@example.com`,
    updatedAt: input.createdAt,
    verifiedAt: input.createdAt,
  }).run()
  database.insert(schema.authActivationClaims).values({
    accountId: id,
    createdAt: input.createdAt,
    expiresAt: day(-30),
    tokenHash: `token-${id}`,
    updatedAt: input.createdAt,
  }).run()
  database.insert(schema.authSecurityEvents).values({
    accountId: id,
    eventType: "recovery_email_verified",
    id: `event-${id}`,
    occurredAt: day(100),
    outcome: "success",
  }).run()
}

const accountIds = () => database.select({ id: schema.accounts.id }).from(schema.accounts)
  .all().map((row) => row.id).sort()

/*
 * The policy's "rejected or abandoned registration request: 90 days after final
 * decision/activity" row had no code behind it either, so every request ever
 * made kept its name, address, phone and date of birth for good.
 */
describe("retention of rejected and abandoned registration requests", () => {
  it("deletes a rejected request 90 days after the decision, keeping the audit trail", () => {
    addRegistrationRequest("rejected-old", { createdAt: day(200), rejectedAt: day(91) })
    // Asked long ago but only turned down recently: the decision starts the clock.
    addRegistrationRequest("rejected-recent", { createdAt: day(200), rejectedAt: day(89) })
    addEmailCode("registration-code", day(10))

    const removed = purgeExpiredTelemetry({ database, now: NOW })

    expect(removed.registrationRequests).toBe(1)
    expect(accountIds()).toEqual([INITIAL_COACH_ACCOUNT_ID, "rejected-recent"].sort())
    expect(database.select().from(schema.authRecoveryEmails).all().map((row) => row.accountId))
      .toEqual(["rejected-recent"])
    expect(database.select().from(schema.authActivationClaims).all().map((row) => row.accountId))
      .toEqual(["rejected-recent"])
    // Security events keep their own 180 days; only the link to the deleted request goes.
    expect(database.select().from(schema.authSecurityEvents).all()
      .map((row) => [row.id, row.accountId]).sort())
      .toEqual([["event-rejected-old", null], ["event-rejected-recent", "rejected-recent"]])
    expect(database.select().from(schema.authEmailChallenges).all()).toHaveLength(1)
    // The person can ask again: the identity the request held is free.
    expect(() => database.insert(schema.accounts).values({
      approvalStatus: "pending",
      createdAt: NOW,
      fullName: "Again",
      id: "again",
      normalizedName: "again",
      registrationIdentityKey: "identity-rejected-old",
      requestedRole: "player",
      updatedAt: NOW,
    }).run()).not.toThrow()
  })

  it("deletes a request nobody decided 90 days after it was made, but not one just put back", () => {
    addRegistrationRequest("pending-old", { createdAt: day(91) })
    addRegistrationRequest("pending-recent", { createdAt: day(89) })
    // Rejected long ago, then undone yesterday: the head coach is looking at it.
    addRegistrationRequest("put-back", { createdAt: day(200), rejectedAt: day(120) })
    undoRegistrationRejection("put-back", INITIAL_COACH_ACCOUNT_ID, { database, now: day(1) })

    expect(purgeExpiredTelemetry({ database, now: NOW }).registrationRequests).toBe(1)
    expect(accountIds()).toEqual([INITIAL_COACH_ACCOUNT_ID, "pending-recent", "put-back"].sort())
  })

  it("never deletes an approved or archived member, however old", () => {
    const old = day(400)
    database.insert(schema.accounts).values([
      {
        approvalStatus: "approved",
        approvedAt: old,
        createdAt: old,
        fullName: "Approved",
        id: "approved",
        normalizedName: "approved",
        registrationIdentityKey: "identity-approved",
        requestedRole: "player",
        role: "player",
        updatedAt: old,
      },
      {
        approvalStatus: "approved",
        approvedAt: old,
        archivedAt: day(100),
        createdAt: old,
        fullName: "Archived",
        id: "archived",
        normalizedName: "archived",
        requestedRole: "player",
        role: "player",
        updatedAt: day(100),
      },
    ]).run()
    database.insert(schema.academyIdAllocations).values({ accountId: "approved", createdAt: old }).run()
    database.insert(schema.playerEnrollments).values({
      accountId: "approved",
      trainingStartOn: "2025-10-01",
      updatedAt: old,
    }).run()

    expect(purgeExpiredTelemetry({ database, now: NOW }).registrationRequests).toBe(0)
    expect(accountIds()).toEqual([INITIAL_COACH_ACCOUNT_ID, "approved", "archived"].sort())
  })
})
