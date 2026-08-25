import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash, createHmac } from "node:crypto"

import Database from "better-sqlite3"
import { symmetricDecrypt } from "better-auth/crypto"
import { createOTP } from "@better-auth/utils/otp"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-auth-runtime-"))
const databasePath = path.join(temporaryDirectory, "auth.db")
/** The seeded head coach every case here signs in as. */
const coachAccountId = "00000000-0000-4000-8000-000000000001"

function sessionCookie(headers: Headers) {
  return headers.getSetCookie()
    .filter((cookie) => cookie.startsWith("smba.session_token=") && !cookie.includes("Max-Age=0"))
    .at(-1)
    ?.split(";")[0] ?? ""
}

/**
 * auth_login_attempts is one budget shared by every factor and every case in
 * this file, and the two lockout cases below both count refusals of the same
 * seeded coach exactly. Any earlier case that spends a failure against
 * SMBA#0001 -- "rejects an incorrect password through the same adapter" spends
 * one -- would otherwise shift where the fifth failure lands and lock the
 * account an attempt early.
 */
function clearLoginAttempts() {
  const database = new Database(databasePath)
  database.prepare("delete from auth_login_attempts").run()
  database.close()
}

describe("Better Auth runtime adapter", () => {
  let auth: typeof import("@/lib/auth/better-auth")["auth"]
  let coachTotpRequired: typeof import("@/lib/auth/better-auth")["coachTotpRequired"]
  let principalTotpRequired: typeof import("@/lib/auth/better-auth")["principalTotpRequired"]

  beforeAll(async () => {
    process.env.DB_FILE_NAME = databasePath
    process.env.BETTER_AUTH_SECRET = "test-only-runtime-secret-with-more-than-32-characters"
    process.env.SMBA_LOCAL_AUTH_PASSWORD = "SMBA local access 2026!"
    process.env.SMBA_REQUIRE_COACH_TOTP = "false"
    const { prepareDatabase } = await import("@/lib/db/setup")
    prepareDatabase({ seed: true })
    const betterAuth = await import("@/lib/auth/better-auth")
    auth = betterAuth.auth
    coachTotpRequired = betterAuth.coachTotpRequired
    principalTotpRequired = betterAuth.principalTotpRequired
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    delete process.env.DB_FILE_NAME
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.SMBA_LOCAL_AUTH_PASSWORD
    delete process.env.SMBA_REQUIRE_COACH_TOTP
  })

  it("authenticates the seeded Academy ID through the real credential adapter", async () => {
    const signedIn = await auth.api.signInUsername({
      body: {
        password: "SMBA local access 2026!",
        username: "smba#0001",
      },
      headers: new Headers(),
      returnHeaders: true,
    })
    expect(signedIn.response).toMatchObject({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "SMBA#0001",
      },
    })
    const setCookie = signedIn.headers.get("set-cookie")
    expect(setCookie).toContain("smba.session_token=")
    const cookieHeader = sessionCookie(signedIn.headers)
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader ?? "" }),
    })
    expect(session).toMatchObject({
      session: { userId: "00000000-0000-4000-8000-000000000001" },
      user: { username: "SMBA#0001" },
    })
  })

  it("enrols and verifies the coach authenticator factor through the real plugin schema", async () => {
    const signedIn = await auth.api.signInUsername({
      body: {
        password: "SMBA local access 2026!",
        username: "SMBA#0001",
      },
      headers: new Headers(),
      returnHeaders: true,
    })
    const initialSessionCookie = sessionCookie(signedIn.headers)
    const requestHeaders = new Headers({ cookie: initialSessionCookie })
    const enableResult = await auth.api.enableTwoFactor({
      body: { password: "SMBA local access 2026!" },
      headers: requestHeaders,
      returnHeaders: true,
    })
    const enabled = enableResult.response
    if (enabled.method !== "totp") throw new Error("Expected a TOTP authenticator enrolment.")
    const rotatedSessionCookie = sessionCookie(enableResult.headers) || initialSessionCookie
    const verificationHeaders = new Headers({ cookie: rotatedSessionCookie })
    expect(enabled.backupCodes.length).toBeGreaterThan(0)
    const secret = new URL(enabled.totpURI).searchParams.get("secret")
    expect(secret).toBeTruthy()
    const sqlite = new Database(databasePath, { readonly: true })
    const encrypted = sqlite.prepare("select secret from auth_two_factors limit 1").get() as {
      secret: string
    }
    sqlite.close()
    const storedSecret = await symmetricDecrypt({
      data: encrypted.secret,
      key: process.env.BETTER_AUTH_SECRET!,
    })
    expect(storedSecret).toBeTruthy()
    const generated = await createOTP(storedSecret).totp()
    const verified = await auth.api.verifyTOTP({
      body: { code: generated, trustDevice: true },
      headers: verificationHeaders,
      returnHeaders: true,
    })
    expect(verified.response).toMatchObject({
      user: { id: "00000000-0000-4000-8000-000000000001" },
    })
    const finalSessionCookie = sessionCookie(verified.headers)
    await expect(auth.api.getSession({
      headers: new Headers({ cookie: finalSessionCookie }),
    })).resolves.toMatchObject({
      user: { twoFactorEnabled: true },
    })
  })

  it("requires the coach authenticator after a successful PIN sign-in", async () => {
    const passwordSignIn = await auth.api.signInUsername({
      body: {
        password: "SMBA local access 2026!",
        username: "SMBA#0001",
      },
      headers: new Headers(),
      returnHeaders: true,
    })
    expect(passwordSignIn.response).toMatchObject({ twoFactorRedirect: true })
    const passwordTwoFactorCookie = passwordSignIn.headers.getSetCookie()
      .find((cookie) => cookie.startsWith("smba.two_factor="))
      ?.split(";")[0] ?? ""
    const passwordSecretDatabase = new Database(databasePath, { readonly: true })
    const passwordEncrypted = passwordSecretDatabase
      .prepare("select secret from auth_two_factors limit 1").get() as { secret: string }
    passwordSecretDatabase.close()
    const passwordSecret = await symmetricDecrypt({
      data: passwordEncrypted.secret,
      key: process.env.BETTER_AUTH_SECRET!,
    })
    await expect(auth.api.verifyTOTP({
      body: { code: await createOTP(passwordSecret).totp(), trustDevice: false },
      headers: new Headers({ cookie: passwordTwoFactorCookie }),
    })).resolves.toMatchObject({
      user: { id: "00000000-0000-4000-8000-000000000001" },
    })

    const { setPinCredential } = await import("@/lib/auth/credential-service")
    await setPinCredential({
      accountId: "00000000-0000-4000-8000-000000000001",
      pin: "246810",
    })

    const pinSignIn = await auth.api.signInPin({
      body: { pin: "246810", username: "SMBA#0001" },
      headers: new Headers(),
      returnHeaders: true,
    })
    expect(pinSignIn.response).toMatchObject({
      twoFactorRedirect: true,
      user: { id: "00000000-0000-4000-8000-000000000001" },
    })
    expect(pinSignIn.headers.get("set-cookie")).toContain("smba.two_factor=")
    expect(pinSignIn.headers.get("set-cookie")).not.toContain("smba.session_token=")

    const twoFactorCookie = pinSignIn.headers.getSetCookie()
      .find((cookie) => cookie.startsWith("smba.two_factor="))
      ?.split(";")[0] ?? ""
    const sqlite = new Database(databasePath, { readonly: true })
    const pendingChallenges = sqlite.prepare("select count(*) as count from auth_verifications").get() as {
      count: number
    }
    expect(pendingChallenges.count).toBe(2)
    const signedChallenge = decodeURIComponent(twoFactorCookie.split("=")[1] ?? "")
    const challengeIdentifier = signedChallenge.split(".")[0]
    const suppliedSignature = signedChallenge.slice(challengeIdentifier.length + 1)
    expect(suppliedSignature).toBe(
      createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
        .update(challengeIdentifier)
        .digest("base64"),
    )
    const storedChallenge = sqlite.prepare("select identifier from auth_verifications where value = ?")
      .get("00000000-0000-4000-8000-000000000001") as { identifier: string }
    expect(storedChallenge.identifier).toBe(
      createHash("sha256").update(challengeIdentifier).digest("base64url"),
    )
    const encrypted = sqlite.prepare("select secret from auth_two_factors limit 1").get() as {
      secret: string
    }
    sqlite.close()
    const storedSecret = await symmetricDecrypt({
      data: encrypted.secret,
      key: process.env.BETTER_AUTH_SECRET!,
    })
    const generated = await createOTP(storedSecret).totp()
    const verified = await auth.api.verifyTOTP({
      body: { code: generated, trustDevice: false },
      headers: new Headers({ cookie: twoFactorCookie }),
      returnHeaders: true,
    })
    expect(verified.response).toMatchObject({
      user: { id: "00000000-0000-4000-8000-000000000001" },
    })
    expect(sessionCookie(verified.headers)).toContain("smba.session_token=")
  })

  /**
   * F-8. /account/security reissues recovery codes through
   * `generateBackupCodes` and states the unused count from `viewBackupCodes`.
   * Both claims are the plugin's behaviour rather than ours, so they are held
   * here: that spending a code shortens the stored set, and that reissuing
   * disturbs neither the enrolled secret nor another device's session -- which
   * is exactly what reusing `beginAuthenticatorReconnect` would have done.
   */
  it("reissues the recovery codes without disturbing the factor or other devices", async () => {
    const beforeDatabase = new Database(databasePath, { readonly: true })
    const encrypted = beforeDatabase
      .prepare("select secret from auth_two_factors limit 1").get() as { secret: string }
    beforeDatabase.close()
    const storedSecret = await symmetricDecrypt({
      data: encrypted.secret,
      key: process.env.BETTER_AUTH_SECRET!,
    })

    async function signedInDevice() {
      const signIn = await auth.api.signInUsername({
        body: { password: "SMBA local access 2026!", username: "SMBA#0001" },
        headers: new Headers(),
        returnHeaders: true,
      })
      const challenge = signIn.headers.getSetCookie()
        .find((cookie) => cookie.startsWith("smba.two_factor="))
        ?.split(";")[0] ?? ""
      const verified = await auth.api.verifyTOTP({
        body: { code: await createOTP(storedSecret).totp(), trustDevice: false },
        headers: new Headers({ cookie: challenge }),
        returnHeaders: true,
      })
      return new Headers({ cookie: sessionCookie(verified.headers) })
    }

    const thisDevice = await signedInDevice()
    const courtsideTablet = await signedInDevice()

    const before = await auth.api.viewBackupCodes({ body: { userId: coachAccountId } })
    await auth.api.verifyBackupCode({
      body: { code: before.backupCodes[0], disableSession: false, trustDevice: false },
      headers: thisDevice,
    })
    const afterOneUse = await auth.api.viewBackupCodes({ body: { userId: coachAccountId } })
    expect(afterOneUse.backupCodes).toHaveLength(before.backupCodes.length - 1)

    // The reissue gate re-checks a second factor against this signed-in
    // session before it mints anything. The plugin hands back the session it
    // was given rather than creating one, so the check cannot sign a device
    // out or rotate the cookie underneath the coach.
    const reverified = await auth.api.verifyTOTP({
      body: { code: await createOTP(storedSecret).totp(), trustDevice: false },
      headers: thisDevice,
      returnHeaders: true,
    })
    expect(reverified.headers.getSetCookie()).toEqual([])

    const reissued = await auth.api.generateBackupCodes({
      body: { password: "SMBA local access 2026!" },
      headers: thisDevice,
      returnHeaders: true,
    })

    // No Set-Cookie at all, so no session was rotated or dropped.
    expect(reissued.headers.getSetCookie()).toEqual([])
    await expect(auth.api.getSession({ headers: courtsideTablet }))
      .resolves.toMatchObject({ user: { twoFactorEnabled: true } })
    const afterDatabase = new Database(databasePath, { readonly: true })
    const afterSecret = afterDatabase
      .prepare("select secret from auth_two_factors limit 1").get() as { secret: string }
    afterDatabase.close()
    expect(afterSecret.secret).toBe(encrypted.secret)

    await expect(auth.api.viewBackupCodes({ body: { userId: coachAccountId } }))
      .resolves.toMatchObject({ backupCodes: reissued.response.backupCodes })
    await expect(auth.api.verifyBackupCode({
      body: { code: before.backupCodes[1], disableSession: false, trustDevice: false },
      headers: thisDevice,
    })).rejects.toThrow()
  })

  it("rejects an incorrect password through the same adapter", async () => {
    await expect(auth.api.signInUsername({
      body: {
        password: "this is not the password",
        username: "SMBA#0001",
      },
      headers: new Headers(),
    })).rejects.toThrow()
  })

  // The regression test for the PIN endpoint bypass. POST /api/auth/sign-in/pin
  // is served publicly by app/api/auth/[...all]/route.ts, so it must spend the
  // same account/IP budget the login form does. When the guard lived only in
  // `loginWithPin`, this endpoint recorded nothing: fifty wrong PINs left
  // auth_login_attempts empty and the account unlocked, which left a six-digit
  // PIN on a minor's account open to unlimited guessing with nothing written for
  // check-security-signals.mjs to alert on. Driven through the real auth
  // instance, not a mock, because a mock is exactly what hid this.
  it("spends the shared account lockout on direct PIN sign-in attempts", async () => {
    clearLoginAttempts()
    const { auth } = await import("@/lib/auth/better-auth").then(async (module) => ({
      auth: module.getAuth(),
    }))
    const { setPinCredential } = await import("@/lib/auth/credential-service")
    await setPinCredential({
      accountId: "00000000-0000-4000-8000-000000000001",
      pin: "246810",
    })

    const attemptHeaders = new Headers({ "x-forwarded-for": "203.0.113.77" })
    const refusals: string[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await auth.api.signInPin({
          body: { pin: "999999", username: "SMBA#0001" },
          headers: attemptHeaders,
        })
        refusals.push("accepted")
      } catch (error) {
        refusals.push(String((error as { status?: unknown }).status ?? "unknown"))
      }
    }

    // No wrong PIN may ever be accepted, and the budget must run out rather than
    // refusing identically for ever: the fifth failure locks the account, so the
    // sixth is refused as rate limiting rather than as a bad credential.
    expect(refusals).not.toContain("accepted")
    expect(refusals.at(-1)).toBe("TOO_MANY_REQUESTS")
    expect(refusals.filter((status) => status === "UNAUTHORIZED").length).toBe(5)

    // The attempts have to be durable, or check-security-signals.mjs stays blind.
    const attemptsDatabase = new Database(databasePath, { readonly: true })
    const attempts = attemptsDatabase
      .prepare("select count(*) as count from auth_login_attempts").get() as { count: number }
    const events = attemptsDatabase
      .prepare("select count(*) as count from auth_security_events where event_type = ?")
      .get("login_rate_limited") as { count: number }
    attemptsDatabase.close()
    expect(attempts.count).toBeGreaterThan(0)
    expect(events.count).toBeGreaterThan(0)

    // A correct PIN must not slip through the lock either.
    await expect(auth.api.signInPin({
      body: { pin: "246810", username: "SMBA#0001" },
      headers: attemptHeaders,
    })).rejects.toThrow()
  })

  // The regression test for the password endpoint bypass, the twin of the PIN
  // one above. POST /api/auth/sign-in/username is served publicly by
  // app/api/auth/[...all]/route.ts, so it must spend the same account/IP budget
  // the login form does. When the guard lived only in `loginWithAcademyId`,
  // the six wrong passwords below answered UNAUTHORIZED six times and left both
  // auth_login_attempts and auth_security_events empty, so nothing locked and
  // check-security-signals.mjs -- which alerts on `login_rate_limited` -- never
  // saw the run. Driven through the real auth
  // instance rather than a mock, because a mock is what hid the PIN twin.
  it("spends the shared account lockout on direct username sign-in attempts", async () => {
    clearLoginAttempts()
    const { requestSecurityContext } = await import("@/lib/auth/security-context")
    const attemptHeaders = new Headers({ "x-forwarded-for": "198.51.100.42" })
    const { ipHash } = requestSecurityContext(attemptHeaders)

    const refusals: string[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await auth.api.signInUsername({
          body: { password: "this is not the password", username: "SMBA#0001" },
          headers: attemptHeaders,
        })
        refusals.push("accepted")
      } catch (error) {
        refusals.push(String((error as { status?: unknown }).status ?? "unknown"))
      }
    }

    // No wrong password may ever be accepted, and the budget must run out rather
    // than refusing identically for ever: the fifth failure locks the account,
    // so the sixth is refused as rate limiting rather than as a bad credential.
    expect(refusals).not.toContain("accepted")
    expect(refusals.filter((status) => status === "UNAUTHORIZED").length).toBe(5)
    expect(refusals.at(-1)).toBe("TOO_MANY_REQUESTS")

    // The attempts and the events have to be durable, or check-security-signals.mjs
    // stays blind. Both are read back by the source address this case owns, so
    // neither the PIN case above nor the earlier sign-ins can supply them.
    const attemptsDatabase = new Database(databasePath, { readonly: true })
    const attempts = attemptsDatabase
      .prepare("select failed_count as failedCount from auth_login_attempts where key = ?")
      .get(`ip:${ipHash}`) as { failedCount: number } | undefined
    const eventCounts = attemptsDatabase.prepare(
      "select event_type as eventType, count(*) as count from auth_security_events"
      + " where ip_hash = ? group by event_type",
    ).all(ipHash) as { count: number, eventType: string }[]
    attemptsDatabase.close()
    expect(attempts?.failedCount).toBe(5)
    expect(Object.fromEntries(eventCounts.map((row) => [row.eventType, row.count])))
      .toEqual({ login_failed: 5, login_rate_limited: 1 })

    // The correct password must not slip through the lock either. This account
    // carries an authenticator by now, so without the lock it would answer
    // `twoFactorRedirect` instead of throwing.
    await expect(auth.api.signInUsername({
      body: { password: "SMBA local access 2026!", username: "SMBA#0001" },
      headers: attemptHeaders,
    })).rejects.toThrow()
  })

  // Activation and first-run head-coach setup present a password this process
  // wrote a moment earlier, so there is no guess for the lockout to slow -- and
  // refusing them would leave a brand-new player unable to reach their first
  // session because twenty unrelated failures came from the same carrier
  // address. Driven through the real hooks, because that is where the exemption
  // lives and a mocked endpoint cannot show it.
  it("lets a password this server just wrote through a spent lockout", async () => {
    clearLoginAttempts()
    const { signInWithJustWrittenPassword } = await import("@/lib/auth/username-login-guard")
    const attemptHeaders = new Headers({ "x-forwarded-for": "198.51.100.77" })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.api.signInUsername({
        body: { password: "this is not the password", username: "SMBA#0001" },
        headers: attemptHeaders,
      }).catch(() => undefined)
    }

    // The door is shut, even for the right password.
    await expect(auth.api.signInUsername({
      body: { password: "SMBA local access 2026!", username: "SMBA#0001" },
      headers: attemptHeaders,
    })).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" })

    // Not shut for the sign-in that follows a password just written. This
    // account carries an authenticator by now, so the answer is a second-factor
    // hand-off rather than a session; either way it is an answer and not a
    // throw, which is what the block would have produced.
    const activated = await signInWithJustWrittenPassword(() => auth.api.signInUsername({
      body: { password: "SMBA local access 2026!", username: "SMBA#0001" },
      headers: attemptHeaders,
    }))
    expect(activated).toMatchObject({ twoFactorRedirect: true })
  })

  it("requires production authenticator setup only for the head coach", () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "production"
    expect(coachTotpRequired("head_admin")).toBe(true)
    expect(coachTotpRequired("junior_coach")).toBe(false)
    expect(principalTotpRequired("platform_admin", null)).toBe(true)
    expect(principalTotpRequired("coach", "head_admin")).toBe(true)
    expect(principalTotpRequired("coach", "junior_coach")).toBe(false)
    expect(principalTotpRequired("player", null)).toBe(false)
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
  })
})
