import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type {
  AuthenticatorRecoveryMessage,
  AuthMailer,
  PasswordRecoveryMessage,
  RecoveryEmailVerificationMessage,
  RegistrationVerificationMessage,
} from "@/lib/auth/mailer"
import {
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_LIFETIME_MS,
} from "@/lib/auth/recovery-service"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { accounts, authEmailChallenges, authRecoveryEmails } from "@/lib/db/schema"

const { confirmRegistration, requestRegistration } = await import("@/lib/auth/account-service")

const NOW = new Date("2026-09-01T09:00:00+05:30")
const EMAIL = "rakesh@example.com"
const NAME = "Arjun Sharma"
const DOB = "2014-03-11"
const PHONE = "+91 98765 43210"

let sqlite: Database.Database
let database: SmbaDatabase

class CapturingMailer implements AuthMailer {
  registration: RegistrationVerificationMessage[] = []

  async sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage) {
    void message
  }

  async sendPasswordRecovery(message: PasswordRecoveryMessage) {
    void message
  }

  async sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage) {
    void message
  }

  async sendRegistrationVerification(message: RegistrationVerificationMessage) {
    this.registration.push(message)
  }
}

class FailingMailer extends CapturingMailer {
  override async sendRegistrationVerification() {
    throw new Error("simulated delivery failure")
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
})

afterEach(() => {
  sqlite.close()
})

function send(overrides: Partial<Parameters<typeof requestRegistration>[0]> = {}, now = NOW) {
  const mailer = overrides.mailer ?? new CapturingMailer()
  return requestRegistration({
    dateOfBirth: DOB,
    email: EMAIL,
    fullName: NAME,
    mailer,
    phone: PHONE,
    requestedRole: "player",
    ...overrides,
  }, { database, now }).then(() => mailer as CapturingMailer)
}

function confirm(code: string, overrides: Partial<Parameters<typeof confirmRegistration>[0]> = {}, now = NOW) {
  return confirmRegistration({
    code,
    dateOfBirth: DOB,
    email: EMAIL,
    fullName: NAME,
    phone: PHONE,
    requestedRole: "player",
    ...overrides,
  }, { database, now })
}

function accountRows() {
  return database.select().from(accounts).all()
}

function challengeRows() {
  return database.select().from(authEmailChallenges).all()
}

function assertDatabaseHealthy() {
  expect(sqlite.pragma("foreign_key_check")).toEqual([])
  expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }])
}

