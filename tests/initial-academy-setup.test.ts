import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  PLATFORM_ADMIN_ACCOUNT_ID,
  verifyCurrentPassword,
  verifyPinLogin,
} from "@/lib/auth/credential-service"
import {
  claimHeadCoachSetupToken,
  completeInitialHeadCoachSetup,
  completeInitialPlatformAdminSetup,
  createHeadCoachSetupClaim,
  HEAD_COACH_SETUP_CLAIM_LIFETIME_MS,
  headCoachSetupAvailable,
  platformAdminSetupAvailable,
  validateInitialHeadCoachSetup,
  validHeadCoachSetupToken,
} from "@/lib/auth/initial-setup"
import {
  confirmRecoveryEmailVerification,
  getVerifiedSetupRecoveryEmail,
  HEAD_SETUP_VERIFIED_EMAIL_LIFETIME_MS,
  recoverySubjectKeyForHeadSetup,
  requestRecoveryEmailVerification,
} from "@/lib/auth/recovery-service"
import {
  HEAD_COACH_ACADEMY_ID,
  PLATFORM_ADMIN_ACADEMY_ID,
} from "@/lib/auth/identity"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const NOW = new Date("2026-08-18T12:00:00+05:30")
const HEAD_PASSWORD = "Head coach secure password!"
const ADMIN_PASSWORD = "Platform owner secure password!"

let sqlite: Database.Database
let database: SmbaDatabase

async function verifiedHeadSetupEmail(setupToken: string) {
  const subjectKey = recoverySubjectKeyForHeadSetup(setupToken)
  let verificationCode = ""
  await requestRecoveryEmailVerification({
    email: "head.coach@example.com",
    fullName: "Sathiya Moorthy",
    mailer: {
      async sendAcademyIdIssued() {},
      async sendAuthenticatorRecovery() {},
      async sendPasswordRecovery() {},
      async sendRecoveryEmailVerification(message) {
        verificationCode = message.code
      },
      async sendRegistrationVerification() {},
    },
    subjectKey,
  }, { database, now: NOW })
  const verified = confirmRecoveryEmailVerification({
    code: verificationCode,
    email: "head.coach@example.com",
    subjectKey,
  }, { database, now: NOW })
  if (!verified?.receiptToken) throw new Error("Test recovery email was not verified.")
  return {
    recoveryEmailReceiptToken: verified.receiptToken,
    recoveryEmailSubjectKey: subjectKey,
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
})

afterEach(() => sqlite.close())

