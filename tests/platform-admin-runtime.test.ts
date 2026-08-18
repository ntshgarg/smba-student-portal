import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { createOTP } from "@better-auth/utils/otp"
import Database from "better-sqlite3"
import { symmetricDecrypt } from "better-auth/crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-admin-runtime-"))
const databasePath = path.join(temporaryDirectory, "admin.db")
const adminPassword = "adminsmba2026"

function cookie(headers: Headers, name: string) {
  return headers.getSetCookie()
    .find((value) => value.startsWith(`${name}=`) && !value.includes("Max-Age=0"))
    ?.split(";")[0] ?? ""
}

describe("platform-owner authentication runtime", () => {
  let auth: typeof import("@/lib/auth/better-auth")["auth"]

  beforeAll(async () => {
    process.env.DB_FILE_NAME = databasePath
    process.env.BETTER_AUTH_SECRET = "test-only-platform-secret-with-more-than-32-characters"
    const { prepareDatabase } = await import("@/lib/db/setup")
    prepareDatabase({ emptyAcademy: true, seed: true })
    const { completeInitialPlatformAdminSetup } = await import("@/lib/auth/initial-setup")
    await completeInitialPlatformAdminSetup({
      fullName: "Platform Owner",
      password: adminPassword,
      confirmPassword: adminPassword,
      pin: "135790",
      confirmPin: "135790",
    })
    auth = (await import("@/lib/auth/better-auth")).auth
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    delete process.env.DB_FILE_NAME
    delete process.env.BETTER_AUTH_SECRET
  })

  it("requires an authenticator before a returning platform owner receives a session", async () => {
    const sqlite = new Database(databasePath, { readonly: true })
    expect((sqlite.prepare("select count(*) as count from coach_profiles").get() as { count: number }).count)
      .toBe(0)
    expect((sqlite.prepare("select count(*) as count from player_enrollments").get() as { count: number }).count)
      .toBe(0)
    sqlite.close()

    const firstSignIn = await auth.api.signInUsername({
      body: { password: adminPassword, username: "SMBA-ADMIN-0001" },
      headers: new Headers(),
      returnHeaders: true,
    })
    const firstSession = cookie(firstSignIn.headers, "smba.session_token")
    expect(firstSession).toBeTruthy()

    const enabled = await auth.api.enableTwoFactor({
      body: { password: adminPassword },
      headers: new Headers({ cookie: firstSession }),
      returnHeaders: true,
    })
    const setupSession = cookie(enabled.headers, "smba.session_token") || firstSession
    const secret = new URL(enabled.response.totpURI).searchParams.get("secret")
    expect(secret).toBeTruthy()
    const setupDatabase = new Database(databasePath, { readonly: true })
    const setupStored = setupDatabase.prepare("select secret from auth_two_factors limit 1")
      .get() as { secret: string }
    expect((setupDatabase.prepare("select count(*) as count from auth_two_factors").get() as { count: number }).count)
      .toBe(1)
    setupDatabase.close()
    const setupSecret = await symmetricDecrypt({
      data: setupStored.secret,
      key: process.env.BETTER_AUTH_SECRET!,
    })
    const verification = await auth.api.verifyTOTP({
      body: { code: await createOTP(setupSecret).totp(), trustDevice: false },
      headers: new Headers({ cookie: setupSession }),
      returnHeaders: true,
    })
    expect(verification.response.user.id).toBe("00000000-0000-4000-8000-0000000000a1")

    const returningSignIn = await auth.api.signInUsername({
      body: { password: adminPassword, username: "SMBA-ADMIN-0001" },
      headers: new Headers(),
      returnHeaders: true,
    })
    expect(returningSignIn.response).toMatchObject({ twoFactorRedirect: true })
    expect(cookie(returningSignIn.headers, "smba.session_token")).toBe("")
    const challengeCookie = cookie(returningSignIn.headers, "smba.two_factor")
    expect(challengeCookie).toBeTruthy()

    const returningDatabase = new Database(databasePath, { readonly: true })
    const stored = returningDatabase.prepare("select secret from auth_two_factors limit 1")
      .get() as { secret: string }
    expect((returningDatabase.prepare("select count(*) as count from auth_two_factors").get() as { count: number }).count)
      .toBe(1)
    expect(stored.secret).toBe(setupStored.secret)
    returningDatabase.close()
    const storedSecret = await symmetricDecrypt({
      data: stored.secret,
      key: process.env.BETTER_AUTH_SECRET!,
    })
    const completed = await auth.api.verifyTOTP({
      body: { code: await createOTP(storedSecret).totp(), trustDevice: true },
      headers: new Headers({ cookie: challengeCookie }),
      returnHeaders: true,
    })
    expect(completed.response).toMatchObject({
      user: { username: "SMBA-ADMIN-0001", twoFactorEnabled: true },
    })
    expect(cookie(completed.headers, "smba.session_token")).toBeTruthy()
  })
})
