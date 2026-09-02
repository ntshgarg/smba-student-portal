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
import { loginIsBlocked } from "@/lib/auth/credential-service"
import { normalizeAcademyId } from "@/lib/auth/identity"
import { EMAIL_RESEND_COOLDOWN_MS } from "@/lib/auth/recovery-service"
import { authSubjectHash } from "@/lib/auth/security-context"
import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { accounts } from "@/lib/db/schema"

const { confirmRegistration, requestRegistration, requestRegistrationStatus } = await import("@/lib/auth/account-service")

/**
 * One test per loophole an adversarial sweep of this flow actually found and an
 * independent verifier reproduced. They are grouped by the attack rather than by
 * the function, because each one is a property of the flow as a whole -- the
 * archived-identity crash, for instance, lives in the gap between a service that
 * hides archived rows and an index that does not.
 *
 * See docs/audit/registration-break-test.md for the reproductions these came
 * from, including the ones that were downgraded and are deliberately not pinned.
 */

const NOW = new Date("2026-09-01T09:00:00+05:30")
const EMAIL = "rakesh@example.com"
const NAME = "Arjun Sharma"
const DOB = "2014-03-11"
const PHONE = "+91 98765 43210"
const VICTIM_IP = "victim-home"
const ATTACKER_IP = "attacker-elsewhere"

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

type SendOverrides = Partial<Parameters<typeof requestRegistration>[0]>

function send(overrides: SendOverrides = {}, now = NOW) {
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

function confirm(
  code: string,
  overrides: Partial<Parameters<typeof confirmRegistration>[0]> = {},
  now = NOW,
) {
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

function assertDatabaseHealthy() {
  expect(sqlite.pragma("foreign_key_check")).toEqual([])
  expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }])
}

/**
 * Archives the row while deliberately *leaving* the identity key on it. That is
 * what `archiveMemberRecord` used to write, and it is still what any row
 * archived by some other route would look like -- so this is the shape the
 * registration path has to survive on its own, independently of the release
 * that `archiveMemberRecord` now performs (pinned in member-service.test.ts).
 */
function archiveLeavingTheKey(accountId: string) {
  database.update(accounts).set({
    archivedAt: NOW,
    updatedAt: NOW,
  }).where(eq(accounts.id, accountId)).run()
}

async function registerOnce(overrides: SendOverrides = {}, now = NOW) {
  const mailer = await send(overrides, now)
  const code = mailer.registration.at(-1)!.code
  return confirm(code, {
    email: overrides.email ?? EMAIL,
    fullName: overrides.fullName ?? NAME,
    security: overrides.security,
  }, now)
}

describe("a member who left and came back", () => {
  it("registers again after being archived, instead of crashing on the identity index", async () => {
    const first = await registerOnce()
    expect(first).not.toBeNull()
    archiveLeavingTheKey(accountRows()[0]!.id)

    // Before the fix this threw a raw UNIQUE constraint failure out of the
    // server action: registrationStandingFor hides an archived row on purpose,
    // so the insert ran and collided with the row still holding the key. The
    // transaction rolled back leaving the code unspent, so every retry -- with a
    // fresh code, forever -- failed exactly the same way.
    const second = await registerOnce({}, new Date(NOW.getTime() + 60 * 60 * 1000))

    expect(second).toMatchObject({ standing: "new" })
    expect(accountRows()).toHaveLength(2)
    expect(accountRows().filter((row) => row.archivedAt === null)).toHaveLength(1)
    assertDatabaseHealthy()
  })

  it("still refuses to say an archived request ever existed", async () => {
    await registerOnce()
    archiveLeavingTheKey(accountRows()[0]!.id)

    // Releasing the key must not turn archiving into a way to read who was once
    // registered: the answer stays the one a genuinely new identity gets.
    const second = await registerOnce({}, new Date(NOW.getTime() + 60 * 60 * 1000))
    expect(second).toMatchObject({ academyId: null, standing: "new" })
  })
})

describe("a name that renders one way and hashes another", () => {
  const INVISIBLES = {
    "bidi override": "‮",
    "soft hyphen": "­",
    "word joiner": "⁠",
    "zero-width joiner": "‍",
    "zero-width non-joiner": "‌",
    "zero-width space": "​",
  }

  for (const [label, character] of Object.entries(INVISIBLES)) {
    it(`does not let a ${label} split one person into two accounts`, async () => {
      await registerOnce()

      const disguised = await registerOnce(
        { fullName: `Arjun${character} Sharma` },
        new Date(NOW.getTime() + 60 * 60 * 1000),
      )

      // Two rows here would be two entries in the coach's queue whose names are
      // indistinguishable on screen -- and a way back into the queue for someone
      // already rejected.
      expect(disguised).toMatchObject({ standing: "pending" })
      expect(accountRows()).toHaveLength(1)
    })
  }

  it("keeps the invisible character out of the stored name as well", async () => {
    await registerOnce({ fullName: `Arjun​ Sharma` })

    // normalized_name is what the finance lists sort on and the CSV exports
    // carry, so a stray format character does not stop at the identity key.
    expect(accountRows()[0]!.fullName).toBe(NAME)
    expect(accountRows()[0]!.normalizedName).toBe("arjun sharma")
  })
})

