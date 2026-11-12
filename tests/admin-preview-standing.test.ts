/**
 * M024 -- whether an admin preview is still on, held to a real database.
 *
 * The cookies alone said yes for as long as this browser kept the owner's old
 * sign-in cookie. When that sign-in was ended from another device the server
 * had already forgotten it, every page treated the browser as signed out, and
 * the proxy still refused every form -- signing in included -- for up to an
 * hour, with no Exit preview anywhere on screen.
 */
import path from "node:path"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SmbaDatabase } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

const mocks = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  database: null as unknown,
  deletedCookies: [] as string[],
  getSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db/client", () => ({ initializeDatabase: () => mocks.database }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    delete: (name: string) => {
      mocks.deletedCookies.push(name)
      mocks.cookieJar.delete(name)
    },
    get: (name: string) => (mocks.cookieJar.has(name) ? { value: mocks.cookieJar.get(name) } : undefined),
  }),
  headers: async () => new Headers(),
}))
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession, signOut: mocks.signOut } }),
  principalTotpRequired: () => false,
}))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: () => ({ ipHash: "ip", userAgent: "test" }),
  writeAuthSecurityEvent: vi.fn(),
}))

import { ADMIN_PREVIEW_COOKIE, createAdminPreviewToken } from "@/lib/auth/admin-preview"
import { adminPreviewStillStands, findAdminPreviewTarget } from "@/lib/auth/admin-preview-standing"
import {
  adminPreviewTargetGone,
  clearDatabaseSession,
  DatabaseSessionProvider,
} from "@/lib/auth/session"
import { proxy } from "@/proxy"

const NOW = new Date()
const OWNER_SESSION_TOKEN = "ownerLaptopSession0123456789"
const SESSION_COOKIE_NAME = "smba.session_token"

let sqlite: Database.Database
let database: SmbaDatabase

function createAccount(input: {
  academyId: string
  accessLevel?: "head_admin" | "junior_coach"
  id: string
  role: "coach" | "platform_admin" | "player"
}) {
  database.insert(schema.accounts).values({
    approvalStatus: "approved",
    approvedAt: NOW,
    createdAt: NOW,
    fullName: `${input.id} Person`,
    id: input.id,
    normalizedName: input.id,
    requestedRole: input.role,
    role: input.role,
    updatedAt: NOW,
  }).run()
  database.insert(schema.authMethods).values({
    accountId: input.id,
    createdAt: NOW,
    id: `method-${input.id}`,
    identifier: input.academyId,
    method: "academy_id",
  }).run()
  database.insert(schema.authCredentialStates).values({
    accountId: input.id,
    activatedAt: NOW,
    status: "active",
    updatedAt: NOW,
  }).run()
  database.insert(schema.authUsers).values({
    createdAt: NOW,
    email: `${input.id}@accounts.invalid`,
    id: input.id,
    name: input.id,
    updatedAt: NOW,
    username: input.academyId.toLowerCase(),
  }).run()
  if (input.role === "coach") {
    database.insert(schema.coachProfiles).values({
      accessLevel: input.accessLevel ?? "junior_coach",
      accountId: input.id,
      createdAt: NOW,
      joinedOn: "2026-08-18",
      updatedAt: NOW,
    }).run()
  }
}

function signIn(userId: string, token: string, expiresAt = new Date(NOW.getTime() + 86_400_000)) {
  database.insert(schema.authRuntimeSessions).values({
    createdAt: NOW,
    expiresAt,
    id: `session-${token}`,
    token,
    updatedAt: NOW,
    userId,
  }).run()
}

function previewToken(targetAccountId = "player-4") {
  return createAdminPreviewToken({
    actorAccountId: "owner",
    sessionToken: OWNER_SESSION_TOKEN,
    targetAccountId,
  })
}

function postWithPreview(pathname: string) {
  return proxy(new NextRequest(`http://localhost:3000${pathname}`, {
    headers: {
      cookie: [
        `${ADMIN_PREVIEW_COOKIE}=${previewToken()}`,
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${OWNER_SESSION_TOKEN}.c2lnbmF0dXJl`)}`,
      ].join("; "),
    },
    method: "POST",
  }))
}

function clearsPreviewCookie(response: Response) {
  return /smba_admin_preview=;/u.test(response.headers.get("set-cookie") ?? "")
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema }) as SmbaDatabase
  migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })
  mocks.database = database
  mocks.cookieJar.clear()
  mocks.deletedCookies.length = 0
  mocks.getSession.mockReset()
  mocks.signOut.mockClear()

  createAccount({ academyId: "SMBA-PO-0001", id: "owner", role: "platform_admin" })
  createAccount({ academyId: "SMBA-PL-0004", id: "player-4", role: "player" })
  createAccount({ academyId: "SMBA-HC-0002", accessLevel: "head_admin", id: "coach-2", role: "coach" })
  signIn("owner", OWNER_SESSION_TOKEN)
})

afterEach(() => {
  sqlite.close()
})

