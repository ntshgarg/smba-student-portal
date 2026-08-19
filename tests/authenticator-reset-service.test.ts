import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  approveAuthenticatorResetRequest,
  listPendingAuthenticatorResetRequests,
  rejectAuthenticatorResetRequest,
} from "@/lib/auth/authenticator-reset-service"
import type {
  AuthenticatorRecoveryMessage,
  AuthMailer,
  PasswordRecoveryMessage,
  RecoveryEmailVerificationMessage,
} from "@/lib/auth/mailer"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"
import {
  claimPasswordRecovery,
  getAuthenticatorRecoveryStatus,
  requestPasswordRecovery,
  submitAuthenticatorResetRequest,
} from "@/lib/auth/recovery-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const NOW = new Date("2026-08-19T16:00:00+05:30")
const ADMIN_ID = "platform-admin"
const HEAD_ID = "head-coach"
const JUNIOR_ID = "junior-coach"
const RECOVERY_EMAIL = "coach@example.com"
const ORIGINAL_REQUIRE_COACH_TOTP = process.env.SMBA_REQUIRE_COACH_TOTP

let sqlite: Database.Database
let database: SmbaDatabase

class CapturingMailer implements AuthMailer {
  authenticatorRecovery: AuthenticatorRecoveryMessage[] = []

  async sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage) {
    this.authenticatorRecovery.push(message)
  }

  async sendPasswordRecovery(message: PasswordRecoveryMessage) {
    void message
  }

  async sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage) {
    void message
  }
}

function createAccount(input: {
  academyId: string
  accessLevel?: "head_admin" | "junior_coach"
  accountId: string
  recoveryEmail?: string
  role: "coach" | "platform_admin" | "player"
  twoFactorEnabled?: boolean
}) {
  database.insert(schema.accounts).values({
    approvalStatus: "approved",
    approvedAt: NOW,
    createdAt: NOW,
    fullName: input.accountId,
    id: input.accountId,
    normalizedName: input.accountId,
    requestedRole: input.role === "player" ? "player" : input.role,
    role: input.role,
    updatedAt: NOW,
  }).run()
  database.insert(schema.authMethods).values({
    accountId: input.accountId,
    createdAt: NOW,
    id: `${input.accountId}-method`,
    identifier: input.academyId,
    method: "academy_id",
  }).run()
  database.insert(schema.authCredentialStates).values({
    accountId: input.accountId,
    activatedAt: NOW,
    status: "active",
    updatedAt: NOW,
  }).run()
  database.insert(schema.authUsers).values({
    createdAt: NOW,
    displayUsername: input.academyId,
    email: `${input.accountId}@auth.smba.invalid`,
    emailVerified: true,
    id: input.accountId,
    name: input.accountId,
    twoFactorEnabled: input.twoFactorEnabled ?? false,
    updatedAt: NOW,
    username: input.academyId,
  }).run()
  database.insert(schema.authProviderAccounts).values({
    accountId: input.accountId,
    createdAt: NOW,
    id: `${input.accountId}-credential`,
    password: "preserved-password-hash",
    providerId: "credential",
    updatedAt: NOW,
    userId: input.accountId,
  }).run()
  if (input.accessLevel) {
    database.insert(schema.coachProfiles).values({
      accessLevel: input.accessLevel,
      accountId: input.accountId,
      createdAt: NOW,
      joinedOn: "2026-08-01",
      updatedAt: NOW,
    }).run()
  }
  if (input.recoveryEmail) {
    database.insert(schema.authRecoveryEmails).values({
      accountId: input.accountId,
      createdAt: NOW,
      email: input.recoveryEmail,
      updatedAt: NOW,
      verifiedAt: NOW,
    }).run()
  }
  if (input.twoFactorEnabled) {
    database.insert(schema.authTwoFactors).values({
      backupCodes: "encrypted-backups",
      id: `${input.accountId}-factor`,
      secret: "encrypted-secret",
      userId: input.accountId,
      verified: true,
    }).run()
  }
}