describe("one inbox, many names", () => {
  it("never lets one requester's junk names silence the address's real owner", async () => {
    const attacker = new CapturingMailer()

    /*
     * The cooldown was scoped to the address alone, which bounded floods and was
     * a lock: a stranger sending under a fresh junk name every sixty seconds
     * silently suppressed every registration and status lookup for the real
     * owner, indefinitely. Reproduced at 241 attacker requests against 24 victim
     * attempts across both doors -- the victim received nothing.
     *
     * It is scoped to (address, identity) now, so a junk identity's send can
     * only ever cool that junk identity.
     */
    for (let draw = 0; draw < 8; draw += 1) {
      await send({ fullName: `Zz Qq${draw}`, mailer: attacker, security: { ipHash: ATTACKER_IP } },
        new Date(NOW.getTime() + draw * 1_000))
    }

    const victim = await send({ mailer: attacker, security: { ipHash: VICTIM_IP } },
      new Date(NOW.getTime() + 9_000))
    expect(victim.registration.at(-1)!.to).toBe(EMAIL)
    expect(confirm(victim.registration.at(-1)!.code, { security: { ipHash: VICTIM_IP } },
      new Date(NOW.getTime() + 9_000))).toMatchObject({ standing: "new" })
  })

  it("still cools a genuine resend for the same identity", async () => {
    const mailer = await send()
    await send({ mailer }, new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS - 1))

    expect(mailer.registration).toHaveLength(1)
  })

  it("does not hold one address closed for another", async () => {
    const mailer = new CapturingMailer()
    for (let draw = 0; draw < 6; draw += 1) {
      await send({ mailer, security: { ipHash: ATTACKER_IP } }, new Date(NOW.getTime() + draw * 1_000))
    }

    const otherAddress = await send({
      email: "second.family@example.com",
      fullName: "Meera Iyer",
      mailer,
      security: { ipHash: VICTIM_IP },
    }, new Date(NOW.getTime() + 7_000))

    expect(otherAddress.registration.at(-1)!.to).toBe("second.family@example.com")
  })

  it("lets one family register three players from one address", async () => {
    const mailer = new CapturingMailer()
    const children = ["Arjun Sharma", "Isha Sharma", "Rohan Sharma"]

    /*
     * The ceiling this replaced counted total sends to an address, so a parent
     * with three children and two mistyped resends silently got nothing on the
     * sixth attempt -- accepted, no mail, no explanation. A minute apart is the
     * only cost now, and the form says so before anyone waits.
     */
    let minute = 0
    const at = () => new Date(NOW.getTime() + (minute += 1) * EMAIL_RESEND_COOLDOWN_MS)
    // Two mistyped resends before the third child, which is what took the old
    // address budget to its limit of five and silently dropped everything after.
    await registerOnce({ fullName: children[0]!, mailer, security: { ipHash: VICTIM_IP } }, at())
    await send({ fullName: children[1]!, mailer, security: { ipHash: VICTIM_IP } }, at())
    await send({ fullName: children[1]!, mailer, security: { ipHash: VICTIM_IP } }, at())
    await send({ fullName: children[1]!, mailer, security: { ipHash: VICTIM_IP } }, at())
    await registerOnce({ fullName: children[1]!, mailer, security: { ipHash: VICTIM_IP } }, at())
    await registerOnce({ fullName: children[2]!, mailer, security: { ipHash: VICTIM_IP } }, at())

    expect(accountRows().map((row) => row.fullName).sort()).toEqual([...children].sort())
  })
})

describe("a stranger who knows only a name and an email", () => {
  it("cannot stop the person who owns the inbox from getting their own code", async () => {
    const attacker = new CapturingMailer()
    for (let draw = 0; draw < 10; draw += 1) {
      await send({ fullName: `Decoy Number ${draw}`, mailer: attacker, security: { ipHash: ATTACKER_IP } },
        new Date(NOW.getTime() + draw * 1_000))
    }
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS + 1_000)

    /*
     * The ceiling this replaced was scoped to the address, which is the half a
     * stranger knows: five junk-name sends from one IP closed registration *and*
     * the status lookup for fifteen minutes, renewably, while both doors said
     * "accepted" -- and the codes that landed were bound to the junk identities,
     * so the address's real owner could not use them either.
     *
     * Now the only ceiling that refuses anyone is the one they spend themselves.
     */
    const victim = await send({ mailer: attacker, security: { ipHash: VICTIM_IP } }, later)
    expect(victim.registration.at(-1)!.to).toBe(EMAIL)
    expect(confirm(victim.registration.at(-1)!.code, { security: { ipHash: VICTIM_IP } }, later))
      .toMatchObject({ standing: "new" })
  })

  it("cannot hold the status lookup closed either", async () => {
    await registerOnce({ security: { ipHash: VICTIM_IP } })
    const attacker = new CapturingMailer()
    for (let draw = 0; draw < 10; draw += 1) {
      await send({ fullName: `Decoy Number ${draw}`, mailer: attacker, security: { ipHash: ATTACKER_IP } },
        new Date(NOW.getTime() + draw * 1_000))
    }
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS + 1_000)

    const lookup = new CapturingMailer()
    await requestRegistrationStatus({
      email: EMAIL,
      fullName: NAME,
      mailer: lookup,
      security: { ipHash: VICTIM_IP },
    }, { database, now: later })

    expect(lookup.registration.at(-1)!.to).toBe(EMAIL)
  })

  it("cannot block the confirm bucket of the person whose inbox holds the code", async () => {
    const victim = await send({ security: { ipHash: VICTIM_IP } })
    const code = victim.registration[0]!.code

    for (let guess = 0; guess < 5; guess += 1) {
      expect(confirm("000000", { security: { ipHash: ATTACKER_IP } })).toBeNull()
    }

    // The stranger's guesses burn this challenge -- that counter is the
    // brute-force limit on the code and is deliberately not IP-scoped -- but the
    // victim must be able to ask for another one and use it straight away.
    expect(confirm(code, { security: { ipHash: VICTIM_IP } })).toBeNull()
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)
    const replacement = await send({ mailer: victim, security: { ipHash: VICTIM_IP } }, later)
    expect(confirm(replacement.registration.at(-1)!.code, { security: { ipHash: VICTIM_IP } }, later))
      .toMatchObject({ standing: "new" })
  })
})

