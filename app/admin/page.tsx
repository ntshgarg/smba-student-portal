import type { Metadata } from "next"
import { and, asc, eq, isNull, ne } from "drizzle-orm"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AccountMenu } from "@/components/account-menu"
import { AdminDashboardDirectory } from "@/components/admin/admin-dashboard-directory"
import { AdminAuthenticatorRecoveryQueue } from "@/components/admin/admin-authenticator-recovery-queue"
import { AdminPreviewBanner, adminPreviewLabel } from "@/components/admin-preview-banner"
import { openHeadCoachSetupAction } from "@/app/admin/actions"
import type { SessionIdentity } from "@/lib/auth/identity"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { adminPreviewTargetGone } from "@/lib/auth/session"
import { publicSiteUrl } from "@/lib/config"
import { sessionProvider } from "@/lib/data"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  authCredentialStates,
  authMethods,
  coachProfiles,
} from "@/lib/db/schema"
import { headCoachSetupAvailable } from "@/lib/auth/initial-setup"
import {
  maskRecoveryEmail,
  recoveryEmailEnrollmentRequired,
} from "@/lib/auth/recovery-service"
import { listPendingAuthenticatorResetRequests } from "@/lib/auth/authenticator-reset-service"

export async function generateMetadata(): Promise<Metadata> {
  const identity = await sessionProvider.getCurrentIdentity()
  return {
    // While a preview is open this page is not the owner console.
    title: identity?.previewMode ? "Admin preview" : "Platform owner",
    robots: { follow: false, index: false },
  }
}

/*
 * Every page a preview may not show -- account security, PIN and recovery
 * setup, the sign-in page -- sends the owner here. While a preview is open the
 * signed-in identity is the person being viewed, so this page used to send them
 * on to /login, which sent them to that person's dashboard or, for a player
 * still owing a recovery email, back here again until the browser gave up. It
 * now says where they are and offers the way out.
 */
function PreviewStillOpen({ identity }: {
  identity: SessionIdentity & { role: "coach" | "player" }
}) {
  const dashboard = identity.role === "coach" ? "/coach" : "/player"
  const label = adminPreviewLabel({
    coachAccessLevel: identity.role === "coach"
      ? getCoachAccessProfile(identity.subjectId)?.accessLevel
      : null,
    fullName: identity.fullName,
    role: identity.role,
  })
  return (
    <>
      <AdminPreviewBanner label={label} />
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="portal-header">
        <Link className="portal-brand" href={dashboard} aria-label={`Back to ${identity.firstName}’s dashboard`}>
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>
            Admin <em>Preview</em>
          </span>
        </Link>

        {/* The same preview menu as on the person's own pages: its Log out
            leaves through Exit preview, the one form the preview allows. */}
        <AccountMenu account={identity} previewMode publicSiteHref={publicSiteUrl} />
      </header>
      <main id="main-content" className="admin-page page-shell" tabIndex={-1}>
        <section className="admin-preview-panel" aria-labelledby="admin-preview-title">
          <header>
            <h1 id="admin-preview-title">You are still viewing {identity.firstName}’s dashboard</h1>
            <p>The owner console and account settings open again once you exit the preview.</p>
          </header>
          <p>
            <Link href={dashboard}>Back to {identity.firstName}’s dashboard</Link>
          </p>
        </section>
      </main>
    </>
  )
}

export default async function AdminPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity?.previewMode && identity.role !== "platform_admin") {
    return <PreviewStillOpen identity={{ ...identity, role: identity.role }} />
  }
  if (!identity || identity.role !== "platform_admin") redirect("/login")
  if (recoveryEmailEnrollmentRequired(identity.subjectId)) {
    redirect("/account/recovery-email/setup")
  }
  const previewTargetGone = await adminPreviewTargetGone()
  const database = initializeDatabase()
  const targets = database.select({
    academyId: authMethods.identifier,
    accessLevel: coachProfiles.accessLevel,
    fullName: accounts.fullName,
    id: accounts.id,
    role: accounts.role,
  }).from(accounts)
    .innerJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .innerJoin(authCredentialStates, and(
      eq(authCredentialStates.accountId, accounts.id),
      eq(authCredentialStates.status, "active"),
    ))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(
      ne(accounts.role, "platform_admin"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.role), asc(accounts.fullName))
    .all()
  const authenticatorResetRequests = listPendingAuthenticatorResetRequests({ database }).map((request) => ({
    academyId: request.academyId,
    expiresAt: request.expiresAt.toISOString(),
    fullName: request.fullName,
    id: request.id,
    maskedEmail: maskRecoveryEmail(request.recoveryEmail),
    requestedAt: request.requestedAt.toISOString(),
  }))

  return (
    <>
      {previewTargetGone ? <AdminPreviewBanner label={null} /> : null}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="portal-header">
        <Link className="portal-brand" href="/admin" aria-label="SMBA platform owner home">
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>
            Platform <em>Owner</em>
          </span>
        </Link>

        <AccountMenu account={identity} publicSiteHref="/" />
      </header>

      <main id="main-content" className="admin-page page-shell" tabIndex={-1}>
        <header className="admin-page-header">
          <div className="admin-signal-copy">
            <div className="admin-owner-ribbon">
              <p>Platform owner</p>
              <span aria-hidden="true" />
            </div>
            <h1>
              <span>SMBA</span>
              <span>Oversight<i>.</i></span>
            </h1>
          </div>
        </header>

        <div className="admin-access-strip">
          <span>Read-only dashboard previews · Audited security approvals</span>
        </div>

        {headCoachSetupAvailable({ database }) ? (
          <section className="admin-setup-panel">
            <div>
              <p className="eyebrow">Academy not activated</p>
              <h2>Set up the first head coach</h2>
              <p>Open this on the coach’s device. They will create their own password and PIN, then connect an authenticator.</p>
            </div>
            <form action={openHeadCoachSetupAction}>
              <button type="submit">Open secure coach setup</button>
            </form>
          </section>
        ) : null}

        {authenticatorResetRequests.length ? (
          <AdminAuthenticatorRecoveryQueue requests={authenticatorResetRequests} />
        ) : null}

        <section className="admin-preview-panel" aria-labelledby="admin-preview-title">
          <header>
            <h2 id="admin-preview-title">View a dashboard</h2>
            <p>Preview mode blocks attendance, finance, scheduling, report, and account changes.</p>
          </header>
          {targets.length ? (
            <AdminDashboardDirectory targets={targets} />
          ) : <p className="admin-empty-copy">No academy accounts have completed setup yet.</p>}
        </section>
      </main>
    </>
  )
}