function insertPendingRequest(input: {
  accountId?: string
  expiresAt?: Date
  id?: string
} = {}) {
  const id = input.id ?? "reset-request"
  database.insert(schema.authAuthenticatorResetRequests).values({
    accountId: input.accountId ?? HEAD_ID,
    createdAt: NOW,
    expiresAt: input.expiresAt ?? new Date(NOW.getTime() + 60_000),
    id,
    recoveryEmail: RECOVERY_EMAIL,
    requestedAt: NOW,
    status: "pending",
    updatedAt: NOW,
  }).run()
  return id
}

beforeEach(() => {
  process.env.SMBA_REQUIRE_COACH_TOTP = "true"
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  createAccount({
    academyId: "SMBA-ADMIN-0001",
    accountId: ADMIN_ID,
    recoveryEmail: "admin@example.com",
    role: "platform_admin",
    twoFactorEnabled: true,
  })
  createAccount({
    academyId: "SMBA-HC-0001",
    accessLevel: "head_admin",
    accountId: HEAD_ID,
    recoveryEmail: RECOVERY_EMAIL,
    role: "coach",
    twoFactorEnabled: true,
  })
  createAccount({
    academyId: "SMBA-JC-0001",
    accessLevel: "junior_coach",
    accountId: JUNIOR_ID,
    recoveryEmail: "junior@example.com",
    role: "coach",
  })
})

afterEach(() => {
  sqlite.close()
  if (ORIGINAL_REQUIRE_COACH_TOTP === undefined) delete process.env.SMBA_REQUIRE_COACH_TOTP
  else process.env.SMBA_REQUIRE_COACH_TOTP = ORIGINAL_REQUIRE_COACH_TOTP
})

