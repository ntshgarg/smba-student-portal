import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-registration-review-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

import type {
  AuthenticatorRecoveryMessage,
  AuthMailer,
  PasswordRecoveryMessage,
  RecoveryEmailVerificationMessage,
  RegistrationVerificationMessage,
} from "@/lib/auth/mailer"

class CapturingMailer implements AuthMailer {
  registration: RegistrationVerificationMessage[] = []
  async sendAcademyIdIssued() {}
  async sendAuthenticatorRecovery(message: AuthenticatorRecoveryMessage) { void message }
  async sendPasswordRecovery(message: PasswordRecoveryMessage) { void message }
  async sendRecoveryEmailVerification(message: RecoveryEmailVerificationMessage) { void message }
  async sendRegistrationVerification(message: RegistrationVerificationMessage) {
    this.registration.push(message)
  }
}

/** One minute and a bit: past the resend cooldown, so every send really mails. */
const STEP_MS = 61_000

describe("registration review lifecycle", () => {
  let accountService: typeof import("@/lib/auth/account-service")
  let credentialService: typeof import("@/lib/auth/credential-service")
  let coachDatabase: typeof import("@/lib/coach/database")
  let memberService: typeof import("@/lib/coach/member-service")
  let actionResults: typeof import("@/lib/actions/operational-result")
  let schema: typeof import("@/lib/db/schema")
  let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
  let coachId: string
  let clock = Date.now()

  function tick() {
    clock += STEP_MS
    return new Date(clock)
  }

  /** Sends and confirms a registration the way the form does, returning the reply and the receipt. */
  async function register(fullName: string, email: string, dateOfBirth = "2014-03-11") {
    const mailer = new CapturingMailer()
    const now = tick()
    const details = {
      dateOfBirth,
      email,
      fullName,
      phone: "+91 98765 43210",
      requestedRole: "player" as const,
    }
    await accountService.requestRegistration({ ...details, mailer }, { database, now })
    const activationToken = credentialService.createActivationClaimToken()
    const reply = accountService.confirmRegistration({
      ...details,
      activationToken,
      code: mailer.registration.at(-1)!.code,
    }, { database, now })
    return { activationToken, mailer, reply }
  }

  function accountIdFor(fullName: string) {
    return database.select({ id: schema.accounts.id }).from(schema.accounts)
      .where(and(eq(schema.accounts.fullName, fullName), eq(schema.accounts.approvalStatus, "pending")))
      .get()?.id
  }

  function securityEvents(accountId: string) {
    return database.select({
      actorAccountId: schema.authSecurityEvents.actorAccountId,
      eventType: schema.authSecurityEvents.eventType,
    }).from(schema.authSecurityEvents)
      .where(eq(schema.authSecurityEvents.accountId, accountId))
      .all()
  }

  beforeAll(async () => {
    accountService = await import("@/lib/auth/account-service")
    credentialService = await import("@/lib/auth/credential-service")
    coachDatabase = await import("@/lib/coach/database")
    memberService = await import("@/lib/coach/member-service")
    actionResults = await import("@/lib/actions/operational-result")
    schema = await import("@/lib/db/schema")
    const { prepareDatabase } = await import("@/lib/db/setup")
    database = prepareDatabase({ seed: true })
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed head coach was not created.")
    coachId = coach.accountId
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  describe("a rejected request", () => {
    /*
     * Rejecting used to be final and invisible: the identity kept answering
     * "not accepted" for good, nothing listed rejected requests, and nothing
     * could change one back. One mis-tap locked a family out.
     */
    it("is listed for the head coach and can be put back in the review queue", async () => {
      const { activationToken } = await register("Mira Rao", "mira.family@example.com")
      const requestId = accountIdFor("Mira Rao")!
      const rejectedAt = tick()
      accountService.rejectRegistration(requestId, coachId, { database, now: rejectedAt })

      expect(accountService.listRejectedRegistrations({ database })).toEqual([
        expect.objectContaining({
          contactEmail: "mira.family@example.com",
          fullName: "Mira Rao",
          id: requestId,
          rejectedAt: rejectedAt.toISOString(),
          requestedRole: "player",
        }),
      ])
      expect(credentialService.getActivationClaimStatus(activationToken, { database, now: tick() }))
        .toEqual({ state: "rejected" })
      // The family's own retry still answers "not accepted" while it stands.
      expect((await register("Mira Rao", "mira.family@example.com")).reply)
        .toMatchObject({ standing: "rejected" })

      accountService.undoRegistrationRejection(requestId, coachId, { database, now: tick() })

      const row = database.select().from(schema.accounts)
        .where(eq(schema.accounts.id, requestId)).get()!
      expect(row).toMatchObject({ approvalStatus: "pending", rejectedAt: null, rejectedByAccountId: null })
      expect(accountService.listRejectedRegistrations({ database })).toEqual([])
      expect(coachDatabase.getPlayerOnboardingWorkspace().cases)
        .toContainEqual(expect.objectContaining({ id: requestId, stage: "request" }))
      // Rejecting removed nothing, so the receipt the family's browser holds works again.
      expect(credentialService.getActivationClaimStatus(activationToken, { database, now: tick() }))
        .toMatchObject({ accountId: requestId, state: "pending" })
      expect((await register("Mira Rao", "mira.family@example.com")).reply)
        .toMatchObject({ standing: "pending" })
      // Exactly one request: undo restores the row rather than opening a second one.
      expect(database.select().from(schema.accounts)
        .where(eq(schema.accounts.fullName, "Mira Rao")).all()).toHaveLength(1)

      expect(securityEvents(requestId)).toEqual(expect.arrayContaining([
        { actorAccountId: coachId, eventType: "registration_rejected" },
        { actorAccountId: coachId, eventType: "registration_rejection_undone" },
      ]))

      // Approval is still its own step afterwards, and it works.
      const approved = accountService.approveRegistration(requestId, coachId, { now: tick() })
      expect(approved.accountId).toBe(requestId)
      expect(securityEvents(requestId))
        .toContainEqual({ actorAccountId: coachId, eventType: "registration_approved" })
    })

    it("cannot be undone twice, and nothing that is not rejected can be 'undone'", async () => {
      await register("Dev Shah", "dev.family@example.com")
      const requestId = accountIdFor("Dev Shah")!

      expect(() => accountService.undoRegistrationRejection(requestId, coachId, { database }))
        .toThrow(actionResults.OperationalActionError)

      accountService.rejectRegistration(requestId, coachId, { database, now: tick() })
      accountService.undoRegistrationRejection(requestId, coachId, { database, now: tick() })
      expect(() => accountService.undoRegistrationRejection(requestId, coachId, { database }))
        .toThrow("This request is no longer rejected.")
      expect(database.select({ status: schema.accounts.approvalStatus }).from(schema.accounts)
        .where(eq(schema.accounts.id, requestId)).get()?.status).toBe("pending")
    })
  })

  describe("the duplicate hint on a new request", () => {
    /*
     * Archiving frees a member's identity so they can register again, and the
     * hint compared only pending requests and current players -- so a family
     * coming back looked like strangers, and their old Academy ID, attendance
     * and fees sat unmentioned on the archived record.
     */
    it("points a returning ex-member at their archived record", async () => {
      await register("Kiran Rao", "kiran.family@example.com", "2013-05-02")
      const formerId = accountIdFor("Kiran Rao")!
      const former = accountService.approveRegistration(formerId, coachId, { now: tick() })
      expect(memberService.archiveMemberRecord({
        coachId,
        database,
        input: { expectedRevision: 0, memberId: formerId },
        now: tick(),
      })).toMatchObject({ ok: true })
      expect(securityEvents(formerId))
        .toContainEqual({ actorAccountId: coachId, eventType: "account_archived" })

      const { reply } = await register("Kiran Rao", "kiran.family@example.com", "2013-05-02")
      expect(reply).toMatchObject({ standing: "new" })
      const returningId = accountIdFor("Kiran Rao")!
      expect(returningId).not.toBe(formerId)

      const request = coachDatabase.getPlayerOnboardingWorkspace().cases
        .find((item) => item.id === returningId)
      expect(request?.duplicateSignals).toContainEqual({
        academyId: former.academyId,
        fullName: "Kiran Rao",
        reason: "same-contact",
        standing: "archived",
      })
    })
  })

  describe("the registration door for a player ready to set a password", () => {
    /*
     * The registration door said "create a password" for this standing but
     * minted no receipt, so without the original browser /activate asked for
     * the name, email and a second code again. The status door already handed
     * the password step over; now both do.
     */
    it("hands this browser the receipt, so the password step is offered on the spot", async () => {
      await register("Neel Bose", "neel.family@example.com")
      const accountId = accountIdFor("Neel Bose")!
      accountService.approveRegistration(accountId, coachId, { now: tick() })
      database.update(schema.playerEnrollments).set({ onboardingCompletedAt: new Date(clock) })
        .where(eq(schema.playerEnrollments.accountId, accountId)).run()

      const { activationToken, reply } = await register("Neel Bose", "neel.family@example.com")

      expect(reply).toMatchObject({ activated: false, onboardingCompleted: true, standing: "approved" })
      expect(credentialService.getActivationClaimStatus(activationToken, { database, now: tick() }))
        .toMatchObject({ accountId, state: "approved" })
    })

    it("hands nothing over while the coach is still setting up training", async () => {
      await register("Ira Das", "ira.family@example.com")
      const accountId = accountIdFor("Ira Das")!
      accountService.approveRegistration(accountId, coachId, { now: tick() })

      const { activationToken, reply } = await register("Ira Das", "ira.family@example.com")

      expect(reply).toMatchObject({ onboardingCompleted: false, standing: "approved" })
      expect(credentialService.getActivationClaimStatus(activationToken, { database, now: tick() }))
        .toEqual({ state: "missing" })
    })
  })

  it("words the status-check email as a status check", async () => {
    const mailer = new CapturingMailer()
    await accountService.requestRegistrationStatus({
      email: "nobody.here@example.com",
      fullName: "Nobody Here",
      mailer,
    }, { database, now: tick() })

    expect(mailer.registration.at(-1)).toMatchObject({ purpose: "status", standing: "new" })
  })
})
