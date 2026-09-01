import path from "node:path"

import Database from "better-sqlite3"
import { createOTP } from "@better-auth/utils/otp"
import { hashPassword, symmetricEncrypt } from "better-auth/crypto"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  hasPinCredential,
  setPinCredential,
  upsertPasswordCredential,
  verifyCurrentPassword,
} from "@/lib/auth/credential-service"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"
import {
  claimPasswordRecovery,
  completePasswordRecovery,
  confirmRecoveryEmailVerification,
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_LIFETIME_MS,
  getPasswordRecoveryStatus,
  getRecoveryEmail,
  PASSWORD_RECOVERY_LIFETIME_MS,
  recoverySubjectKeyForAccount,
  requestPasswordRecovery,
  requestRecoveryEmailVerification,
  verifyPasswordRecoverySecondFactor,
} from "@/lib/auth/recovery-service"
import type {
  AuthenticatorRecoveryMessage,
  AuthMailer,
  PasswordRecoveryMessage,
  RecoveryEmailVerificationMessage,
  RegistrationVerificationMessage,
} from "@/lib/auth/mailer"
import { authEmailRequired, validateAuthEmailConfiguration } from "@/lib/auth/mailer"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const NOW = new Date("2026-08-18T12:00:00+05:30")
const OLD_PASSWORD = "Old secure account password!"
const NEW_PASSWORD = "New secure account password!"
const SHARED_EMAIL = "parent@example.com"

let sqlite: Database.Database
let database: SmbaDatabase

class CapturingMailer implements AuthMailer {
  authenticatorRecovery: AuthenticatorRecoveryMessage[] = []
  passwordRecovery: PasswordRecoveryMessage[] = []
  registration: RegistrationVerificationMessage[] = []
  verification: RecoveryEmailVerificationMessage[] = []

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
}

class FailingMailer implements AuthMailer {
  async sendAuthenticatorRecovery() {
    throw new Error("simulated delivery failure")
  }

  async sendPasswordRecovery() {
    throw new Error("simulated delivery failure")
  }

  async sendRecoveryEmailVerification() {
    throw new Error("simulated delivery failure")
  }

  async sendRegistrationVerification() {
    throw new Error("simulated delivery failure")
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

function tokenFrom(message: PasswordRecoveryMessage) {
  return new URL(message.resetUrl).searchParams.get("token") ?? ""
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
  delete process.env.RESEND_API_KEY
  delete process.env.SMBA_AUTH_EMAIL_FROM
  delete process.env.SMBA_AUTH_MAIL_TRANSPORT
  delete process.env.SMBA_ACCESSIBILITY_PROFILE
  delete process.env.DB_FILE_NAME
  delete process.env.SMBA_REQUIRE_RECOVERY_EMAIL
  delete process.env.VERCEL
  delete process.env.VERCEL_ENV
  vi.unstubAllEnvs()
})

describe("production mail configuration", () => {
  it("stays dormant until configured and fails safely when enforcement is explicit", () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "production"
    process.env.SMBA_AUTH_MAIL_TRANSPORT = "memory"
    expect(authEmailRequired()).toBe(false)
    process.env.SMBA_REQUIRE_RECOVERY_EMAIL = "true"
    expect(authEmailRequired()).toBe(true)
    expect(() => validateAuthEmailConfiguration()).toThrow("RESEND_API_KEY")
    process.env.RESEND_API_KEY = "re_test_key"
    expect(() => validateAuthEmailConfiguration()).toThrow("SMBA_AUTH_EMAIL_FROM")
    process.env.SMBA_AUTH_EMAIL_FROM = "SMBA Security <security@example.com>"
    expect(() => validateAuthEmailConfiguration()).not.toThrow()
  })

  it("allows memory delivery only for a disposable production accessibility profile", () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SMBA_REQUIRE_RECOVERY_EMAIL = "true"
    process.env.SMBA_AUTH_MAIL_TRANSPORT = "memory"
    process.env.SMBA_ACCESSIBILITY_PROFILE = "clean"
    process.env.DB_FILE_NAME = "/tmp/smba-accessibility-mailer.db"
    expect(() => validateAuthEmailConfiguration()).not.toThrow()

    process.env.DB_FILE_NAME = path.resolve(".data/academy-clean.db")
    expect(() => validateAuthEmailConfiguration()).toThrow("RESEND_API_KEY")

    process.env.DB_FILE_NAME = "/tmp/smba-accessibility-mailer.db"
    process.env.VERCEL = "1"
    expect(() => validateAuthEmailConfiguration()).toThrow("RESEND_API_KEY")
  })
})