describe("admin-approved authenticator recovery", () => {
  it("verifies email, creates one request and fully retires the old authenticator after approval", async () => {
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({
      academyId: "SMBA-HC-0001",
      email: RECOVERY_EMAIL,
      intent: "authenticator",
      mailer,
    }, { database, now: NOW })
    expect(mailer.authenticatorRecovery).toHaveLength(1)
    const token = new URL(mailer.authenticatorRecovery[0].recoveryUrl).searchParams.get("token") ?? ""
    expect(claimPasswordRecovery(token, { database, now: NOW })).toBe(true)
    expect(getAuthenticatorRecoveryStatus(token, { database, now: NOW })).toEqual({
      academyId: "SMBA-HC-0001",
      state: "verified",
    })
    const submitted = submitAuthenticatorResetRequest({ token }, { database, now: NOW })
    expect(submitted?.accountId).toBe(HEAD_ID)
    expect(submitAuthenticatorResetRequest({ token }, { database, now: NOW })).toBeNull()

    database.insert(schema.authPinCredentials).values({
      accountId: HEAD_ID,
      createdAt: NOW,
      pinHash: "preserved-pin-hash",
      updatedAt: NOW,
    }).run()
    database.insert(schema.authRuntimeSessions).values({
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
      id: "runtime-session",
      token: "runtime-token",
      updatedAt: NOW,
      userId: HEAD_ID,
    }).run()
    database.insert(schema.authSessions).values({
      accountId: HEAD_ID,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
      tokenHash: "legacy-token",
    }).run()

    const approved = approveAuthenticatorResetRequest({
      actorAccountId: ADMIN_ID,
      requestId: submitted!.requestId,
    }, { database, now: new Date(NOW.getTime() + 1_000) })
    expect(approved).toEqual({ accountId: HEAD_ID })
    expect(database.select().from(schema.authTwoFactors).all()).toHaveLength(1)
    expect(database.select().from(schema.authTwoFactors)
      .where(eq(schema.authTwoFactors.userId, HEAD_ID)).all()).toHaveLength(0)
    expect(database.select().from(schema.authRuntimeSessions).all()).toHaveLength(0)
    expect(database.select().from(schema.authSessions).all()).toHaveLength(0)
    expect(database.select().from(schema.authPinCredentials)
      .where(eq(schema.authPinCredentials.accountId, HEAD_ID)).get()?.pinHash).toBe("preserved-pin-hash")
    expect(database.select().from(schema.authProviderAccounts)
      .where(eq(schema.authProviderAccounts.userId, HEAD_ID)).get()?.password).toBe("preserved-password-hash")
    expect(database.select().from(schema.authUsers)
      .where(eq(schema.authUsers.id, HEAD_ID)).get()?.twoFactorEnabled).toBe(false)
    expect(postAuthenticationDestination({
      accountId: HEAD_ID,
      role: "coach",
      twoFactorEnabled: false,
    }, { database })).toBe("/auth/two-factor/setup")
  })

  it("keeps generic email behavior for non-head-coach and mismatched requests", async () => {
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({
      academyId: "SMBA-JC-0001",
      email: "junior@example.com",
      intent: "authenticator",
      mailer,
    }, { database, now: NOW })
    await requestPasswordRecovery({
      academyId: "SMBA-HC-0001",
      email: "wrong@example.com",
      intent: "authenticator",
      mailer,
    }, { database, now: new Date(NOW.getTime() + 1_000) })
    await requestPasswordRecovery({
      academyId: "SMBA-ADMIN-0001",
      email: "admin@example.com",
      intent: "authenticator",
      mailer,
    }, { database, now: new Date(NOW.getTime() + 2_000) })
    expect(mailer.authenticatorRecovery).toHaveLength(0)
  })

  it("rejects unauthorized, expired and email-changed approvals without altering MFA", () => {
    const requestId = insertPendingRequest()
    expect(approveAuthenticatorResetRequest({
      actorAccountId: JUNIOR_ID,
      requestId,
    }, { database, now: NOW })).toBeNull()
    expect(rejectAuthenticatorResetRequest({
      actorAccountId: JUNIOR_ID,
      requestId,
    }, { database, now: NOW })).toBe(false)

    database.update(schema.authRecoveryEmails).set({ email: "changed@example.com", updatedAt: NOW })
      .where(eq(schema.authRecoveryEmails.accountId, HEAD_ID)).run()
    expect(approveAuthenticatorResetRequest({
      actorAccountId: ADMIN_ID,
      requestId,
    }, { database, now: NOW })).toBeNull()
    expect(database.select().from(schema.authTwoFactors)
      .where(eq(schema.authTwoFactors.userId, HEAD_ID)).all()).toHaveLength(1)

    database.update(schema.authAuthenticatorResetRequests).set({
      expiresAt: new Date(NOW.getTime() - 1),
    }).where(eq(schema.authAuthenticatorResetRequests.id, requestId)).run()
    expect(listPendingAuthenticatorResetRequests({ database, now: NOW })).toHaveLength(0)
    expect(rejectAuthenticatorResetRequest({
      actorAccountId: ADMIN_ID,
      requestId,
    }, { database, now: NOW })).toBe(false)
  })

  it("rejects a pending request without removing the authenticator or coach sessions", () => {
    const requestId = insertPendingRequest()
    database.insert(schema.authRuntimeSessions).values({
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
      id: "coach-session",
      token: "coach-session-token",
      updatedAt: NOW,
      userId: HEAD_ID,
    }).run()
    expect(rejectAuthenticatorResetRequest({
      actorAccountId: ADMIN_ID,
      requestId,
    }, { database, now: NOW })).toBe(true)
    expect(database.select().from(schema.authTwoFactors)
      .where(eq(schema.authTwoFactors.userId, HEAD_ID)).all()).toHaveLength(1)
    expect(database.select().from(schema.authRuntimeSessions)
      .where(eq(schema.authRuntimeSessions.userId, HEAD_ID)).all()).toHaveLength(1)
  })
})
