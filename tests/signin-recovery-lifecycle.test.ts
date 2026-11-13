// Sign-in, recovery-link, authenticator-reset and trusted-device fixes, against a real migrated database.
import path from "node:path"

import Database from "better-sqlite3"
import { hashPassword, symmetricEncrypt } from "better-auth/crypto"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  approveAuthenticatorResetRequest,
  latestAuthenticatorResetOutcome,
  listPendingAuthenticatorResetRequests,
  withdrawPendingAuthenticatorResetRequests,
} from "@/lib/auth/authenticator-reset-service"
import {
  loginIsBlocked,
  reserveLoginAttempt,
  upsertPasswordCredential,
} from "@/lib/auth/credential-service"
import type {
  AuthenticatorRecoveryMessage,
  AuthMailer,
  PasswordRecoveryMessage,
  RecoveryEmailVerificationMessage,
  RegistrationVerificationMessage,
  SecurityNoticeMessage,
} from "@/lib/auth/mailer"
import {
  claimPasswordRecovery,
  completePasswordRecovery,
  confirmRecoveryEmailVerification,
  confirmRegistrationVerification,
  getPasswordRecoveryStatus,
  notifyRecoveryEmailReplaced,
  recoveryLinkIsOpenable,
  recoverySubjectKeyForAccount,
  registrationSubjectKey,
  requestPasswordRecovery,
  requestRecoveryEmailVerification,
  requestRegistrationVerification,
  verifyFreshAccountSecondFactor,
  verifyPasswordRecoverySecondFactor,
} from "@/lib/auth/recovery-service"
import { listTrustedDevices } from "@/lib/auth/second-factor-reset"
import { authSubjectHash } from "@/lib/auth/security-context"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const NOW = new Date("2026-11-13T12:00:00+05:30")
const OLD_PASSWORD = "Old secure account password!"
const NEW_PASSWORD = "New secure account password!"

let sqlite: Database.Database
let database: SmbaDatabase

class CapturingMailer implements AuthMailer {
  authenticatorRecovery: AuthenticatorRecoveryMessage[] = []
  notices: SecurityNoticeMessage[] = []
  passwordRecovery: PasswordRecoveryMessage[] = []
  registration: RegistrationVerificationMessage[] = []
  verification: RecoveryEmailVerificationMessage[] = []

  async sendAcademyIdIssued() {}

  async sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage) {
    this.authenticatorRecovery.push(message)
  }

  async sendPasswordRecovery(message: PasswordRecoveryMessage) {
    this.passwordRecovery.push(message)
  }

  async sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage) {
    this.verification.push(message)
  }

  async sendRegistrationVerification(message: RegistrationVerificationMessage) {
    this.registration.push(message)
  }

  async sendSecurityNotice(message: SecurityNoticeMessage) {
    this.notices.push(message)
  }
}

async function createActiveAccount(input: {
  academyId: string
  accessLevel?: "head_admin" | "junior_coach"
  accountId: string
  email?: string
  role: "coach" | "platform_admin" | "player"
}) {
  database.insert(schema.accounts).values({
    approvalStatus: "approved",
    approvedAt: NOW,
    createdAt: NOW,
    fullName: input.accountId,
    id: input.accountId,
    normalizedName: input.accountId,
    requestedRole: input.role === "player" ? "player" : "coach",
    role: input.role,
    updatedAt: NOW,
  }).run()
  database.insert(schema.authMethods).values({
    accountId: input.accountId,
    createdAt: NOW,
    id: `method-${input.accountId}`,
    identifier: input.academyId,
    method: "academy_id",
  }).run()
  if (input.role === "coach") {
    database.insert(schema.coachProfiles).values({
      accessLevel: input.accessLevel ?? "junior_coach",
      accountId: input.accountId,
      createdAt: NOW,
      joinedOn: "2026-08-18",
      updatedAt: NOW,
    }).run()
  }
  upsertPasswordCredential({
    academyId: input.academyId,
    accountId: input.accountId,
    fullName: input.accountId,
    passwordHash: await hashPassword(OLD_PASSWORD),
  }, { database, now: NOW })
  if (input.email) {
    database.insert(schema.authRecoveryEmails).values({
      accountId: input.accountId,
      createdAt: NOW,
      email: input.email,
      updatedAt: NOW,
      verifiedAt: NOW,
    }).run()
  }
}

async function addAuthenticator(accountId: string, backupCodes = ["BACKUP-CODE-ONE"]) {
  const secret = "JBSWY3DPEHPK3PXP"
  database.update(schema.authUsers).set({ twoFactorEnabled: true })
    .where(eq(schema.authUsers.id, accountId)).run()
  database.insert(schema.authTwoFactors).values({
    backupCodes: await symmetricEncrypt({
      data: JSON.stringify(backupCodes),
      key: process.env.BETTER_AUTH_SECRET!,
    }),
    id: `factor-${accountId}`,
    secret: await symmetricEncrypt({ data: secret, key: process.env.BETTER_AUTH_SECRET! }),
    userId: accountId,
    verified: true,
  }).run()
  return secret
}