describe("registration send", () => {
  it("writes a challenge and no account", async () => {
    const mailer = await send()

    expect(accountRows()).toHaveLength(0)
    const challenges = challengeRows()
    expect(challenges).toHaveLength(1)
    // Null accountId is the whole mechanism: until the code is confirmed there is
    // nothing in `accounts` for an unverified stranger to have created.
    expect(challenges[0]!.accountId).toBeNull()
    expect(challenges[0]!.purpose).toBe("verify_email")
    expect(mailer.registration).toHaveLength(1)
    expect(mailer.registration[0]!.standing).toBe("new")
    assertDatabaseHealthy()
  })

  it("never stores the code, only its digest", async () => {
    const mailer = await send()
    const code = mailer.registration[0]!.code

    expect(JSON.stringify(challengeRows())).not.toContain(code)
  })

  it("always mails a six-character code, and one that round-trips", async () => {
    /*
     * Samples rather than proves: `randomInt(0, 1_000_000)` yields a value below
     * 100000 about a tenth of the time, and `padStart` is what stops that
     * arriving as a short code the digest could never match. Five draws is the
     * ceiling the subject throttle allows inside one window -- asking for more
     * fails on the rate limit rather than on the thing under test.
     */
    const mailer = new CapturingMailer()
    for (let draw = 0; draw < 5; draw += 1) {
      const at = new Date(NOW.getTime() + draw * EMAIL_RESEND_COOLDOWN_MS)
      await send({ mailer }, at)
      const code = mailer.registration.at(-1)!.code
      expect(code).toMatch(/^\d{6}$/u)
      expect(code).toHaveLength(6)
    }
  })

  it("refuses a resend inside the cooldown and leaves the first code usable", async () => {
    const mailer = await send()
    const code = mailer.registration[0]!.code

    await expect(send({ mailer }, new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS - 1)))
      .rejects.toThrow("Wait one minute")
    expect(mailer.registration).toHaveLength(1)
    expect(confirm(code)).not.toBeNull()
  })

  it("supersedes the earlier code once the cooldown has elapsed", async () => {
    const mailer = await send()
    const first = mailer.registration[0]!.code
    await send({ mailer }, new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS))
    const second = mailer.registration[1]!.code

    expect(confirm(first, {}, new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS))).toBeNull()
    expect(confirm(second, {}, new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS))).not.toBeNull()
  })

  it("consumes the challenge and hides the address when delivery fails", async () => {
    await expect(send({ mailer: new FailingMailer() })).rejects.toThrow("simulated delivery failure")

    expect(accountRows()).toHaveLength(0)
    expect(challengeRows()[0]!.consumedAt).not.toBeNull()
    const event = database.select().from(schema.authSecurityEvents).all().at(-1)
    expect(event!.outcome).toBe("failure")
    // The address must not ride along into the audit log -- that would put the
    // PII back exactly where the security audit says it should not be.
    expect(JSON.stringify(event)).not.toContain(EMAIL)
  })

  it("blocks the sixth send for one identity and writes nothing", async () => {
    const mailer = new CapturingMailer()
    for (let draw = 0; draw < 5; draw += 1) {
      await send({ mailer }, new Date(NOW.getTime() + draw * EMAIL_RESEND_COOLDOWN_MS))
    }
    const sixth = new Date(NOW.getTime() + 5 * EMAIL_RESEND_COOLDOWN_MS)

    await expect(send({ mailer }, sixth)).rejects.toThrow("Wait a few minutes")
    expect(mailer.registration).toHaveLength(5)
    expect(accountRows()).toHaveLength(0)
  })

  it("lets the same identity through once the window has passed", async () => {
    const mailer = new CapturingMailer()
    for (let draw = 0; draw < 5; draw += 1) {
      await send({ mailer }, new Date(NOW.getTime() + draw * EMAIL_RESEND_COOLDOWN_MS))
    }
    const afterWindow = new Date(NOW.getTime() + 31 * 60 * 1000)

    await expect(send({ mailer }, afterWindow)).resolves.toBeDefined()
    expect(mailer.registration).toHaveLength(6)
  })

  it.each([
    ["an invalid address", { email: "not-an-address" }],
    ["a name that normalizes away", { fullName: "   " }],
    ["a phone with letters", { phone: "98765abcde" }],
    ["a date that does not exist", { dateOfBirth: "2026-02-30" }],
    ["a future date of birth", { dateOfBirth: "2030-01-01" }],
    ["a role nobody may request", { requestedRole: "platform_admin" as const }],
  ])("refuses %s before writing anything", async (_reason, overrides) => {
    await expect(send(overrides)).rejects.toThrow()

    expect(challengeRows()).toHaveLength(0)
    expect(accountRows()).toHaveLength(0)
  })
})

describe("registration confirm", () => {
  it("creates exactly one pending account and burns the code", async () => {
    const mailer = await send()
    const result = confirm(mailer.registration[0]!.code)

    expect(result).toEqual({ academyId: null, accountId: expect.any(String), standing: "new" })
    const rows = accountRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.approvalStatus).toBe("pending")
    expect(rows[0]!.role).toBeNull()
    expect(rows[0]!.contactEmail).toBe(EMAIL)
    expect(rows[0]!.dateOfBirth).toBe(DOB)
    expect(challengeRows()[0]!.consumedAt).not.toBeNull()
    assertDatabaseHealthy()
  })

  it("allocates no Academy ID and no auth method", async () => {
    const mailer = await send()
    confirm(mailer.registration[0]!.code)

    // Serials come from a finite pool at approval; spending one here would burn it
    // on a request the coach may reject.
    expect(database.select().from(schema.academyIdAllocations).all()).toHaveLength(0)
    expect(database.select().from(schema.authMethods).all()).toHaveLength(0)
  })

  it("records the verified address so activation need not ask again", async () => {
    const mailer = await send()
    confirm(mailer.registration[0]!.code)

    const recovery = database.select().from(authRecoveryEmails).all()
    expect(recovery).toHaveLength(1)
    expect(recovery[0]!.email).toBe(EMAIL)
    expect(recovery[0]!.verifiedAt).not.toBeNull()
  })

  it("counts a wrong code without creating anything", async () => {
    await send()
    expect(confirm("000000")).toBeNull()

    const challenge = challengeRows()[0]!
    expect(challenge.failedAttempts).toBe(1)
    expect(challenge.consumedAt).toBeNull()
    expect(accountRows()).toHaveLength(0)
  })

  it("burns the challenge on the fifth miss, so even the right code then fails", async () => {
    const mailer = await send()
    const code = mailer.registration[0]!.code
    const wrong = code === "000000" ? "111111" : "000000"

    for (let attempt = 0; attempt < 5; attempt += 1) expect(confirm(wrong)).toBeNull()

    expect(challengeRows()[0]!.consumedAt).not.toBeNull()
    expect(confirm(code)).toBeNull()
    expect(accountRows()).toHaveLength(0)
  })

  it.each([
    ["five digits", "12345"],
    ["seven digits", "1234567"],
    ["letters", "12345a"],
  ])("rejects %s without spending an attempt", async (_shape, code) => {
    await send()
    expect(confirm(code)).toBeNull()

    // The format guard runs before the digest compare, so a malformed code cannot
    // be used to exhaust someone else's five attempts.
    expect(challengeRows()[0]!.failedAttempts).toBe(0)
  })

  it("accepts a code pasted with a space in it", async () => {
    const mailer = await send()
    const code = mailer.registration[0]!.code

    expect(confirm(`${code.slice(0, 3)} ${code.slice(3)}`)).not.toBeNull()
  })

  it("refuses a code one millisecond past its lifetime", async () => {
    const mailer = await send()
    const expired = new Date(NOW.getTime() + EMAIL_VERIFICATION_LIFETIME_MS + 1)

    expect(confirm(mailer.registration[0]!.code, {}, expired)).toBeNull()
    expect(accountRows()).toHaveLength(0)
  })

  it("accepts a code at the last instant before expiry", async () => {
    const mailer = await send()
    const last = new Date(NOW.getTime() + EMAIL_VERIFICATION_LIFETIME_MS - 1)

    expect(confirm(mailer.registration[0]!.code, {}, last)).not.toBeNull()
  })

  it("creates nothing on a replay of an already-consumed code", async () => {
    const mailer = await send()
    const code = mailer.registration[0]!.code
    confirm(code)

    expect(confirm(code)).toBeNull()
    expect(accountRows()).toHaveLength(1)
  })

  it("rolls back the burn when the account write fails", async () => {
    const mailer = await send()
    const code = mailer.registration[0]!.code

    expect(() => confirm(code, {
      createId: () => {
        throw new Error("simulated insert failure")
      },
    })).toThrow("simulated insert failure")

    // Consumed iff created. Neither happened, so the code is still good.
    expect(accountRows()).toHaveLength(0)
    expect(challengeRows()[0]!.consumedAt).toBeNull()
    expect(confirm(code)).not.toBeNull()
    assertDatabaseHealthy()
  })
})

