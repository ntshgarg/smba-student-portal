import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { symmetricDecrypt } from "better-auth/crypto"
import { createOTP } from "@better-auth/utils/otp"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

/*
 * The two head-coach sign-in loopholes the state-machine audit of 12 Nov 2026
 * found, run against the real Better Auth plugin rather than a stand-in: each
 * case first shows the library doing what made the loophole possible, then
 * that lib/auth/second-factor-reset.ts closes it.
 */
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-second-factor-reset-"))
const databasePath = path.join(temporaryDirectory, "auth.db")
const coachAccountId = "00000000-0000-4000-8000-000000000001"
const password = "SMBA local access 2026!"

function cookieNamed(headers: Headers, name: string) {
  return headers.getSetCookie()
    .filter((cookie) => cookie.startsWith(`smba.${name}=`) && !cookie.includes("Max-Age=0"))
    .at(-1)
    ?.split(";")[0] ?? ""
}

async function currentCode() {
  const database = new Database(databasePath, { readonly: true })
  const row = database.prepare("select secret from auth_two_factors where user_id = ?")
    .get(coachAccountId) as { secret: string }
  database.close()
  const secret = await symmetricDecrypt({ data: row.secret, key: process.env.BETTER_AUTH_SECRET! })
  return createOTP(secret).totp()
}

describe("a changed authenticator starts clean", () => {
  let auth: typeof import("@/lib/auth/better-auth")["auth"]
  let reset: typeof import("@/lib/auth/second-factor-reset")

  async function signIn(cookie = "") {
    return auth.api.signInUsername({
      body: { password, username: "SMBA#0001" },
      headers: new Headers({ cookie }),
      returnHeaders: true,
    })
  }

  async function sessionUser(cookie: string) {
    return (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user ?? null
  }

  beforeAll(async () => {
    process.env.DB_FILE_NAME = databasePath
    process.env.BETTER_AUTH_SECRET = "test-only-runtime-secret-with-more-than-32-characters"
    process.env.SMBA_LOCAL_AUTH_PASSWORD = password
    process.env.SMBA_REQUIRE_COACH_TOTP = "false"
    const { prepareDatabase } = await import("@/lib/db/setup")
    prepareDatabase({ seed: true })
    auth = (await import("@/lib/auth/better-auth")).auth
    reset = await import("@/lib/auth/second-factor-reset")
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    delete process.env.DB_FILE_NAME
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.SMBA_LOCAL_AUTH_PASSWORD
    delete process.env.SMBA_REQUIRE_COACH_TOTP
  })

  it("ends sign-ins made while the account had no authenticator once one is connected", async () => {
    // Someone with the password signs in while no authenticator is connected.
    const intruder = cookieNamed((await signIn()).headers, "session_token")
    expect(await sessionUser(intruder)).toMatchObject({ twoFactorEnabled: false })

    // The head coach connects a new authenticator from their own device.
    const coach = cookieNamed((await signIn()).headers, "session_token")
    const enabled = await auth.api.enableTwoFactor({
      body: { password },
      headers: new Headers({ cookie: coach }),
      returnHeaders: true,
    })
    const enrolling = cookieNamed(enabled.headers, "session_token") || coach
    await new Promise((resolve) => setTimeout(resolve, 5))
    const connectedAt = new Date()
    const confirmed = await auth.api.verifyTOTP({
      body: { code: await currentCode(), trustDevice: false },
      headers: new Headers({ cookie: enrolling }),
      returnHeaders: true,
    })
    const coachAfter = cookieNamed(confirmed.headers, "session_token")

    // What the library does on its own: the earlier sign-in is now a full
    // session for an account with an authenticator, with no code ever entered.
    expect(await sessionUser(intruder)).toMatchObject({ twoFactorEnabled: true })

    expect(reset.endSessionsStartedBefore(coachAccountId, connectedAt)).toBeGreaterThan(0)
    expect(await sessionUser(intruder)).toBeNull()
    // The device that connected the authenticator keeps its fresh session.
    expect(await sessionUser(coachAfter)).toMatchObject({ twoFactorEnabled: true })
  })

  it("stops a trusted browser skipping the code once trusted browsers are forgotten", async () => {
    // A phone signs in with the code and ticks "trust this device".
    const challenged = await signIn()
    expect(challenged.response).toMatchObject({ twoFactorRedirect: true })
    const trusted = await auth.api.verifyTOTP({
      body: { code: await currentCode(), trustDevice: true },
      headers: new Headers({ cookie: cookieNamed(challenged.headers, "two_factor") }),
      returnHeaders: true,
    })
    const trustCookie = cookieNamed(trusted.headers, "trust_device")
    expect(trustCookie).not.toBe("")

    // What the library does on its own: with the trust cookie and the saved
    // password, the phone gets straight in.
    const skipped = await signIn(trustCookie)
    expect(skipped.response).not.toMatchObject({ twoFactorRedirect: true })
    const renewedTrust = cookieNamed(skipped.headers, "trust_device") || trustCookie

    expect(reset.forgetTrustedDevices(coachAccountId)).toBeGreaterThan(0)
    expect(await signIn(renewedTrust).then((result) => result.response))
      .toMatchObject({ twoFactorRedirect: true })
  })
})