function linkFrom(url: string) {
  return new URL(url).searchParams.get("token") ?? ""
}

async function emailedPasswordLink(academyId: string, email: string, now = NOW, mailer = new CapturingMailer()) {
  await requestPasswordRecovery({ academyId, email, mailer }, { database, now })
  return linkFrom(mailer.passwordRecovery.at(-1)!.resetUrl)
}

function events(eventType: string) {
  return database.select().from(schema.authSecurityEvents)
    .where(eq(schema.authSecurityEvents.eventType, eventType as "totp_verified"))
    .all()
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-with-32-characters"
  process.env.NEXT_PUBLIC_SMBA_SITE_ORIGIN = "https://smba.example"
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
  delete process.env.BETTER_AUTH_SECRET
  delete process.env.NEXT_PUBLIC_SMBA_SITE_ORIGIN
})

describe("the emailed reset link", () => {
  it("is not used up by being opened, only by Continue, and then belongs to that browser", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5001", accountId: "scanned", email: "family@school.example", role: "player" })
    const link = await emailedPasswordLink("SMBA-PL-5001", "family@school.example")

    // A mail scanner, a link preview and the parent's own tap all just look.
    expect(recoveryLinkIsOpenable(link, "password", { database, now: NOW })).toBe(true)
    expect(recoveryLinkIsOpenable(link, "password", { database, now: NOW })).toBe(true)

    const pass = claimPasswordRecovery(link, { database, now: NOW })
    expect(pass).toEqual(expect.any(String))
    expect(pass).not.toBe(link)
    // The emailed link opens nothing more: not a second browser, not the page.
    expect(recoveryLinkIsOpenable(link, "password", { database, now: NOW })).toBe(false)
    expect(getPasswordRecoveryStatus(link, { database, now: NOW })).toEqual({ state: "missing" })
    expect(getPasswordRecoveryStatus(pass!, { database, now: NOW })).toMatchObject({ state: "active" })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: link }, { database, now: NOW }))
      .resolves.toBe(false)
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: pass! }, { database, now: NOW }))
      .resolves.toBe(true)
  })

  it("lifts the sign-in pause once the password has been reset", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5005", accountId: "locked-out", email: "parent@example.com", role: "player" })
    const attempt = { ipHash: "home-wifi", subjectHash: authSubjectHash("SMBA-PL-5005") }
    for (let guess = 0; guess < 5; guess += 1) reserveLoginAttempt(attempt, { database, now: NOW })
    expect(loginIsBlocked(attempt, { database, now: NOW })).toBe(true)

    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-PL-5005", "parent@example.com"), { database, now: NOW })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: pass! }, { database, now: NOW }))
      .resolves.toBe(true)
    // "Password reset complete" is followed by a sign-in that works.
    expect(loginIsBlocked(attempt, { database, now: NOW })).toBe(false)
  })
})

describe("changing the recovery email", () => {
  async function changeAddress(accountId: string, newEmail: string, now = NOW) {
    const mailer = new CapturingMailer()
    const subjectKey = recoverySubjectKeyForAccount(accountId)
    await requestRecoveryEmailVerification({ accountId, email: newEmail, mailer, subjectKey }, { database, now })
    return confirmRecoveryEmailVerification({
      accountId,
      code: mailer.verification[0]!.code,
      email: newEmail,
      subjectKey,
    }, { database, now })
  }

  it("kills every reset link and pass the old inbox holds, and tells the old inbox", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5101", accountId: "moving", email: "old@example.com", role: "player" })
    const opened = claimPasswordRecovery(await emailedPasswordLink("SMBA-PL-5101", "old@example.com"), { database, now: NOW })
    const unopened = await emailedPasswordLink("SMBA-PL-5101", "old@example.com", new Date(NOW.getTime() + 1_000))

    const changed = await changeAddress("moving", "new@example.com", new Date(NOW.getTime() + 2_000))
    expect(changed).toMatchObject({ email: "new@example.com", previousEmail: "old@example.com" })

    const later = new Date(NOW.getTime() + 3_000)
    expect(claimPasswordRecovery(unopened, { database, now: later })).toBeNull()
    expect(getPasswordRecoveryStatus(opened!, { database, now: later })).toEqual({ state: "missing" })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: opened! }, { database, now: later }))
      .resolves.toBe(false)

    const mailer = new CapturingMailer()
    await expect(notifyRecoveryEmailReplaced({
      accountId: "moving",
      mailer,
      newEmail: changed!.email,
      previousEmail: changed!.previousEmail,
    }, { database })).resolves.toBe(true)
    expect(mailer.notices).toHaveLength(1)
    expect(mailer.notices[0]).toMatchObject({ subject: "Your SMBA recovery email was changed", to: "old@example.com" })
    expect(mailer.notices[0]!.lines.join(" ")).not.toContain("new@example.com")
  })
})

