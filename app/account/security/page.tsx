import type { Metadata } from "next"
import Link from "next/link"
import { and, desc, eq, gt } from "drizzle-orm"
import { redirect } from "next/navigation"

import { AccountSecurityWorkspace } from "@/components/account-security-workspace"
import { RecoveryEmailSecurityPanel } from "@/components/recovery-email-security-panel"
import { getAuth } from "@/lib/auth/better-auth"
import { getPendingAuthenticatorResetRequest } from "@/lib/auth/authenticator-reset-service"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { getRawAuthSession } from "@/lib/auth/session"
import { sessionProvider } from "@/lib/data"
import { initializeDatabase } from "@/lib/db/client"
import { authRuntimeSessions } from "@/lib/db/schema"
import { hasPinCredential } from "@/lib/auth/credential-service"
import { getRecoveryEmail, maskRecoveryEmail } from "@/lib/auth/recovery-service"
import { listTrustedDevices } from "@/lib/auth/second-factor-reset"

export const metadata: Metadata = {
  title: "Account security",
  robots: { follow: false, index: false },
}

/**
 * How many recovery codes the account can still spend.
 *
 * The count is Better Auth's own arithmetic rather than ours: `verifyBackupCode`
 * rewrites the stored set without the code it just consumed, so the length of
 * what `viewBackupCodes` decrypts is exactly what is left. `null` when the read
 * fails, because the reissue panel would rather say nothing than name a number
 * a coach might plan around.
 */
async function countUnusedRecoveryCodes(userId: string) {
  try {
    const { backupCodes } = await getAuth().api.viewBackupCodes({ body: { userId } })
    return backupCodes.length
  } catch {
    return null
  }
}

export default async function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ emailChanged?: string }>
}) {
  const emailChanged = (await searchParams).emailChanged === "1"
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  const rawSession = await getRawAuthSession()
  if (!rawSession) redirect("/login")

  const database = initializeDatabase()
  const now = new Date()
  // Live sign-ins only, newest first: the list is cut to the five most recent.
  const sessions = database.select().from(authRuntimeSessions)
    .where(and(
      eq(authRuntimeSessions.userId, identity.subjectId),
      gt(authRuntimeSessions.expiresAt, now),
    ))
    .orderBy(desc(authRuntimeSessions.createdAt))
    .all()
    .map((session) => ({
      createdAt: session.createdAt.toISOString(),
      current: session.id === rawSession.session.id,
      expiresAt: session.expiresAt.toISOString(),
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    }))

  const access = identity.role === "coach" ? getCoachAccessProfile(identity.subjectId) : null
  const allowPin = identity.role === "player"
    || identity.role === "coach"
    || identity.role === "platform_admin"
  const authenticatorEnabled = rawSession.user.twoFactorEnabled === true
  const recoveryEmail = getRecoveryEmail(identity.subjectId, { database })
  const recoverySecondFactorRequired = identity.role === "platform_admin"
    || access?.accessLevel === "head_admin"
  const trustedBrowserExpiries = authenticatorEnabled
    ? listTrustedDevices(identity.subjectId, { database, now }).map((expiresAt) => expiresAt.toISOString())
    : []
  const pendingAuthenticatorReset = access?.accessLevel === "head_admin"
    ? getPendingAuthenticatorResetRequest(identity.subjectId, { database, now })
    : null

  const returnHref = identity.role === "platform_admin"
    ? "/admin"
    : identity.role === "coach" ? "/coach" : "/player"
  return (
    <main className="security-page">
      <header className="security-page-header">
        <Link href={returnHref}>← Back to dashboard</Link>
        <p className="eyebrow">SMBA portal</p>
        <h1>Account security.</h1>
        <p>Manage your password, signed-in devices and academy account access.</p>
      </header>
      <div className="security-page-body">
        <AccountSecurityWorkspace
          allowPin={allowPin}
          authenticatorEnabled={authenticatorEnabled}
          authenticatorRequired={Boolean(access?.accessLevel === "head_admin"
            || identity.role === "platform_admin")}
          pinEnabled={allowPin && hasPinCredential(identity.subjectId, { database })}
          pinRequired={identity.role === "platform_admin" || access?.accessLevel === "head_admin"}
          pendingAuthenticatorResetRequestedAt={pendingAuthenticatorReset?.requestedAt.toISOString() ?? null}
          sessions={sessions}
          trustedBrowserExpiries={trustedBrowserExpiries}
          unusedRecoveryCodeCount={authenticatorEnabled
            ? await countUnusedRecoveryCodes(rawSession.user.id)
            : null}
        />
        {recoveryEmail ? (
          <RecoveryEmailSecurityPanel
            changed={emailChanged}
            maskedEmail={maskRecoveryEmail(recoveryEmail.email)}
            requiresSecondFactor={recoverySecondFactorRequired}
          />
        ) : (
          <section className="security-panel security-recovery-callout">
            <div>
              <p className="eyebrow">Account recovery</p>
              <h2>Add a recovery email</h2>
              <p>Verify an address before relying on self-service password recovery.</p>
            </div>
            <Link href="/account/recovery-email/setup">Set up recovery email</Link>
          </section>
        )}
      </div>
    </main>
  )
}