describe("verified recovery email", () => {
  it("records a monitorable delivery failure without storing the address or error", async () => {
    await expect(requestRecoveryEmailVerification({
      email: "setup@example.com",
      fullName: "Setup Coach",
      mailer: new FailingMailer(),
      subjectKey: "head-coach-setup",
    }, { database, now: NOW })).rejects.toThrow("simulated delivery failure")

    const event = database.select().from(schema.authSecurityEvents).get()
    expect(event).toMatchObject({
      accountId: null,
      eventType: "recovery_email_verification_requested",
      outcome: "failure",
    })
    expect(JSON.parse(event!.metadata)).toEqual({ reason: "email_delivery" })
    expect(event!.metadata).not.toContain("setup@example.com")
    expect(event!.metadata).not.toContain("simulated delivery failure")
  })

  it("normalizes addresses, supports shared family email, enforces cooldown and rejects exhausted codes", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-1001", accountId: "player-one", role: "player" })
    await createActiveAccount({ academyId: "SMBA-PL-1002", accountId: "player-two", role: "player" })
    const mailer = new CapturingMailer()
    const subjectKey = recoverySubjectKeyForAccount("player-one")
    await requestRecoveryEmailVerification({
      accountId: "player-one",
      email: " Parent@Example.COM ",
      mailer,
      subjectKey,
    }, { database, now: NOW })
    await expect(requestRecoveryEmailVerification({
      accountId: "player-one",
      email: SHARED_EMAIL,
      mailer,
      subjectKey,
    }, { database, now: new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS - 1) }))
      .rejects.toThrow("Wait one minute")

    const code = mailer.verification[0].code
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(confirmRecoveryEmailVerification({
        accountId: "player-one",
        code: "999999",
        email: SHARED_EMAIL,
        subjectKey,
      }, { database, now: new Date(NOW.getTime() + attempt) })).toBeNull()
    }
    expect(confirmRecoveryEmailVerification({
      accountId: "player-one",
      code,
      email: SHARED_EMAIL,
      subjectKey,
    }, { database, now: new Date(NOW.getTime() + 10) })).toBeNull()

    const secondMailer = new CapturingMailer()
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    await requestRecoveryEmailVerification({
      accountId: "player-one",
      email: SHARED_EMAIL,
      mailer: secondMailer,
      subjectKey,
    }, { database, now: later })
    expect(confirmRecoveryEmailVerification({
      accountId: "player-one",
      code: secondMailer.verification[0].code,
      email: SHARED_EMAIL,
      subjectKey,
    }, { database, now: later })).toMatchObject({ email: SHARED_EMAIL })
    database.insert(schema.authRecoveryEmails).values({
      accountId: "player-two",
      createdAt: later,
      email: SHARED_EMAIL,
      updatedAt: later,
      verifiedAt: later,
    }).run()
    expect(getRecoveryEmail("player-one", { database })?.email).toBe(SHARED_EMAIL)
    expect(getRecoveryEmail("player-two", { database })?.email).toBe(SHARED_EMAIL)
  })

  it("keeps the active address until its replacement is verified and rejects expired codes", async () => {
    const accountId = "player-email-change"
    await createActiveAccount({
      academyId: "SMBA-PL-1010",
      accountId,
      email: "old@example.com",
      role: "player",
    })
    const subjectKey = recoverySubjectKeyForAccount(accountId)
    const expiredMailer = new CapturingMailer()
    await requestRecoveryEmailVerification({
      accountId,
      email: "new@example.com",
      mailer: expiredMailer,
      subjectKey,
    }, { database, now: NOW })
    expect(getRecoveryEmail(accountId, { database })?.email).toBe("old@example.com")
    expect(confirmRecoveryEmailVerification({
      accountId,
      code: expiredMailer.verification[0].code,
      email: "new@example.com",
      subjectKey,
    }, {
      database,
      now: new Date(NOW.getTime() + EMAIL_VERIFICATION_LIFETIME_MS),
    })).toBeNull()
    expect(getRecoveryEmail(accountId, { database })?.email).toBe("old@example.com")

    const replacementMailer = new CapturingMailer()
    const later = new Date(NOW.getTime() + EMAIL_VERIFICATION_LIFETIME_MS + 1)
    await requestRecoveryEmailVerification({
      accountId,
      email: "new@example.com",
      mailer: replacementMailer,
      subjectKey,
    }, { database, now: later })
    expect(confirmRecoveryEmailVerification({
      accountId,
      code: replacementMailer.verification[0].code,
      email: "new@example.com",
      subjectKey,
    }, { database, now: later })).toMatchObject({ email: "new@example.com" })
    expect(getRecoveryEmail(accountId, { database })?.email).toBe("new@example.com")
  })
})

