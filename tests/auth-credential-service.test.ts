import { createHash } from "node:crypto"
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
  releaseLoginAttempt,
  releaseSecondFactorAttempt,
  removePinCredential,
  reserveLoginAttempt,
  reserveSecondFactorAttempt,
  saveActivationClaim,
  setPinCredential,
  validateNewPin,
  validatePin,
  verifyCurrentPassword,
  verifyCurrentPasswordAttempt,
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

/**
 * `recordLoginSuccess` asserts its argument is a 64-character hex digest,
 * because it interpolates it into a LIKE. These cases used readable labels, so
 * they hash them the way every production caller already does.
 */
function subjectFor(label: string) {
  return createHash("sha256").update(label).digest("hex")
}

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

  it("holds back the password step until the coach has finished onboarding", async () => {
    const playerId = "onboarding-player"
    const { activationToken } = createApprovedPlayer(playerId, "Onboarding Player")
    database.insert(schema.playerEnrollments).values({
      accountId: playerId,
      status: "unassigned",
      trainingStartOn: "2026-09-01",
      updatedAt: NOW,
    }).run()

    /*
     * The rule -- a player may only set a password once assessment, sessions and
     * fees are done -- used to be enforced on one door only. The status lookup
     * withheld the password step, while the receipt held by the browser they
     * registered in walked straight through to it.
     */
    expect(getActivationClaimStatus(activationToken, { database, now: NOW })).toMatchObject({
      accountId: playerId,
      state: "onboarding",
    })
    await expect(completeAccountActivation({
      token: activationToken,
      password: PASSWORD,
    }, { database, now: NOW })).resolves.toBeNull()
    expect(database.select().from(schema.authUsers)
      .where(eq(schema.authUsers.id, playerId)).get()).toBeUndefined()

    database.update(schema.playerEnrollments).set({ onboardingCompletedAt: NOW, updatedAt: NOW })
      .where(eq(schema.playerEnrollments.accountId, playerId)).run()

    expect(getActivationClaimStatus(activationToken, { database, now: NOW }))
      .toMatchObject({ state: "approved" })
    await expect(completeAccountActivation({
      token: activationToken,
      password: PASSWORD,
    }, { database, now: NOW })).resolves.toMatchObject({ accountId: playerId })
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
    expect(validatePin("618203")).toBeNull()
    expect(hasPinCredential(playerId, { database })).toBe(false)
    await expect(setPinCredential({ accountId: playerId, pin: "618203" }, { database, now: NOW }))
      .resolves.toEqual({ created: true })
    expect(hasPinCredential(playerId, { database })).toBe(true)
    await expect(verifyPinLogin({ academyId, pin: "618203" }, { database }))
      .resolves.toEqual({ accountId: playerId, role: "player", twoFactorEnabled: false })
    await expect(verifyPinLogin({ academyId, pin: "907364" }, { database })).resolves.toBeNull()
    await expect(verifyCurrentPassword({ accountId: playerId, password: PASSWORD }, { database }))
      .resolves.toBe(true)

    await expect(setPinCredential({ accountId: playerId, pin: "907364" }, {
      database,
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toEqual({ created: false })
    await expect(verifyPinLogin({ academyId, pin: "618203" }, { database })).resolves.toBeNull()
    await expect(verifyPinLogin({ academyId, pin: "907364" }, { database })).resolves.toMatchObject({
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
    await expect(setPinCredential({ accountId: coachId, pin: "305817" }, { database, now: NOW }))
      .resolves.toEqual({ created: true })
    await expect(verifyPinLogin({ academyId, pin: "305817" }, { database })).resolves.toEqual({
      accountId: coachId,
      role: "coach",
      twoFactorEnabled: false,
    })

    await expect(setPinCredential({ accountId: HEAD_COACH_ID, pin: "305817" }, { database, now: NOW }))
      .resolves.toEqual({ created: true })
    database.update(schema.authUsers).set({ twoFactorEnabled: true })
      .where(eq(schema.authUsers.id, coachId)).run()
    await expect(verifyPinLogin({ academyId, pin: "305817" }, { database })).resolves.toEqual({
      accountId: coachId,
      role: "coach",
      twoFactorEnabled: true,
    })
  })

  it("does not make the shared bucket a cheap lockout when no address is attributable", async () => {
    /*
     * When nothing identifies the caller, `subject:<hash>:<ipHash>` is not a
     * per-address key at all -- ipHash is one constant for every caller on
     * earth, so it is a second account-wide key with a threshold of five. An
     * earlier round kept it there and the effect was that denying any account
     * cost five requests, not the fifty its own comment claimed, and the fifty
     * key could never fire because the five key blocked first.
     */
    const { unknownIpHash } = await import("@/lib/auth/security-context")
    const UNKNOWN_IP_HASH = unknownIpHash()
    const shared = { subjectHash: subjectFor("victim-account"), ipHash: UNKNOWN_IP_HASH }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      recordLoginFailure(shared, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked(shared, { database, now: NOW })).toBe(false)

    for (let attempt = 10; attempt < 50; attempt += 1) {
      recordLoginFailure(shared, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked(shared, { database, now: NOW })).toBe(true)
  })

  it("keeps the two answers identical whether the Academy ID names anybody", () => {
    /*
     * Skipping the failure write for an unresolvable ID was tried, to stop an
     * anonymous caller minting a throttle row per invented ID. It armed an
     * enumeration oracle: a real account would start answering "wait a few
     * minutes" from the sixth attempt while an invented one answered "incorrect"
     * for ever, which reads the whole roster at six credential-free requests per
     * ID -- and Academy IDs are sequential.
     *
     * So both are counted, and this pins that they reach the same state.
     */
    const real = { subjectHash: subjectFor("a-real-account"), ipHash: "one-address" }
    const invented = { subjectHash: subjectFor("no-such-account"), ipHash: "one-address" }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordLoginFailure(real, { database, now: new Date(NOW.getTime() + attempt) })
      recordLoginFailure(invented, { database, now: new Date(NOW.getTime() + attempt) })
    }

    expect(loginIsBlocked(real, { database, now: NOW }))
      .toBe(loginIsBlocked(invented, { database, now: NOW }))
    expect(loginIsBlocked(real, { database, now: NOW })).toBe(true)
  })

  it("bounds guessing against one account however many addresses it comes from", () => {
    /*
     * The first attempt at the lockout fix keyed every ceiling on the caller's
     * address -- which, on any deployment reading a forwarded header, the caller
     * writes. Rotating it bought a fresh five-guess budget every five guesses:
     * measured against a live build, 76 guesses per second with nothing refusing
     * them, which takes a six-digit PIN in hours. A denial of service traded for
     * a takeover.
     */
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recordLoginFailure({
        ipHash: `rotated-address-${attempt}`,
        subjectHash: subjectFor("victim-account"),
      }, { database, now: new Date(NOW.getTime() + attempt) })
    }

    expect(loginIsBlocked({
      ipHash: "another-fresh-address",
      subjectHash: subjectFor("victim-account"),
    }, { database, now: NOW })).toBe(true)
  })

  it("clears spent rows rather than keeping one per failure for ever", () => {
    const stale = new Date(NOW.getTime() - 60 * 60 * 1000)
    for (let attempt = 0; attempt < 30; attempt += 1) {
      recordLoginFailure({
        ipHash: `old-address-${attempt}`,
        subjectHash: subjectFor(`old-account-${attempt}`),
      }, { database, now: stale })
    }
    expect(database.select().from(schema.authLoginAttempts).all().length).toBeGreaterThan(30)

    recordLoginFailure({ ipHash: "fresh", subjectHash: subjectFor("fresh") }, { database, now: NOW })

    // Only the three keys the fresh failure wrote survive; the spent window is gone.
    expect(database.select().from(schema.authLoginAttempts).all()).toHaveLength(3)
  })

  it("never lets a stranger's failures refuse the client holding the real credential", () => {
    /*
     * The subject counter used to be keyed on the account alone, so five wrong
     * guesses from anywhere refused the person who actually knew the password.
     * Reproduced against a live build: five failures from five addresses left
     * the victim's own correct password answering "Wait a few minutes", with
     * each attacker address sitting at one failure. Any account, the head coach
     * included, locked out by an unauthenticated stranger for fifteen minutes,
     * renewable indefinitely.
     */
    const victim = { subjectHash: subjectFor("victim-account"), ipHash: "victim-home" }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordLoginFailure({
        ipHash: `attacker-${attempt}`,
        subjectHash: subjectFor("victim-account"),
      }, { database, now: new Date(NOW.getTime() + attempt) })
    }

    expect(loginIsBlocked(victim, { database, now: NOW })).toBe(false)
  })

  it("still stops one client guessing one account, and clears that block on success", () => {
    const guesser = { subjectHash: subjectFor("victim-account"), ipHash: "one-attacker" }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordLoginFailure(guesser, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked(guesser, { database, now: NOW })).toBe(true)

    // Proving you hold the password ends the lockout everywhere, not only on the
    // address that caused it -- otherwise the block outlives the proof.
    recordLoginSuccess(guesser.subjectHash, { database })
    expect(loginIsBlocked(guesser, { database, now: NOW })).toBe(false)
  })

  it("blocks repeated subject and IP failures and clears only the successful subject", () => {
    const subject = { subjectHash: subjectFor("player-a"), ipHash: "shared-ip" }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordLoginFailure(subject, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked(subject, { database, now: NOW })).toBe(true)

    recordLoginSuccess(subject.subjectHash, { database })
    expect(loginIsBlocked(subject, { database, now: NOW })).toBe(false)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      recordLoginFailure({
        ipHash: "saturated-ip",
        subjectHash: subjectFor(`player-${attempt}`),
      }, { database, now: new Date(NOW.getTime() + attempt) })
    }
    expect(loginIsBlocked({
      ipHash: "saturated-ip",
      subjectHash: "new-player",
    }, { database, now: NOW })).toBe(true)
  })

  describe("PIN strength", () => {
    it.each([
      "000000", "111111", "123456", "654321", "234567", "876543", "121212",
      "123123", "112233", "445566", "520520", "246810", "010203", "131313",
    ])("refuses %s when a PIN is being set", (pin) => {
      expect(validateNewPin(pin)).toMatch(/too easy to guess/u)
    })

    it.each(["150906", "090615", "061509", "250310", "100399", "311299"])(
      "refuses %s, which reads as a date a player or parent was born",
      (pin) => {
        expect(validateNewPin(pin)).toMatch(/too easy to guess/u)
      },
    )

    it.each(["482916", "739251", "519374", "618203", "907364", "305817"])(
      "accepts %s",
      (pin) => {
        expect(validateNewPin(pin)).toBeNull()
      },
    )

    it("still reports a malformed PIN as a shape error, not a strength one", () => {
      expect(validateNewPin("12345")).toBe("Enter exactly 6 digits.")
      expect(validateNewPin("12345a")).toBe("Enter exactly 6 digits.")
    })

    it("leaves sign-in alone, so a PIN set before the rule still works", async () => {
      // Shape only: tightening this would lock out anyone whose existing PIN is
      // now considered weak, with no way to sign in and change it.
      expect(validatePin("123456")).toBeNull()
      expect(validatePin("000000")).toBeNull()
    })

    it("refuses to store a weak PIN even if a caller forgets to validate", async () => {
      const playerId = "weak-pin-player"
      createApprovedPlayer(playerId, "Weak Pin Player")
      database.update(schema.authCredentialStates)
        .set({ status: "active", updatedAt: NOW })
        .where(eq(schema.authCredentialStates.accountId, playerId)).run()
      await expect(setPinCredential({ accountId: playerId, pin: "123456" }, { database, now: NOW }))
        .rejects.toThrow(/too easy to guess/u)
      expect(hasPinCredential(playerId, { database })).toBe(false)
    })
  })

  describe("reserving a sign-in attempt before the secret is checked", () => {
    it("lets exactly the allowed number of simultaneous guesses through", () => {
      // Five guesses per account per address. A burst fired together used to
      // read "not blocked" five hundred times over before any failure was
      // written; reserving spends each guess at the moment it is checked.
      const guesser = { ipHash: "burst-ip", subjectHash: subjectFor("burst-victim") }
      let admitted = 0
      for (let request = 0; request < 500; request += 1) {
        if (reserveLoginAttempt(guesser, { database, now: NOW })) admitted += 1
      }
      expect(admitted).toBe(5)
      expect(loginIsBlocked(guesser, { database, now: NOW })).toBe(true)
    })

    it("applies the tighter PIN ceiling across addresses, and only to PIN sign-in", () => {
      const subjectHash = subjectFor("pin-victim")
      let admitted = 0
      for (let request = 0; request < 40; request += 1) {
        // A fresh address every time, as an attacker rotating through an IPv6
        // prefix or a proxy pool would present.
        if (reserveLoginAttempt({ factor: "pin", ipHash: `rotating-${request}`, subjectHash }, {
          database,
          now: NOW,
        })) admitted += 1
      }
      expect(admitted).toBe(10)

      // The tight budget is PIN-only: the password form, from a different
      // address, is not locked by it.
      expect(loginIsBlocked({ ipHash: "owner-home", subjectHash }, { database, now: NOW }))
        .toBe(false)
    })

    it("is reset by a verified PIN, not by signing in some other way", () => {
      const subjectHash = subjectFor("pin-budget-owner")
      const guess = (n: number) => reserveLoginAttempt(
        { factor: "pin", ipHash: `ip-${n}`, subjectHash },
        { database, now: NOW },
      )
      for (let n = 0; n < 9; n += 1) guess(n)
      // A password sign-in by the same account must not hand back the PIN guesses.
      recordLoginSuccess(subjectHash, { database })
      expect(guess(9)).toBe(true)
      expect(guess(10)).toBe(false)

      // A correct PIN does.
      releaseLoginAttempt({ factor: "pin", ipHash: "ip-11", subjectHash }, { database, now: NOW })
      expect(guess(12)).toBe(true)
    })

    it("hands the guess back when the secret was right", () => {
      const subjectHash = subjectFor("honest-player")
      const attempt = { factor: "pin" as const, ipHash: "venue-wifi", subjectHash }
      for (let index = 0; index < 4; index += 1) {
        expect(reserveLoginAttempt(attempt, { database, now: NOW })).toBe(true)
      }
      expect(reserveLoginAttempt(attempt, { database, now: NOW })).toBe(true)
      releaseLoginAttempt(attempt, { database, now: NOW })
      expect(loginIsBlocked(attempt, { database, now: NOW })).toBe(false)
      expect(reserveLoginAttempt(attempt, { database, now: NOW })).toBe(true)
    })

    it("does not forgive a shared address for what it did to other accounts", () => {
      // Nineteen failures against other accounts from one address, then a
      // correct sign-in. The refund is one guess, not a clean slate.
      for (let index = 0; index < 19; index += 1) {
        recordLoginFailure({
          ipHash: "busy-ip",
          subjectHash: subjectFor(`other-${index}`),
        }, { database, now: NOW })
      }
      const mine = { ipHash: "busy-ip", subjectHash: subjectFor("me") }
      expect(reserveLoginAttempt(mine, { database, now: NOW })).toBe(true)
      releaseLoginAttempt(mine, { database, now: NOW })
      const another = { ipHash: "busy-ip", subjectHash: subjectFor("someone-else") }
      expect(reserveLoginAttempt(another, { database, now: NOW })).toBe(true)
      expect(reserveLoginAttempt(
        { ipHash: "busy-ip", subjectHash: subjectFor("and-another") },
        { database, now: NOW },
      )).toBe(false)
    })

    it("spends nothing when a ceiling is already standing", () => {
      const subjectHash = subjectFor("locked")
      for (let index = 0; index < 5; index += 1) {
        reserveLoginAttempt({ ipHash: "ip-a", subjectHash }, { database, now: NOW })
      }
      const row = () => database.select().from(schema.authLoginAttempts)
        .where(eq(schema.authLoginAttempts.key, `ip:ip-a`)).get()?.failedCount
      const before = row()
      expect(reserveLoginAttempt({ ipHash: "ip-a", subjectHash }, { database, now: NOW }))
        .toBe(false)
      expect(row()).toBe(before)
    })
  })

  describe("the per-account second-factor budgets", () => {
    const reserve = (accountId: string, scope: "challenge" | "session", now = NOW) =>
      reserveSecondFactorAttempt(accountId, scope, { database, now })

    it("admits exactly eight guesses at one account's code, however many arrive together", () => {
      let admitted = 0
      for (let request = 0; request < 200; request += 1) {
        if (reserve("head-coach-account", "challenge")) admitted += 1
      }
      expect(admitted).toBe(8)
    })

    it("keeps each account's budget separate", () => {
      for (let request = 0; request < 8; request += 1) reserve("head-coach-account", "challenge")
      expect(reserve("head-coach-account", "challenge")).toBe(false)
      expect(reserve("owner-account", "challenge")).toBe(true)
    })

    // Someone holding only a coach's PIN can open sign-in challenges and fail
    // them. That must not lock the coach, already signed in, out of the
    // in-session checks (reconnect, reissue, recovery-email change).
    it("keeps sign-in failures from blocking the signed-in owner, and the other way round", () => {
      for (let request = 0; request < 8; request += 1) reserve("head-coach-account", "challenge")
      expect(reserve("head-coach-account", "challenge")).toBe(false)
      expect(reserve("head-coach-account", "session")).toBe(true)
      for (let request = 0; request < 8; request += 1) reserve("owner-account", "session")
      expect(reserve("owner-account", "session")).toBe(false)
      expect(reserve("owner-account", "challenge")).toBe(true)
    })

    it("is cleared, in both places, by a right code", () => {
      for (let request = 0; request < 8; request += 1) {
        reserve("head-coach-account", "challenge")
        reserve("head-coach-account", "session")
      }
      releaseSecondFactorAttempt("head-coach-account", { database })
      for (const scope of ["challenge", "session"] as const) {
        let admitted = 0
        for (let request = 0; request < 20; request += 1) {
          if (reserve("head-coach-account", scope)) admitted += 1
        }
        expect(admitted).toBe(8)
      }
    })

    it("opens again after fifteen minutes", () => {
      for (let request = 0; request < 8; request += 1) reserve("head-coach-account", "challenge")
      const later = new Date(NOW.getTime() + 15 * 60 * 1000 + 1)
      expect(reserve("head-coach-account", "challenge", later)).toBe(true)
    })

    it("does not touch the sign-in budgets", () => {
      for (let request = 0; request < 8; request += 1) reserve("head-coach-account", "challenge")
      expect(loginIsBlocked(
        { ipHash: "any-ip", subjectHash: subjectFor("SMBA-HC-0001") },
        { database, now: NOW },
      )).toBe(false)
    })
  })

  it("does not reset the PIN budget when a password turns out right", () => {
    const subjectHash = subjectFor("pin-target")
    for (let request = 0; request < 10; request += 1) {
      reserveLoginAttempt({ factor: "pin", ipHash: `rotating-${request}`, subjectHash }, { database, now: NOW })
    }
    expect(reserveLoginAttempt({ factor: "pin", ipHash: "fresh", subjectHash }, { database, now: NOW }))
      .toBe(false)
    // The child signs in with their password: the password door reserves and
    // releases without the PIN factor.
    const password = { ipHash: "home", subjectHash }
    expect(reserveLoginAttempt(password, { database, now: NOW })).toBe(true)
    releaseLoginAttempt(password, { database, now: NOW })
    expect(reserveLoginAttempt({ factor: "pin", ipHash: "fresh-2", subjectHash }, { database, now: NOW }))
      .toBe(false)
    // A right PIN does reset it.
    releaseLoginAttempt({ factor: "pin", ipHash: "home", subjectHash }, { database, now: NOW })
    expect(reserveLoginAttempt({ factor: "pin", ipHash: "fresh-3", subjectHash }, { database, now: NOW }))
      .toBe(true)
  })

  it("lets only the allowed number of simultaneous current-password guesses be checked", async () => {
    const playerId = "burst-confirmation-player"
    const { academyId, activationToken } = createApprovedPlayer(playerId, "Burst Confirmation Player")
    await completeAccountActivation({ token: activationToken, password: PASSWORD }, { database, now: NOW })
    // Fired together: each verify is a slow scrypt that yields, so before the
    // reservation every one of these read "not blocked" first.
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      verifyCurrentPasswordAttempt({
        academyId,
        accountId: playerId,
        ipHash: "burst-ip",
        operation: "save_pin",
        password: `Wrong password ${index}`,
        userAgent: "test",
      }, { database, now: NOW })))
    expect(results.filter((result) => result === "invalid")).toHaveLength(5)
    expect(results.filter((result) => result === "blocked")).toHaveLength(15)
  })

  it("rate-limits repeated current-password confirmation failures", async () => {
    const playerId = "confirmation-player"
    const { academyId, activationToken } = createApprovedPlayer(playerId, "Confirmation Player")
    await completeAccountActivation({ token: activationToken, password: PASSWORD }, { database, now: NOW })
    const attempt = {
      academyId,
      accountId: playerId,
      ipHash: "confirmation-ip",
      operation: "save_pin",
      password: "Wrong password",
      userAgent: "test",
    }

    for (let index = 0; index < 5; index += 1) {
      await expect(verifyCurrentPasswordAttempt(attempt, {
        database,
        now: new Date(NOW.getTime() + index),
      })).resolves.toBe("invalid")
    }
    await expect(verifyCurrentPasswordAttempt({ ...attempt, password: PASSWORD }, {
      database,
      now: new Date(NOW.getTime() + 5),
    })).resolves.toBe("blocked")

    await expect(verifyCurrentPasswordAttempt({ ...attempt, password: PASSWORD }, {
      database,
      now: new Date(NOW.getTime() + 15 * 60 * 1_000 + 5),
    })).resolves.toBe("verified")
    await expect(verifyCurrentPasswordAttempt(attempt, {
      database,
      now: new Date(NOW.getTime() + 15 * 60 * 1_000 + 6),
    })).resolves.toBe("invalid")
  })

  it("accepts the PIN in place of the password only where it is allowed", async () => {
    const playerId = "pin-confirmation-player"
    const { academyId, activationToken } = createApprovedPlayer(playerId, "Pin Confirmation Player")
    await completeAccountActivation({ token: activationToken, password: PASSWORD }, { database, now: NOW })
    await setPinCredential({ accountId: playerId, pin: "618203" }, { database, now: NOW })
    const attempt = {
      academyId,
      accountId: playerId,
      ipHash: "pin-confirmation-ip",
      operation: "add_recovery_email",
      userAgent: "test",
    }

    await expect(verifyCurrentPasswordAttempt({ ...attempt, password: "618203" }, { database, now: NOW }))
      .resolves.toBe("invalid")
    await expect(verifyCurrentPasswordAttempt({ ...attempt, allowPin: true, password: "618203" }, {
      database,
      now: NOW,
    })).resolves.toBe("verified")
    await expect(verifyCurrentPasswordAttempt({ ...attempt, allowPin: true, password: "618204" }, {
      database,
      now: NOW,
    })).resolves.toBe("invalid")
    // The password still works where the PIN is allowed.
    await expect(verifyCurrentPasswordAttempt({ ...attempt, allowPin: true, password: PASSWORD }, {
      database,
      now: NOW,
    })).resolves.toBe("verified")
  })

})