describe("an identity that is already registered", () => {
  async function registerOnce() {
    const mailer = await send()
    confirm(mailer.registration[0]!.code)
    return mailer
  }

  it("returns the standing and creates no second account", async () => {
    await registerOnce()
    const mailer = await send({}, new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS))
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)

    expect(mailer.registration.at(-1)!.standing).toBe("pending")
    expect(confirm(mailer.registration.at(-1)!.code, {}, later))
      .toEqual({ academyId: null, accountId: null, standing: "pending" })
    expect(accountRows()).toHaveLength(1)
  })

  it("collapses a differently-spaced retype onto the same account", async () => {
    await registerOnce()
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    const mailer = await send({ fullName: "  arjun   SHARMA " }, later)

    expect(confirm(mailer.registration.at(-1)!.code, { fullName: "  arjun   SHARMA " }, later))
      .toEqual({ academyId: null, accountId: null, standing: "pending" })
    expect(accountRows()).toHaveLength(1)
  })

  it("hides a rejected request behind the same shape as a pending one", async () => {
    const first = await registerOnce()
    void first
    database.update(accounts).set({ approvalStatus: "rejected" })
      .where(eq(accounts.approvalStatus, "pending")).run()
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    const mailer = await send({}, later)

    expect(mailer.registration.at(-1)!.standing).toBe("rejected")
    expect(confirm(mailer.registration.at(-1)!.code, {}, later))
      .toEqual({ academyId: null, accountId: null, standing: "rejected" })
    expect(accountRows()).toHaveLength(1)
  })

  it("treats an archived account as absent rather than revealing it", async () => {
    await registerOnce()
    database.update(accounts).set({ archivedAt: NOW }).run()
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    const mailer = await send({}, later)

    // Archiving must not become a way to learn that someone was once registered.
    expect(mailer.registration.at(-1)!.standing).toBe("new")
  })
})

describe("siblings on one address", () => {
  it("registers two differently-named players against one email", async () => {
    const first = await send()
    confirm(first.registration[0]!.code)
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    const second = await send({ fullName: "Ananya Sharma" }, later)
    confirm(second.registration.at(-1)!.code, { fullName: "Ananya Sharma" }, later)

    expect(accountRows()).toHaveLength(2)
    assertDatabaseHealthy()
  })

  it("collapses twins typed with the same name onto one request", async () => {
    // The one case the key cannot separate, and the reason the UI tells the
    // contact to enter the other child's full name rather than silently
    // duplicating.
    const first = await send()
    confirm(first.registration[0]!.code)
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    const second = await send({}, later)

    expect(second.registration.at(-1)!.standing).toBe("pending")
    expect(accountRows()).toHaveLength(1)
  })
})