describe("emailed code throttles", () => {
  async function sendRegistrationCode(name: string, email: string, ipHash: string | undefined, mailer: CapturingMailer, now = NOW) {
    await requestRegistrationVerification({
      email,
      fullName: name,
      mailer,
      security: ipHash ? { ipHash } : undefined,
      standing: "new",
      subjectKey: registrationSubjectKey(email, name.toLowerCase()),
    }, { database, now })
  }

  it("lets a family type the right code after a busy sign-up session on the same wifi", async () => {
    const mailer = new CapturingMailer()
    for (let family = 0; family < 20; family += 1) {
      await sendRegistrationCode(`family ${family}`, `family${family}@example.com`, "academy-wifi", mailer)
    }
    const code = mailer.registration[19]!.code
    const verified = confirmRegistrationVerification({
      code,
      onVerified: (_tx, email) => email,
      security: { ipHash: "academy-wifi" },
      subjectKey: registrationSubjectKey("family19@example.com", "family 19"),
    }, { database, now: NOW })
    expect(verified).toBe("family19@example.com")
  })
})

describe("protected accounts and their authenticator", () => {
  async function headCoachWithAuthenticator(accountId: string, academyId: string, backupCodes?: string[]) {
    await createActiveAccount({ accessLevel: "head_admin", academyId, accountId, email: "head@example.com", role: "coach" })
    return addAuthenticator(accountId, backupCodes)
  }

  it("raises the recovery-code alert when a code is spent in password recovery or a recovery-email change", async () => {
    await headCoachWithAuthenticator("head-alert", "SMBA-HC-5301", ["SPARE-CODE", "SPARE-CODE-TWO"])
    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-HC-5301", "head@example.com"), { database, now: NOW })
    await expect(verifyPasswordRecoverySecondFactor({ credential: "SPARE-CODE", token: pass! }, { database, now: NOW }))
      .resolves.toBe(true)
    await expect(verifyFreshAccountSecondFactor({
      accountId: "head-alert",
      credential: "SPARE-CODE-TWO",
      operation: "change_recovery_email",
    }, { database, now: NOW })).resolves.toBe(true)
    expect(events("totp_verified").map((row) => JSON.parse(row.metadata))).toEqual([
      { method: "backup_code", operation: "password_recovery" },
      { method: "backup_code", operation: "change_recovery_email" },
    ])
  })

  it("lets a head coach reset a forgotten password for a day after the owner approves an authenticator reset", async () => {
    await createActiveAccount({ academyId: "SMBA-ADMIN-0001", accountId: "owner", role: "platform_admin" })
    await headCoachWithAuthenticator("head-lost-everything", "SMBA-HC-5305")
    database.insert(schema.authAuthenticatorResetRequests).values({
      accountId: "head-lost-everything",
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 60_000),
      id: "lost-phone",
      recoveryEmail: "head@example.com",
      requestedAt: NOW,
      status: "pending",
      updatedAt: NOW,
    }).run()
    expect(approveAuthenticatorResetRequest({ actorAccountId: "owner", requestId: "lost-phone" }, { database, now: NOW }))
      .toEqual({ accountId: "head-lost-everything" })

    const soon = new Date(NOW.getTime() + 60 * 60_000)
    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-HC-5305", "head@example.com", soon), { database, now: soon })
    expect(getPasswordRecoveryStatus(pass!, { database, now: soon })).toEqual({
      academyId: "SMBA-HC-5305",
      requiresSecondFactor: false,
      secondFactorVerified: true,
      state: "active",
    })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: pass! }, { database, now: soon }))
      .resolves.toBe(true)
  })

  it("lets a head coach who never connected an authenticator get back in through the owner", async () => {
    await createActiveAccount({ academyId: "SMBA-ADMIN-0001", accountId: "owner", role: "platform_admin" })
    await createActiveAccount({ accessLevel: "head_admin", academyId: "SMBA-HC-5306", accountId: "head-no-app", email: "head@example.com", role: "coach" })
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({ academyId: "SMBA-HC-5306", email: "head@example.com", intent: "authenticator", mailer }, { database, now: NOW })
    expect(mailer.authenticatorRecovery).toHaveLength(1)

    database.insert(schema.authAuthenticatorResetRequests).values({
      accountId: "head-no-app",
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 60_000),
      id: "no-app",
      recoveryEmail: "head@example.com",
      requestedAt: NOW,
      status: "pending",
      updatedAt: NOW,
    }).run()
    expect(listPendingAuthenticatorResetRequests({ database, now: NOW })).toHaveLength(1)
    expect(approveAuthenticatorResetRequest({ actorAccountId: "owner", requestId: "no-app" }, { database, now: NOW }))
      .toEqual({ accountId: "head-no-app" })

    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-HC-5306", "head@example.com"), { database, now: NOW })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: pass! }, { database, now: NOW }))
      .resolves.toBe(true)
  })

  it("lets the owner with no authenticator reset a forgotten password by email, and tells them", async () => {
    await createActiveAccount({ academyId: "SMBA-ADMIN-0001", accountId: "owner", email: "owner@example.com", role: "platform_admin" })
    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-ADMIN-0001", "owner@example.com"), { database, now: NOW })
    expect(getPasswordRecoveryStatus(pass!, { database, now: NOW })).toMatchObject({ requiresSecondFactor: false, state: "active" })
    const mailer = new CapturingMailer()
    await expect(completePasswordRecovery({ mailer, password: NEW_PASSWORD, token: pass! }, { database, now: NOW }))
      .resolves.toBe(true)
    expect(mailer.notices).toEqual([expect.objectContaining({ subject: "Your SMBA password was reset", to: "owner@example.com" })])
  })
})

