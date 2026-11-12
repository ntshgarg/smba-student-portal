/**
 * The sign-in, recovery-link, authenticator-reset and trusted-device fixes from
 * the state-machine audit, held against a real migrated database.
 *
 * Each case names the family-facing failure it stops: a mail scanner using up a
 * reset link, a finished reset still saying "wait a few minutes", a link in an
 * old inbox outliving a change of recovery address, a busy sign-up session
 * calling right codes wrong, a coach never hearing what became of a reset
 * request, and so on.
 */
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
  approveAuthenticatorResetRequest,
  latestAuthenticatorResetOutcome,
  listPendingAuthenticatorResetRequests,
  notifyAuthenticatorResetDecision,
  withdrawPendingAuthenticatorResetRequests,
} from "@/lib/auth/authenticator-reset-service"
import {
  loginIsBlocked,
  recordLoginFailure,
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
  emailCodeChecksPaused,
  EMAIL_RESEND_COOLDOWN_MS,
  getAuthenticatorRecoveryStatus,
  getPasswordRecoveryStatus,
  notifyRecoveryEmailReplaced,
  passwordRecoveryCodeChecksPaused,
  recoveryEmailSendRefusal,
  recoveryLinkIsOpenable,
  recoverySubjectKeyForAccount,
  registrationSubjectKey,
  requestPasswordRecovery,
  requestRecoveryEmailVerification,
  requestRegistrationVerification,
  verifyFreshAccountSecondFactor,
  verifyPasswordRecoverySecondFactor,
} from "@/lib/auth/recovery-service"
import { endExpiredSessions, listTrustedDevices } from "@/lib/auth/second-factor-reset"
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

class FailingMailer extends CapturingMailer {
  override async sendPasswordRecovery() {
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

  it("opens only the page it was sent for", async () => {
    await createActiveAccount({
      accessLevel: "head_admin",
      academyId: "SMBA-HC-5002",
      accountId: "head-intent",
      email: "head@example.com",
      role: "coach",
    })
    await addAuthenticator("head-intent")
    const mailer = new CapturingMailer()
    await requestPasswordRecovery({
      academyId: "SMBA-HC-5002",
      email: "head@example.com",
      intent: "authenticator",
      mailer,
    }, { database, now: NOW })
    const authenticatorLink = linkFrom(mailer.authenticatorRecovery[0]!.recoveryUrl)
    expect(recoveryLinkIsOpenable(authenticatorLink, "password", { database, now: NOW })).toBe(false)
    expect(claimPasswordRecovery(authenticatorLink, { database, now: NOW })).toBeNull()
    const pass = claimPasswordRecovery(authenticatorLink, { database, intent: "authenticator", now: NOW })
    expect(getAuthenticatorRecoveryStatus(pass!, { database, now: NOW })).toMatchObject({ state: "verified" })
    expect(getPasswordRecoveryStatus(pass!, { database, now: NOW })).toEqual({ state: "missing" })
  })

  it("keeps the link already in the inbox when sending a newer one fails", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5003", accountId: "flaky-mail", email: "parent@example.com", role: "player" })
    const first = await emailedPasswordLink("SMBA-PL-5003", "parent@example.com")
    await requestPasswordRecovery({
      academyId: "SMBA-PL-5003",
      email: "parent@example.com",
      mailer: new FailingMailer(),
    }, { database, now: new Date(NOW.getTime() + 1_000) })
    expect(claimPasswordRecovery(first, { database, now: new Date(NOW.getTime() + 2_000) }))
      .toEqual(expect.any(String))
  })

