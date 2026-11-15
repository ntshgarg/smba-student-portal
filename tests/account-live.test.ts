import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { isAccountLive, type AccountLiveFacts } from "@/lib/auth/account-live"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-account-live-test-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-account-live.db")

/*
 * Whether an account may sign in or act was decided by about twenty separate
 * checks that agreed only because archiving changes three things at once.
 * isAccountLive / accountIsLive is now the one rule every door reads; these pin
 * it and prove the code and the query condition agree on every kind of account.
 */
const at = new Date("2026-08-01T10:00:00+05:30")
const live: AccountLiveFacts = { approvalStatus: "approved", archivedAt: null }

const cases: Array<{ id: string; facts: AccountLiveFacts; method?: "live" | "revoked"; live: boolean }> = [
  { id: "live", facts: { ...live, credentialStatus: "active" }, method: "live", live: true },
  { id: "first-sign-in-owed", facts: { ...live, credentialStatus: "pending" }, method: "live", live: true },
  { id: "no-method-or-credential-row", facts: live, live: true },
  { id: "pending-approval", facts: { ...live, approvalStatus: "pending" }, live: false },
  { id: "rejected", facts: { ...live, approvalStatus: "rejected" }, live: false },
  { id: "archived", facts: { ...live, archivedAt: at, credentialStatus: "revoked" }, method: "revoked", live: false },
  { id: "academy-id-revoked-only", facts: { ...live, academyIdRevokedAt: at, credentialStatus: "active" }, method: "revoked", live: false },
  { id: "credential-revoked-only", facts: { ...live, credentialStatus: "revoked" }, method: "live", live: false },
]

describe("whether an account is live", () => {
  it.each(cases)("$id", ({ facts, live: expected }) => {
    expect(isAccountLive(facts)).toBe(expected)
  })

  describe("as a query condition", () => {
    let database: ReturnType<typeof import("@/lib/db/client")["initializeDatabase"]>
    let schema: typeof import("@/lib/db/schema")
    let accountIsLive: typeof import("@/lib/auth/account-live")["accountIsLive"]

    beforeAll(async () => {
      schema = await import("@/lib/db/schema")
      accountIsLive = (await import("@/lib/auth/account-live")).accountIsLive
      const { prepareDatabase } = await import("@/lib/db/setup")
      database = prepareDatabase({ seed: true })
      cases.forEach(({ facts, id, method }, index) => {
        database.insert(schema.accounts).values({
          approvalStatus: facts.approvalStatus,
          archivedAt: facts.archivedAt,
          createdAt: at,
          fullName: `Account ${id}`,
          id,
          normalizedName: `account ${id}`,
          requestedRole: "player",
          role: facts.approvalStatus === "approved" ? "player" : null,
          updatedAt: at,
        }).run()
        if (method) {
          database.insert(schema.authMethods).values({
            accountId: id,
            createdAt: at,
            id: `method-${id}`,
            identifier: `SMBA-PL-${String(9000 + index)}`,
            method: "academy_id",
            revokedAt: method === "revoked" ? at : null,
          }).run()
        }
        if (facts.credentialStatus) {
          database.insert(schema.authCredentialStates).values({
            accountId: id,
            status: facts.credentialStatus,
            updatedAt: at,
          }).run()
        }
      })
    })

    afterAll(() => {
      fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    })

    it("lists exactly the accounts the code calls live", () => {
      const fromQuery = database.select({ id: schema.accounts.id }).from(schema.accounts)
        .where(accountIsLive()).all().map((row) => row.id)
      const ours = new Set(cases.map(({ id }) => id))
      expect(fromQuery.filter((id) => ours.has(id)).sort())
        .toEqual(cases.filter(({ live: expected }) => expected).map(({ id }) => id).sort())
    })

    it("agrees when the query already joins the sign-in tables", () => {
      const fromQuery = database.select({ id: schema.accounts.id }).from(schema.authMethods)
        .innerJoin(schema.accounts, eq(schema.authMethods.accountId, schema.accounts.id))
        .where(accountIsLive()).all().map((row) => row.id)
      const ours = new Set(cases.map(({ id }) => id))
      expect(fromQuery.filter((id) => ours.has(id)).sort()).toEqual(["first-sign-in-owed", "live"])
    })
  })
})
