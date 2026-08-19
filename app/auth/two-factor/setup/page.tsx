import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { and, eq, isNull } from "drizzle-orm"
import { redirect } from "next/navigation"

import { TwoFactorSetupForm } from "@/components/two-factor-setup-form"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { getRawAuthSession } from "@/lib/auth/session"
import { publicSiteUrl } from "@/lib/config"
import { initializeDatabase } from "@/lib/db/client"
import { accounts } from "@/lib/db/schema"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Secure coach account",
  robots: { follow: false, index: false },
}

export default async function TwoFactorSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ reconnect?: string }>
}) {
  const reconnecting = (await searchParams).reconnect === "1"
  const rawSession = await getRawAuthSession()
  if (!rawSession) redirect("/login")
  const account = initializeDatabase().select({ role: accounts.role })
    .from(accounts)
    .where(and(
      eq(accounts.id, rawSession.user.id),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
  if (account?.role !== "coach" && account?.role !== "platform_admin") redirect("/player")
  if (account.role === "coach"
    && getCoachAccessProfile(rawSession.user.id)?.accessLevel !== "head_admin") {
    redirect("/coach")
  }
  if (rawSession.user.twoFactorEnabled) {
    redirect(postAuthenticationDestination({
      accountId: rawSession.user.id,
      role: account.role,
      twoFactorEnabled: true,
    }))
  }

  return (
    <main className="login-page">
      <section className="login-card totp-card" aria-labelledby="totp-setup-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.jpeg" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">{reconnecting ? "Authenticator replacement" : "Required account security"}</p>
          <h1 id="totp-setup-title">{reconnecting ? "Connect your new authenticator." : "Protect your workspace."}</h1>
          <p>{reconnecting
            ? "The previous connection and recovery codes have been retired. Finish setup to reopen protected records."
            : "Add a free authenticator app before opening protected records."}</p>
        </div>
        <TwoFactorSetupForm />
      </section>
    </main>
  )
}