describe("empty-academy first-run security", () => {
  it("provisions the only platform owner with an explicit password and mandatory PIN once", async () => {
    expect(database.select().from(schema.accounts).all()).toHaveLength(0)
    expect(platformAdminSetupAvailable({ database })).toBe(true)
    const setup = await completeInitialPlatformAdminSetup({
      fullName: "Nitish Gupta",
      password: ADMIN_PASSWORD,
      confirmPassword: ADMIN_PASSWORD,
      pin: "739251",
      confirmPin: "739251",
    }, { database, now: NOW })

    expect(setup).toMatchObject({
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      academyId: PLATFORM_ADMIN_ACADEMY_ID,
    })
    expect(platformAdminSetupAvailable({ database })).toBe(false)
    expect(database.select().from(schema.coachProfiles).all()).toHaveLength(0)
    expect(database.select().from(schema.playerEnrollments).all()).toHaveLength(0)
    expect(database.select().from(schema.accounts)
      .where(eq(schema.accounts.id, PLATFORM_ADMIN_ACCOUNT_ID)).get()).toMatchObject({
      role: "platform_admin",
    })
    await expect(verifyCurrentPassword({
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      password: ADMIN_PASSWORD,
    }, { database })).resolves.toBe(true)
    await expect(verifyPinLogin({
      academyId: PLATFORM_ADMIN_ACADEMY_ID,
      pin: "739251",
    }, { database })).resolves.toMatchObject({
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      role: "platform_admin",
      twoFactorEnabled: false,
    })
    await expect(completeInitialPlatformAdminSetup({
      fullName: "Another Owner",
      password: "Another secure owner password!",
      confirmPassword: "Another secure owner password!",
      pin: "482916",
      confirmPin: "482916",
    }, { database, now: NOW })).rejects.toThrow("already been configured")
  })

  it("creates the only head coach with a role-prefixed username, password and PIN exactly once", async () => {
    await completeInitialPlatformAdminSetup({
      fullName: "Nitish Gupta",
      password: ADMIN_PASSWORD,
      confirmPassword: ADMIN_PASSWORD,
      pin: "739251",
      confirmPin: "739251",
    }, { database, now: NOW })
    expect(headCoachSetupAvailable({ database })).toBe(true)
    const claim = createHeadCoachSetupClaim({
      claimImmediately: true,
      createdByAccountId: PLATFORM_ADMIN_ACCOUNT_ID,
    }, { database, now: NOW })
    const verifiedEmail = await verifiedHeadSetupEmail(claim.token)
    const setup = await completeInitialHeadCoachSetup({
      fullName: "Sathiya Moorthy",
      password: HEAD_PASSWORD,
      confirmPassword: HEAD_PASSWORD,
      pin: "482916",
      confirmPin: "482916",
      setupToken: claim.token,
      ...verifiedEmail,
    }, { database, now: NOW })

    expect(setup.academyId).toBe(HEAD_COACH_ACADEMY_ID)
    expect(headCoachSetupAvailable({ database })).toBe(false)
    expect(database.select().from(schema.academyIdAllocations)
      .where(eq(schema.academyIdAllocations.accountId, setup.accountId)).get()?.serial).toBe(30_001)
    await expect(verifyCurrentPassword({
      accountId: setup.accountId,
      password: HEAD_PASSWORD,
    }, { database })).resolves.toBe(true)
    await expect(verifyPinLogin({
      academyId: HEAD_COACH_ACADEMY_ID,
      pin: "482916",
    }, { database })).resolves.toMatchObject({
      accountId: setup.accountId,
      role: "coach",
      twoFactorEnabled: false,
    })

    await expect(completeInitialHeadCoachSetup({
      fullName: "Second Head",
      password: "Another secure password!",
      confirmPassword: "Another secure password!",
      pin: "739251",
      confirmPin: "739251",
      setupToken: claim.token,
      ...verifiedEmail,
    }, { database, now: NOW })).rejects.toThrow("one-time setup session")
    expect(validHeadCoachSetupToken(claim.token, { database, now: NOW })).toBe(false)
  })

  /*
   * The verified email kept the code's own expiry -- ten minutes from when the
   * code was sent -- so a coach who verified late and then took a few minutes
   * over a password and PIN was told to verify an email the page still showed
   * as verified. The time limit now starts at verification.
   */
  it("keeps a verified setup email usable for its own window after verification", async () => {
    await completeInitialPlatformAdminSetup({
      fullName: "Nitish Gupta",
      password: ADMIN_PASSWORD,
      confirmPassword: ADMIN_PASSWORD,
      pin: "739251",
      confirmPin: "739251",
    }, { database, now: NOW })
    const claim = createHeadCoachSetupClaim({
      claimImmediately: true,
      createdByAccountId: PLATFORM_ADMIN_ACCOUNT_ID,
    }, { database, now: NOW })
    const subjectKey = recoverySubjectKeyForHeadSetup(claim.token)
    let verificationCode = ""
    await requestRecoveryEmailVerification({
      email: "head.coach@example.com",
      fullName: "Sathiya Moorthy",
      mailer: {
        async sendAcademyIdIssued() {},
        async sendAuthenticatorRecovery() {},
        async sendPasswordRecovery() {},
        async sendRecoveryEmailVerification(message) {
          verificationCode = message.code
        },
        async sendRegistrationVerification() {},
      },
      subjectKey,
    }, { database, now: NOW })
    const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000)
    const verified = confirmRecoveryEmailVerification({
      code: verificationCode,
      email: "head.coach@example.com",
      subjectKey,
    }, { database, now: minutes(8) })
    if (!verified?.receiptToken) throw new Error("Test recovery email was not verified.")

    // Twelve minutes after verifying, twenty after the code was sent.
    const later = minutes(20)
    expect(getVerifiedSetupRecoveryEmail({
      receiptToken: verified.receiptToken,
      subjectKey,
    }, { database, now: later })).toBe("head.coach@example.com")
    // ...but not for ever.
    expect(getVerifiedSetupRecoveryEmail({
      receiptToken: verified.receiptToken,
      subjectKey,
    }, {
      database,
      now: new Date(minutes(8).getTime() + HEAD_SETUP_VERIFIED_EMAIL_LIFETIME_MS + 1),
    })).toBeNull()

    await expect(completeInitialHeadCoachSetup({
      fullName: "Sathiya Moorthy",
      password: HEAD_PASSWORD,
      confirmPassword: HEAD_PASSWORD,
      pin: "482916",
      confirmPin: "482916",
      recoveryEmailReceiptToken: verified.receiptToken,
      recoveryEmailSubjectKey: subjectKey,
      setupToken: claim.token,
    }, { database, now: later })).resolves.toMatchObject({ academyId: HEAD_COACH_ACADEMY_ID })
  })

  it("stores expiring single-use head-coach setup claims and invalidates older links", async () => {
    await completeInitialPlatformAdminSetup({
      fullName: "Nitish Gupta",
      password: ADMIN_PASSWORD,
      confirmPassword: ADMIN_PASSWORD,
      pin: "739251",
      confirmPin: "739251",
    }, { database, now: NOW })
    const first = createHeadCoachSetupClaim({
      createdByAccountId: PLATFORM_ADMIN_ACCOUNT_ID,
    }, { database, now: NOW })
    expect(database.select().from(schema.authSetupClaims).get()?.tokenHash).not.toContain(first.token)
    expect(claimHeadCoachSetupToken(first.token, { database, now: NOW })).toBe(true)
    expect(claimHeadCoachSetupToken(first.token, { database, now: NOW })).toBe(false)
    expect(validHeadCoachSetupToken(first.token, { database, now: NOW })).toBe(true)

    const second = createHeadCoachSetupClaim({
      claimImmediately: true,
      createdByAccountId: PLATFORM_ADMIN_ACCOUNT_ID,
    }, { database, now: new Date(NOW.getTime() + 1_000) })
    expect(validHeadCoachSetupToken(first.token, { database, now: NOW })).toBe(false)
    expect(validHeadCoachSetupToken(second.token, {
      database,
      now: new Date(NOW.getTime() + 1_000),
    })).toBe(true)
    expect(validHeadCoachSetupToken(second.token, {
      database,
      now: new Date(NOW.getTime() + HEAD_COACH_SETUP_CLAIM_LIFETIME_MS + 1_001),
    })).toBe(false)
  })
})