describe("password recovery", () => {
  it("records mail-provider failures as a monitorable security signal", async () => {
    await createActiveAccount({
      academyId: "SMBA-PL-2099",
      accountId: "player-delivery-failure",
      email: SHARED_EMAIL,
      role: "player",
    })

    await expect(requestPasswordRecovery({
      academyId: "SMBA-PL-2099",
      email: SHARED_EMAIL,
      mailer: new FailingMailer(),
    }, { database, now: NOW })).resolves.toEqual({ accepted: true })

    const event = database.select().from(schema.authSecurityEvents)
      .where(eq(schema.authSecurityEvents.accountId, "player-delivery-failure"))
      .get()
    expect(event).toMatchObject({
      eventType: "password_recovery_failed",
      outcome: "failure",
    })
    expect(JSON.parse(event!.metadata)).toEqual({ reason: "email_delivery" })
  })

  it("returns a generic response for unknown details and accepts only the newest single-use link", async () => {
    await createActiveAccount({
      academyId: "SMBA-PL-2001",
      accountId: "player-newest-link",
      email: SHARED_EMAIL,
      role: "player",
    })
    const mailer = new CapturingMailer()
    await expect(requestPasswordRecovery({
      academyId: "SMBA-PL-9999",
      email: "unknown@example.com",
      mailer,
    }, { database, now: NOW })).resolves.toEqual({ accepted: true })
    expect(mailer.passwordRecovery).toHaveLength(0)

    await requestPasswordRecovery({
      academyId: "SMBA-PL-2001",
      email: SHARED_EMAIL,
      mailer,
    }, { database, now: NOW })
    await requestPasswordRecovery({
      academyId: "SMBA-PL-2001",
      email: SHARED_EMAIL,
      mailer,
    }, { database, now: new Date(NOW.getTime() + 1_000) })
    const firstToken = tokenFrom(mailer.passwordRecovery[0])
    const newestToken = tokenFrom(mailer.passwordRecovery[1])
    expect(claimPasswordRecovery(firstToken, { database, now: new Date(NOW.getTime() + 2_000) })).toBe(false)
    expect(claimPasswordRecovery(newestToken, { database, now: new Date(NOW.getTime() + 2_000) })).toBe(true)
    expect(claimPasswordRecovery(newestToken, { database, now: new Date(NOW.getTime() + 2_001) })).toBe(false)
    expect(claimPasswordRecovery(newestToken, {
      database,
      now: new Date(NOW.getTime() + PASSWORD_RECOVERY_LIFETIME_MS + 1_001),
    })).toBe(false)
  })

  it("keeps pending, archived, mismatched and unknown accounts indistinguishable", async () => {
    await createActiveAccount({
      academyId: "SMBA-PL-2010",
      accountId: "pending-recovery",
      email: "pending@example.com",
      role: "player",
    })
    await createActiveAccount({
      academyId: "SMBA-PL-2011",
      accountId: "archived-recovery",
      email: "archived@example.com",
      role: "player",
    })
    database.update(schema.accounts).set({ approvalStatus: "pending", approvedAt: null })
      .where(eq(schema.accounts.id, "pending-recovery")).run()
    database.update(schema.accounts).set({ archivedAt: NOW })
      .where(eq(schema.accounts.id, "archived-recovery")).run()
    const mailer = new CapturingMailer()
    const cases = [
      { academyId: "SMBA-PL-2010", email: "pending@example.com" },
      { academyId: "SMBA-PL-2011", email: "archived@example.com" },
      { academyId: "SMBA-PL-2010", email: "mismatch@example.com" },
      { academyId: "SMBA-PL-9998", email: "unknown@example.com" },
    ]
    for (const input of cases) {
      await expect(requestPasswordRecovery({ ...input, mailer }, { database, now: NOW }))
        .resolves.toEqual({ accepted: true })
    }
    expect(mailer.passwordRecovery).toHaveLength(0)
  })

  it("recovers a assistant coach without an authenticator and leaves PIN recreation optional", async () => {
    const accountId = "junior-recovery"
    await createActiveAccount({
      accessLevel: "junior_coach",
      academyId: "SMBA-JC-2042",
      accountId,
      email: "junior@example.com",
      role: "coach",
    })
    await setPinCredential({ accountId, pin: "123456" }, { database, now: NOW })
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({
      academyId: "SMBA-JC-2042",
      email: "junior@example.com",
      mailer,
    }, { database, now: NOW })
    const token = tokenFrom(mailer.passwordRecovery[0])
    expect(claimPasswordRecovery(token, { database, now: NOW })).toBe(true)
    expect(getPasswordRecoveryStatus(token, { database, now: NOW })).toMatchObject({
      requiresSecondFactor: false,
      state: "active",
    })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token }, { database, now: NOW }))
      .resolves.toBe(true)
    expect(hasPinCredential(accountId, { database })).toBe(false)
    expect(postAuthenticationDestination({
      accountId,
      role: "coach",
      twoFactorEnabled: false,
    }, { database })).toBe("/coach")
  })

  it("reuses the shared IP throttle without changing the public response", async () => {
    await createActiveAccount({
      academyId: "SMBA-PL-2002",
      accountId: "player-ip-throttle",
      email: SHARED_EMAIL,
      role: "player",
    })
    const mailer = new CapturingMailer()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(requestPasswordRecovery({
        academyId: `SMBA-PL-${String(8000 + attempt).padStart(4, "0")}`,
        email: `unknown-${attempt}@example.com`,
        mailer,
        security: { ipHash: "shared-recovery-ip" },
      }, { database, now: new Date(NOW.getTime() + attempt) })).resolves.toEqual({ accepted: true })
    }
    await expect(requestPasswordRecovery({
      academyId: "SMBA-PL-2002",
      email: SHARED_EMAIL,
      mailer,
      security: { ipHash: "shared-recovery-ip" },
    }, { database, now: new Date(NOW.getTime() + 21) })).resolves.toEqual({ accepted: true })
    expect(mailer.passwordRecovery).toHaveLength(0)
  })

  it("resets a player password, revokes sessions, removes PIN and rejects replay", async () => {
    const accountId = "player-recovery"
    await createActiveAccount({ academyId: "SMBA-PL-3001", accountId, email: SHARED_EMAIL, role: "player" })
    await setPinCredential({ accountId, pin: "246810" }, { database, now: NOW })
    database.insert(schema.authRuntimeSessions).values({
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      id: "runtime-session",
      token: "runtime-token",
      updatedAt: NOW,
      userId: accountId,
    }).run()
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({ academyId: "SMBA-PL-3001", email: SHARED_EMAIL, mailer }, { database, now: NOW })
    const token = tokenFrom(mailer.passwordRecovery[0])
    expect(claimPasswordRecovery(token, { database, now: NOW })).toBe(true)
    expect(getPasswordRecoveryStatus(token, { database, now: NOW })).toMatchObject({
      requiresSecondFactor: false,
      state: "active",
    })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token }, { database, now: NOW }))
      .resolves.toBe(true)
    expect(hasPinCredential(accountId, { database })).toBe(false)
    expect(database.select().from(schema.authRuntimeSessions)
      .where(eq(schema.authRuntimeSessions.userId, accountId)).all()).toHaveLength(0)
    await expect(verifyCurrentPassword({ accountId, password: NEW_PASSWORD }, { database })).resolves.toBe(true)
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token }, { database, now: NOW }))
      .resolves.toBe(false)
  })

  it("requires and preserves the head coach authenticator, then requires PIN recreation", async () => {
    const accountId = "head-recovery"
    await createActiveAccount({
      accessLevel: "head_admin",
      academyId: "SMBA-HC-0001",
      accountId,
      email: "coach@example.com",
      role: "coach",
    })
    await setPinCredential({ accountId, pin: "135790" }, { database, now: NOW })
    const secret = await addAuthenticator(accountId)
    const originalFactor = database.select().from(schema.authTwoFactors)
      .where(eq(schema.authTwoFactors.userId, accountId)).get()!
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({ academyId: "SMBA-HC-0001", email: "coach@example.com", mailer }, { database, now: NOW })
    const token = tokenFrom(mailer.passwordRecovery[0])
    expect(claimPasswordRecovery(token, { database, now: NOW })).toBe(true)
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token }, { database, now: NOW }))
      .resolves.toBe(false)
    expect(await verifyPasswordRecoverySecondFactor({
      credential: await createOTP(secret).totp(),
      token,
    }, { database, now: NOW })).toBe(true)
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token }, { database, now: NOW }))
      .resolves.toBe(true)
    const preservedFactor = database.select().from(schema.authTwoFactors)
      .where(eq(schema.authTwoFactors.userId, accountId)).get()!
    expect(preservedFactor.secret).toBe(originalFactor.secret)
    expect(hasPinCredential(accountId, { database })).toBe(false)
    expect(postAuthenticationDestination({
      accountId,
      role: "coach",
      twoFactorEnabled: true,
    }, { database })).toBe("/auth/pin/setup")
  })

  it("allows an admin backup code once, preserves TOTP and requires PIN recreation", async () => {
    const accountId = "platform-recovery"
    await createActiveAccount({
      academyId: "SMBA-ADMIN-0001",
      accountId,
      email: "admin@example.com",
      role: "platform_admin",
    })
    await addAuthenticator(accountId, ["ONLY-BACKUP-CODE"])
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({ academyId: "SMBA-ADMIN-0001", email: "admin@example.com", mailer }, { database, now: NOW })
    const token = tokenFrom(mailer.passwordRecovery[0])
    expect(claimPasswordRecovery(token, { database, now: NOW })).toBe(true)
    expect(await verifyPasswordRecoverySecondFactor({
      credential: "ONLY-BACKUP-CODE",
      token,
    }, { database, now: NOW })).toBe(true)
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token }, { database, now: NOW }))
      .resolves.toBe(true)
    expect(database.select().from(schema.authTwoFactors)
      .where(eq(schema.authTwoFactors.userId, accountId)).get()?.verified).toBe(true)
    expect(postAuthenticationDestination({
      accountId,
      role: "platform_admin",
      twoFactorEnabled: true,
    }, { database })).toBe("/auth/pin/setup")
  })
})
