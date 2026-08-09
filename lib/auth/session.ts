import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { and, eq, gt, isNull } from "drizzle-orm"
import { cookies } from "next/headers"

import { createSessionIdentity, type SessionIdentity } from "@/lib/auth/identity"
import { initializeDatabase } from "@/lib/db/client"
import { accounts, authMethods, authSessions } from "@/lib/db/schema"

export const SESSION_COOKIE = "smba_session"
export const LEGACY_PROTOTYPE_SESSION_COOKIE = "smba_prototype_student"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export interface SessionProvider {
  getCurrentIdentity(): Promise<SessionIdentity | null>
}

export class DatabaseSessionProvider implements SessionProvider {
  async getCurrentIdentity() {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null

    const db = initializeDatabase()
    const now = new Date()
    const result = db.select({
      accountId: accounts.id,
      fullName: accounts.fullName,
      role: accounts.role,
      academyId: authMethods.identifier,
    })
      .from(authSessions)
      .innerJoin(accounts, eq(authSessions.accountId, accounts.id))
      .innerJoin(authMethods, and(
        eq(authMethods.accountId, accounts.id),
        eq(authMethods.method, "academy_id"),
        isNull(authMethods.revokedAt),
      ))
      .where(and(
        eq(authSessions.tokenHash, tokenHash(token)),
        gt(authSessions.expiresAt, now),
        eq(accounts.approvalStatus, "approved"),
        isNull(accounts.archivedAt),
      ))
      .get()

    if (!result?.role) return null
    return createSessionIdentity({ ...result, role: result.role })
  }
}

export async function createDatabaseSession(accountId: string) {
  const db = initializeDatabase()
  const token = randomBytes(32).toString("base64url")
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)

  db.insert(authSessions).values({
    tokenHash: tokenHash(token),
    accountId,
    createdAt: now,
    expiresAt,
  }).run()

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })
  cookieStore.delete(LEGACY_PROTOTYPE_SESSION_COOKIE)
}

export async function clearDatabaseSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    initializeDatabase().delete(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash(token)))
      .run()
  }
  cookieStore.delete(SESSION_COOKIE)
  cookieStore.delete(LEGACY_PROTOTYPE_SESSION_COOKIE)
}