describe("whether a preview still stands on the server", () => {
  const live = { actorAccountId: "owner", sessionToken: OWNER_SESSION_TOKEN, targetAccountId: "player-4" }

  it("stands while the owner's sign-in and the person viewed are both there", () => {
    expect(adminPreviewStillStands(live, { database })).toBe(true)
    expect(findAdminPreviewTarget("coach-2", { database })).toMatchObject({ role: "coach" })
  })

  it("falls once the owner's sign-in is ended from another device", () => {
    database.delete(schema.authRuntimeSessions)
      .where(eq(schema.authRuntimeSessions.token, OWNER_SESSION_TOKEN)).run()
    expect(adminPreviewStillStands(live, { database })).toBe(false)
  })

  it("falls once the owner's sign-in has expired", () => {
    expect(adminPreviewStillStands(live, {
      database,
      now: new Date(NOW.getTime() + 2 * 86_400_000),
    })).toBe(false)
  })

  it("never counts someone else's sign-in as the owner's", () => {
    signIn("player-4", "playerOwnSession0123456789")
    expect(adminPreviewStillStands({ ...live, sessionToken: "playerOwnSession0123456789" }, { database }))
      .toBe(false)
  })

  it("falls once the person viewed is archived or loses their sign-in", () => {
    database.update(schema.accounts).set({ archivedAt: NOW })
      .where(eq(schema.accounts.id, "player-4")).run()
    expect(adminPreviewStillStands(live, { database })).toBe(false)

    database.update(schema.authMethods).set({ revokedAt: NOW })
      .where(eq(schema.authMethods.accountId, "coach-2")).run()
    expect(findAdminPreviewTarget("coach-2", { database })).toBeNull()
    expect(findAdminPreviewTarget("owner", { database })).toBeNull()
  })
})

describe("the proxy, asking the database", () => {
  it("refuses forms during a live preview", () => {
    expect(postWithPreview("/coach/actions").status).toBe(403)
  })

  it("lets the sign-in form through once the owner was signed out from another device", () => {
    database.delete(schema.authRuntimeSessions)
      .where(eq(schema.authRuntimeSessions.token, OWNER_SESSION_TOKEN)).run()
    const response = postWithPreview("/login")
    expect(response.status).toBe(200)
    expect(clearsPreviewCookie(response)).toBe(true)
  })

  it("lets the owner console's buttons, Log out included, work once the person viewed is archived", () => {
    database.update(schema.accounts).set({ archivedAt: NOW })
      .where(eq(schema.accounts.id, "player-4")).run()
    const response = postWithPreview("/admin")
    expect(response.status).toBe(200)
    expect(clearsPreviewCookie(response)).toBe(true)
  })
})

describe("the owner's identity during a preview", () => {
  const provider = new DatabaseSessionProvider()

  function ownerSession(token: string) {
    return { session: { token }, user: { id: "owner", twoFactorEnabled: true } }
  }

  it("shows the person viewed only to the sign-in that started the preview", async () => {
    mocks.cookieJar.set(ADMIN_PREVIEW_COOKIE, previewToken())
    mocks.getSession.mockResolvedValue(ownerSession(OWNER_SESSION_TOKEN))
    expect(await provider.getCurrentIdentity()).toMatchObject({
      actorSubjectId: "owner",
      previewMode: true,
      subjectId: "player-4",
    })

    // A later sign-in on the same browser does not inherit it.
    mocks.getSession.mockResolvedValue(ownerSession("aLaterSignIn0123456789"))
    const identity = await provider.getCurrentIdentity()
    expect(identity).toMatchObject({ role: "platform_admin", subjectId: "owner" })
    expect(identity?.previewMode).toBeUndefined()
  })

  it("falls back to the owner, and tells the console why, once the person viewed is archived", async () => {
    mocks.cookieJar.set(ADMIN_PREVIEW_COOKIE, previewToken())
    mocks.cookieJar.set(SESSION_COOKIE_NAME, `${OWNER_SESSION_TOKEN}.c2lnbmF0dXJl`)
    mocks.getSession.mockResolvedValue(ownerSession(OWNER_SESSION_TOKEN))
    database.update(schema.accounts).set({ archivedAt: NOW })
      .where(eq(schema.accounts.id, "player-4")).run()
    expect(await provider.getCurrentIdentity()).toMatchObject({ role: "platform_admin", subjectId: "owner" })
    // The owner's own request still carries the preview cookie, so /admin says
    // what happened rather than silently dropping the owner into the console.
    expect(await adminPreviewTargetGone()).toBe(true)
  })

  it("ends the preview with the sign-in on Log out", async () => {
    mocks.cookieJar.set(ADMIN_PREVIEW_COOKIE, previewToken())
    mocks.getSession.mockResolvedValue(ownerSession(OWNER_SESSION_TOKEN))
    await clearDatabaseSession()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.deletedCookies).toContain(ADMIN_PREVIEW_COOKIE)
  })
})