  it("is not cancelled mid-reset by someone asking for another link", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5004", accountId: "mid-reset", email: "parent@example.com", role: "player" })
    const first = await emailedPasswordLink("SMBA-PL-5004", "parent@example.com")
    const pass = claimPasswordRecovery(first, { database, now: NOW })
    // Anyone who knows the Academy ID and the address can ask again.
    await emailedPasswordLink("SMBA-PL-5004", "parent@example.com", new Date(NOW.getTime() + 1_000))
    expect(getPasswordRecoveryStatus(pass!, { database, now: new Date(NOW.getTime() + 2_000) }))
      .toMatchObject({ state: "active" })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: pass! }, {
      database,
      now: new Date(NOW.getTime() + 2_000),
    })).resolves.toBe(true)
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

  it("expires an authenticator reset request the old address made", async () => {
    await createActiveAccount({
      accessLevel: "head_admin",
      academyId: "SMBA-HC-5102",
      accountId: "head-moving",
      email: "old@example.com",
      role: "coach",
    })
    await addAuthenticator("head-moving")
    database.insert(schema.authAuthenticatorResetRequests).values({
      accountId: "head-moving",
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      id: "old-inbox-request",
      recoveryEmail: "old@example.com",
      requestedAt: NOW,
      status: "pending",
      updatedAt: NOW,
    }).run()
    await changeAddress("head-moving", "new@example.com", new Date(NOW.getTime() + 1_000))
    expect(database.select().from(schema.authAuthenticatorResetRequests).get()?.status).toBe("rejected")
  })

  it("says why no code can be sent before anything is checked", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5103", accountId: "cooling", email: "old@example.com", role: "player" })
    const subjectKey = recoverySubjectKeyForAccount("cooling")
    expect(recoveryEmailSendRefusal({ subjectKey }, { database, now: NOW })).toBeNull()
    await requestRecoveryEmailVerification({
      accountId: "cooling",
      email: "new@example.com",
      mailer: new CapturingMailer(),
      subjectKey,
    }, { database, now: NOW })
    expect(recoveryEmailSendRefusal({ subjectKey }, { database, now: new Date(NOW.getTime() + 1_000) }))
      .toBe("Wait one minute before requesting another code.")
    expect(recoveryEmailSendRefusal({ subjectKey }, {
      database,
      now: new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS),
    })).toBeNull()
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

  it("reports a pause on code checks from this connection, and only from this connection", async () => {
    const mailer = new CapturingMailer()
    await sendRegistrationCode("asha", "asha@example.com", "phone-network", mailer)
    const subjectKey = registrationSubjectKey("asha@example.com", "asha")
    for (let miss = 0; miss < 5; miss += 1) {
      confirmRegistrationVerification({
        code: "000000",
        onVerified: () => true,
        security: { ipHash: "phone-network" },
        subjectKey,
      }, { database, now: NOW })
    }
    expect(emailCodeChecksPaused({
      kind: "registration",
      security: { ipHash: "phone-network" },
      subjectKey,
    }, { database, now: NOW })).toBe(true)
    expect(emailCodeChecksPaused({
      kind: "registration",
      security: { ipHash: "home-broadband" },
      subjectKey,
    }, { database, now: NOW })).toBe(false)
  })

  it("never lets twenty strangers with no visible address stop everyone else", async () => {
    const mailer = new CapturingMailer()
    for (let family = 0; family < 21; family += 1) {
      await sendRegistrationCode(`family ${family}`, `family${family}@example.com`, undefined, mailer)
    }
    expect(mailer.registration).toHaveLength(21)
  })

  it("never shortens a pause that is still running", () => {
    const attempt = { ipHash: "shared-ip", subjectHash: authSubjectHash("SMBA-PL-5201") }
    // Five failures over four minutes: the window began at the first, the
    // pause at the fifth.
    for (let minute = 0; minute < 5; minute += 1) {
      recordLoginFailure(attempt, { database, now: new Date(NOW.getTime() + minute * 60_000) })
    }
    const sixteenMinutesIn = new Date(NOW.getTime() + 16 * 60_000)
    expect(loginIsBlocked(attempt, { database, now: sixteenMinutesIn })).toBe(true)
    // A failure counted without a check in front of it lands after the window
    // but inside the pause. It used to start a fresh count and clear the pause.
    recordLoginFailure(attempt, { database, now: sixteenMinutesIn })
    expect(loginIsBlocked(attempt, { database, now: sixteenMinutesIn })).toBe(true)
  })
})

