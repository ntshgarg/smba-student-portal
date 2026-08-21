import type { Metadata } from "next"
import Link from "next/link"
import { asc, eq } from "drizzle-orm"
import { redirect } from "next/navigation"

import { AccountSecurityWorkspace } from "@/components/account-security-workspace"
import { RecoveryEmailSecurityPanel } from "@/components/recovery-email-security-panel"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { getRawAuthSession } from "@/lib/auth/session"
import { sessionProvider } from "@/lib/data"
import { initializeDatabase } from "@/lib/db/client"
import { authRuntimeSessions } from "@/lib/db/schema"
import { hasPinCredential } from "@/lib/auth/credential-service"
import { getRecoveryEmail, maskRecoveryEmail } from "@/lib/auth/recovery-service"

export const metadata: Metadata = {
  title: "Account security",
  robots: { follow: false, index: false },
}

export default async function AccountSecurityPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  const rawSession = await getRawAuthSession()
  if (!rawSession) redirect("/login")

  const database = initializeDatabase()
  const sessions = database.select().from(authRuntimeSessions)
    .where(eq(authRuntimeSessions.userId, identity.subjectId))
    .orderBy(asc(authRuntimeSessions.createdAt))
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
  const recoveryEmail = getRecoveryEmail(identity.subjectId, { database })
  const recoverySecondFactorRequired = identity.role === "platform_admin"
    || access?.accessLevel === "head_admin"

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
      <AccountSecurityWorkspace
        allowPin={allowPin}
        authenticatorEnabled={rawSession.user.twoFactorEnabled === true}
        authenticatorRequired={Boolean(access?.accessLevel === "head_admin"
          || identity.role === "platform_admin")}
        pinEnabled={allowPin && hasPinCredential(identity.subjectId, { database })}
        pinRequired={identity.role === "platform_admin" || access?.accessLevel === "head_admin"}
        sessions={sessions}
      />
      {recoveryEmail ? (
        <RecoveryEmailSecurityPanel
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
    </main>
  )
}