describe("the coach's authenticator reset request", () => {
  async function headCoachWithRequest(input: { expiresAt?: Date, recoveryEmail?: string } = {}) {
    await createActiveAccount({ academyId: "SMBA-ADMIN-0001", accountId: "owner", role: "platform_admin" })
    await createActiveAccount({ accessLevel: "head_admin", academyId: "SMBA-HC-5401", accountId: "head-coach", email: "head@example.com", role: "coach" })
    await addAuthenticator("head-coach")
    database.insert(schema.authAuthenticatorResetRequests).values({
      accountId: "head-coach",
      createdAt: NOW,
      expiresAt: input.expiresAt ?? new Date(NOW.getTime() + 24 * 60 * 60_000),
      id: "request",
      recoveryEmail: input.recoveryEmail ?? "head@example.com",
      requestedAt: NOW,
      status: "pending",
      updatedAt: NOW,
    }).run()
  }

  it("can be withdrawn, after which the owner can no longer approve it", async () => {
    await headCoachWithRequest()
    expect(withdrawPendingAuthenticatorResetRequests("head-coach", {
      database,
      now: NOW,
      reason: "cancelled_by_coach",
    })).toBe(1)
    expect(approveAuthenticatorResetRequest({ actorAccountId: "owner", requestId: "request" }, { database, now: NOW }))
      .toBeNull()
    expect(database.select().from(schema.authTwoFactors).all()).toHaveLength(1)
    expect(listPendingAuthenticatorResetRequests({ database, now: NOW })).toHaveLength(0)
    // The coach withdrew it, so it is not reported back to them as declined.
    expect(latestAuthenticatorResetOutcome("head-coach", { database, now: NOW })).toBeNull()
  })

  it("tells the coach it is waiting, then that it ran out", async () => {
    await headCoachWithRequest({ expiresAt: new Date(NOW.getTime() + 60_000) })
    expect(latestAuthenticatorResetOutcome("head-coach", { database, now: NOW }))
      .toEqual({ at: NOW, state: "pending" })
    const later = new Date(NOW.getTime() + 2 * 60_000)
    expect(latestAuthenticatorResetOutcome("head-coach", { database, now: later }))
      .toEqual({ at: new Date(NOW.getTime() + 60_000), state: "lapsed" })
  })
})

describe("devices and trusted browsers", () => {
  it("lists each live trusted browser by when it stops skipping the code", async () => {
    await createActiveAccount({ academyId: "SMBA-HC-5502", accountId: "trusting", role: "coach" })
    for (const [id, value, expiresAt] of [
      ["trust-a", "trusting", new Date(NOW.getTime() + 2 * 86_400_000)],
      ["trust-b", "trusting", new Date(NOW.getTime() + 86_400_000)],
      ["trust-expired", "trusting", new Date(NOW.getTime() - 1)],
      ["trust-other", "someone-else", new Date(NOW.getTime() + 86_400_000)],
    ] as const) {
      database.insert(schema.authVerifications).values({
        createdAt: NOW,
        expiresAt,
        id,
        identifier: `trust-device-sha256:${id}`,
        updatedAt: NOW,
        value,
      }).run()
    }
    expect(listTrustedDevices("trusting", { database, now: NOW })).toEqual([
      new Date(NOW.getTime() + 86_400_000),
      new Date(NOW.getTime() + 2 * 86_400_000),
    ])
  })
})