describe("protected accounts and their authenticator", () => {
  async function headCoachWithAuthenticator(accountId: string, academyId: string, backupCodes?: string[]) {
    await createActiveAccount({ accessLevel: "head_admin", academyId, accountId, email: "head@example.com", role: "coach" })
    return addAuthenticator(accountId, backupCodes)
  }

  it("raises the recovery-code alert when a code is spent resetting a password", async () => {
    await headCoachWithAuthenticator("head-alert", "SMBA-HC-5301", ["SPARE-CODE"])
    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-HC-5301", "head@example.com"), { database, now: NOW })
    await expect(verifyPasswordRecoverySecondFactor({ credential: "SPARE-CODE", token: pass! }, { database, now: NOW }))
      .resolves.toBe(true)
    const alerts = events("totp_verified").filter((row) => row.accountId === "head-alert")
    expect(alerts.map((row) => JSON.parse(row.metadata))).toEqual([
      { method: "backup_code", operation: "password_recovery" },
    ])
  })

  it("raises the recovery-code alert when a code is spent moving the recovery email", async () => {
    await headCoachWithAuthenticator("head-email", "SMBA-HC-5302", ["SPARE-CODE"])
    await expect(verifyFreshAccountSecondFactor({
      accountId: "head-email",
      credential: "SPARE-CODE",
      operation: "change_recovery_email",
    }, { database, now: NOW })).resolves.toBe(true)
    expect(events("totp_verified").map((row) => JSON.parse(row.metadata))).toEqual([
      { method: "backup_code", operation: "change_recovery_email" },
    ])
  })

  it("does not lift a running sign-in lock from a signed-in check", async () => {
    const secret = await headCoachWithAuthenticator("head-lock", "SMBA-HC-5303")
    const lockedUntil = new Date(NOW.getTime() + 10 * 60_000)
    database.update(schema.authTwoFactors).set({ failedVerificationCount: 8, lockedUntil })
      .where(eq(schema.authTwoFactors.userId, "head-lock")).run()
    await expect(verifyFreshAccountSecondFactor({
      accountId: "head-lock",
      credential: await createOTP(secret).totp(),
    }, { database, now: NOW })).resolves.toBe(true)
    expect(database.select().from(schema.authTwoFactors).get()?.lockedUntil?.getTime())
      .toBe(lockedUntil.getTime())
  })

  it("says the reset is paused, rather than the code wrong, while the lock stands", async () => {
    await headCoachWithAuthenticator("head-paused", "SMBA-HC-5304")
    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-HC-5304", "head@example.com"), { database, now: NOW })
    expect(passwordRecoveryCodeChecksPaused({ token: pass! }, { database, now: NOW })).toBe(false)
    database.update(schema.authTwoFactors).set({ lockedUntil: new Date(NOW.getTime() + 60_000) })
      .where(eq(schema.authTwoFactors.userId, "head-paused")).run()
    expect(passwordRecoveryCodeChecksPaused({ token: pass! }, { database, now: NOW })).toBe(true)
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

  it("still refuses an email-only reset of a protected account with no authenticator and no approval", async () => {
    await createActiveAccount({ accessLevel: "head_admin", academyId: "SMBA-HC-5306", accountId: "head-bare", email: "head@example.com", role: "coach" })
    const pass = claimPasswordRecovery(await emailedPasswordLink("SMBA-HC-5306", "head@example.com"), { database, now: NOW })
    expect(getPasswordRecoveryStatus(pass!, { database, now: NOW })).toEqual({
      academyId: "SMBA-HC-5306",
      owner: false,
      state: "unavailable",
    })
    await expect(completePasswordRecovery({ password: NEW_PASSWORD, token: pass! }, { database, now: NOW }))
      .resolves.toBe(false)
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

  it("tells the coach it is waiting, then that it ran out, and marks it so", async () => {
    await headCoachWithRequest({ expiresAt: new Date(NOW.getTime() + 60_000) })
    expect(latestAuthenticatorResetOutcome("head-coach", { database, now: NOW }))
      .toEqual({ at: NOW, state: "pending" })
    const later = new Date(NOW.getTime() + 2 * 60_000)
    expect(latestAuthenticatorResetOutcome("head-coach", { database, now: later }))
      .toEqual({ at: new Date(NOW.getTime() + 60_000), state: "lapsed" })
    listPendingAuthenticatorResetRequests({ database, now: later })
    expect(database.select().from(schema.authAuthenticatorResetRequests).get()?.status).toBe("expired")
  })

  it("is emailed the owner's decision", async () => {
    await headCoachWithRequest()
    database.update(schema.authAuthenticatorResetRequests)
      .set({ resolvedAt: NOW, resolvedByAccountId: "owner", status: "rejected" })
      .run()
    expect(latestAuthenticatorResetOutcome("head-coach", { database, now: NOW }))
      .toEqual({ at: NOW, state: "declined" })
    const mailer = new CapturingMailer()
    await expect(notifyAuthenticatorResetDecision("request", { database, mailer })).resolves.toBe(true)
    expect(mailer.notices[0]).toMatchObject({
      subject: "Your SMBA authenticator reset was not approved",
      to: "head@example.com",
    })
  })

  it("is not offered to the owner once the recovery address has changed", async () => {
    await headCoachWithRequest({ recoveryEmail: "someone-else@example.com" })
    expect(listPendingAuthenticatorResetRequests({ database, now: NOW })).toHaveLength(0)
  })
})

describe("devices and trusted browsers", () => {
  it("clears only the sign-ins that have run out", async () => {
    await createActiveAccount({ academyId: "SMBA-PL-5501", accountId: "devices", role: "player" })
    for (const [id, expiresAt] of [
      ["dead-one", new Date(NOW.getTime() - 60_000)],
      ["dead-two", new Date(NOW.getTime() - 1)],
      ["live", new Date(NOW.getTime() + 60_000)],
    ] as const) {
      database.insert(schema.authRuntimeSessions).values({
        createdAt: NOW,
        expiresAt,
        id,
        token: `token-${id}`,
        updatedAt: NOW,
        userId: "devices",
      }).run()
    }
    expect(endExpiredSessions("devices", { database, now: NOW })).toBe(2)
    expect(database.select({ id: schema.authRuntimeSessions.id }).from(schema.authRuntimeSessions).all())
      .toEqual([{ id: "live" }])
  })

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
