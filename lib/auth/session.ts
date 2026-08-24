import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { cookies, headers } from "next/headers"

import { getAuth, principalTotpRequired } from "@/lib/auth/better-auth"
import { ADMIN_PREVIEW_COOKIE, readAdminPreviewToken } from "@/lib/auth/admin-preview"
import { createSessionIdentity, type SessionIdentity } from "@/lib/auth/identity"
import { requestSecurityContext, writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  authCredentialStates,
  authMethods,
  coachProfiles,
} from "@/lib/db/schema"

const LEGACY_SESSION_COOKIE = "smba_session"
const LEGACY_PROTOTYPE_SESSION_COOKIE = "smba_prototype_student"

export interface SessionProvider {
  getCurrentIdentity(): Promise<SessionIdentity | null>
  hasActiveSession(): Promise<boolean>
}

export async function getRawAuthSession() {
  return getAuth().api.getSession({ headers: await headers() })
}

export class DatabaseSessionProvider implements SessionProvider {
  /**
   * Whether the browser still holds a session Better Auth accepts, before any
   * of the account conditions `getCurrentIdentity` layers on top. Signed out
   * and refused are indistinguishable there -- an expired cookie, an archived
   * account and a head coach without a second factor all return the same `null`
   * below -- and only the first is answered by signing in again. Read on the
   * refusal path alone, so an ordinary request still costs one session read.
   */
  async hasActiveSession() {
    return Boolean(await getRawAuthSession())
  }

  async getCurrentIdentity() {
    const rawSession = await getRawAuthSession()
    if (!rawSession?.user?.id) return null

    const result = initializeDatabase().select({
      accountId: accounts.id,
      academyId: authMethods.identifier,
      coachAccessLevel: coachProfiles.accessLevel,
      credentialStatus: authCredentialStates.status,
      fullName: accounts.fullName,
      role: accounts.role,
    })
      .from(accounts)
      .innerJoin(authMethods, and(
        eq(authMethods.accountId, accounts.id),
        eq(authMethods.method, "academy_id"),
        isNull(authMethods.revokedAt),
      ))
      .innerJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
      .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
      .where(and(
        eq(accounts.id, rawSession.user.id),
        eq(accounts.approvalStatus, "approved"),
        isNull(accounts.archivedAt),
        eq(authCredentialStates.status, "active"),
      ))
      .get()

    if (!result?.role) return null
    if (principalTotpRequired(result.role, result.coachAccessLevel)
      && !rawSession.user.twoFactorEnabled) return null
    if (result.role === "platform_admin") {
      const previewToken = (await cookies()).get(ADMIN_PREVIEW_COOKIE)?.value
      const claim = readAdminPreviewToken(previewToken, result.accountId)
      if (claim) {
        const target = initializeDatabase().select({
          accountId: accounts.id,
          academyId: authMethods.identifier,
          credentialStatus: authCredentialStates.status,
          fullName: accounts.fullName,
          role: accounts.role,
        }).from(accounts)
          .innerJoin(authMethods, and(
            eq(authMethods.accountId, accounts.id),
            eq(authMethods.method, "academy_id"),
            isNull(authMethods.revokedAt),
          ))
          .innerJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
          .where(and(
            eq(accounts.id, claim.targetAccountId),
            eq(accounts.approvalStatus, "approved"),
            isNull(accounts.archivedAt),
            eq(authCredentialStates.status, "active"),
          ))
          .get()
        if (target?.role === "coach" || target?.role === "player") {
          return createSessionIdentity({
            ...target,
            actorSubjectId: result.accountId,
            previewMode: true,
            role: target.role,
          })
        }
      }
    }
    return createSessionIdentity({ ...result, role: result.role })
  }
}

export async function clearDatabaseSession() {
  const requestHeaders = await headers()
  const requestAuth = getAuth()
  const rawSession = await requestAuth.api.getSession({ headers: requestHeaders })
  if (rawSession) {
    const security = requestSecurityContext(requestHeaders)
    await requestAuth.api.signOut({ headers: requestHeaders })
    writeAuthSecurityEvent({
      accountId: rawSession.user.id,
      eventType: "logout",
      ipHash: security.ipHash,
      outcome: "success",
      userAgent: security.userAgent,
    })
  }

  const cookieStore = await cookies()
  cookieStore.delete(LEGACY_SESSION_COOKIE)
  cookieStore.delete(LEGACY_PROTOTYPE_SESSION_COOKIE)
}
