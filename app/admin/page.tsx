import type { Metadata } from "next"
import { and, asc, eq, isNull, ne } from "drizzle-orm"
import { redirect } from "next/navigation"

import { AccountMenu } from "@/components/account-menu"
import { AdminDashboardDirectory } from "@/components/admin/admin-dashboard-directory"
import { openHeadCoachSetupAction } from "@/app/admin/actions"
import { sessionProvider } from "@/lib/data"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  authCredentialStates,
  authMethods,
  coachProfiles,
} from "@/lib/db/schema"
import { headCoachSetupAvailable } from "@/lib/auth/initial-setup"
import { recoveryEmailEnrollmentRequired } from "@/lib/auth/recovery-service"

export const metadata: Metadata = {
  title: "Platform owner",
  robots: { follow: false, index: false },
}

export default async function AdminPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "platform_admin") redirect("/login")
  if (recoveryEmailEnrollmentRequired(identity.subjectId)) {
    redirect("/account/recovery-email/setup")
  }
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

  return (
    <main className="admin-page page-shell">
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
        <span className="admin-signal-number" aria-hidden="true">0001</span>
        <AccountMenu account={identity} publicSiteHref="/" />
      </header>

      <div className="admin-access-strip">
        <span>Read-only access</span>
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
  )
}