/*
 * The form has six controls and one error channel, so the field a refusal
 * belongs to has to travel with the message. Without it every failure marked
 * "Full name" invalid and moved focus there -- a screen-reader user who
 * mistyped Confirm PIN was told "Full name, invalid entry, The PINs do not
 * match." and pointed at a correct field.
 */
describe("first head-coach setup validation names the field at fault", () => {
  const valid = {
    confirmPassword: "A stronger passphrase 1",
    confirmPin: "519374",
    fullName: "Sathiya Moorthy",
    password: "A stronger passphrase 1",
    pin: "519374",
    recoveryEmailReceiptToken: "receipt",
    recoveryEmailSubjectKey: "subject",
    setupToken: "token",
  }

  it("accepts a complete submission", () => {
    expect(validateInitialHeadCoachSetup(valid)).toBeNull()
  })

  it("blames the name, the password, and the password confirmation separately", () => {
    expect(validateInitialHeadCoachSetup({ ...valid, fullName: "A" }))
      .toMatchObject({ field: "fullName" })
    expect(validateInitialHeadCoachSetup({ ...valid, confirmPassword: "short", password: "short" }))
      .toMatchObject({ field: "password" })
    expect(validateInitialHeadCoachSetup({ ...valid, confirmPassword: "A different one 12" }))
      .toMatchObject({ field: "confirmPassword", message: "The passwords do not match." })
  })

  it("blames the PIN and its confirmation separately", () => {
    expect(validateInitialHeadCoachSetup({ ...valid, confirmPin: "12345", pin: "12345" }))
      .toMatchObject({ field: "pin" })
    expect(validateInitialHeadCoachSetup({ ...valid, confirmPin: "246814" }))
      .toMatchObject({ field: "confirmPin", message: "The PINs do not match." })
  })
})