describe("what the public endpoint gives away", () => {
  it("answers a send inside the cooldown exactly as it answers an accepted one", async () => {
    const mailer = await send()
    const cooling = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS - 1)

    // Three distinguishable replies used to come back here -- accepted, "wait one
    // minute", "wait a few minutes" -- the last two skipping the timing floor
    // the accepted branch holds. That is a live activity monitor for any name
    // and address someone can guess.
    await expect(send({ mailer }, cooling)).resolves.toBeDefined()
    expect(mailer.registration).toHaveLength(1)
  })
})

describe("when the mail does not go out", () => {
  it("leaves the code that was already working alone", async () => {
    const mailer = await send()
    const working = mailer.registration[0]!.code
    const later = new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS)

    await expect(send({ mailer: new FailingMailer() }, later))
      .rejects.toThrow("simulated delivery failure")

    // Superseding before delivery left the person with nothing: the supersede had
    // committed, and consuming the undelivered challenge is not a restore.
    expect(confirm(working, {}, later)).toMatchObject({ standing: "new" })
    assertDatabaseHealthy()
  })
})

describe("what a registration flood must not reach", () => {
  it("never spends the bucket that decides whether anyone can sign in", async () => {
    const mailer = new CapturingMailer()
    const unrelated = {
      ipHash: ATTACKER_IP,
      subjectHash: authSubjectHash(normalizeAcademyId("SMBA-PL-0004")),
    }

    /*
     * `attemptKeys` writes `ip:<hash>` from whatever it is handed, and the
     * sign-in paths hand it the raw hash from requestSecurityContext -- so the
     * registration throttle passing that same raw hash through put an
     * unauthenticated endpoint in charge of the twenty-per-fifteen-minutes
     * budget that governs password and PIN sign-in. One send used to cost two of
     * those twenty, so ten sends from an academy's wifi or a carrier NAT locked
     * out every unrelated person behind it.
     */
    // Distinct addresses so no address cooldown participates, and inside one
    // window so the count actually accumulates -- 24 sends used to charge that
    // shared bucket 48 times against a threshold of 20.
    for (let draw = 0; draw < 24; draw += 1) {
      await send({
        email: `family-${draw}@example.com`,
        fullName: `Player Number ${draw}`,
        mailer,
        security: { ipHash: ATTACKER_IP },
      }, new Date(NOW.getTime() + draw * 1_000))
    }

    expect(loginIsBlocked(unrelated, { database, now: new Date(NOW.getTime() + 25_000) })).toBe(false)
  })
})

describe("a name in a script where the joiners are letters", () => {
  it("keeps ZWJ and ZWNJ in the name the academy stores and prints", async () => {
    // <la, virama, ZWJ> is how Malayalam writes a chillu, and ZWNJ is how
    // Devanagari keeps a halant visible instead of forming a conjunct. Stripping
    // them rewrote the name to a different word in the CSV exports and on the
    // coach's screen.
    const chillu = "ഗോപാല്‍ Menon"
    await registerOnce({ fullName: chillu, email: "menon@example.com" })

    expect(accountRows()[0]!.fullName).toBe(chillu)
  })

  it("still treats the two spellings of one Malayalam name as one person", async () => {
    await registerOnce({ fullName: "ഗോപാല്‍ Menon", email: "menon@example.com" })

    // The ZWJ chillu and the atomic chillu render identically and NFKC does not
    // unify them, so without folding them in the key the duplicate walks through.
    const again = await registerOnce(
      { fullName: "ഗോപാൽ Menon", email: "menon@example.com" },
      new Date(NOW.getTime() + EMAIL_RESEND_COOLDOWN_MS),
    )

    expect(again).toMatchObject({ standing: "pending" })
    expect(accountRows()).toHaveLength(1)
  })
})
