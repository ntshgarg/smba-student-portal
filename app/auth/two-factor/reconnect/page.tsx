import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { TwoFactorReconnectForm } from "@/components/two-factor-reconnect-form"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { getRawAuthSession } from "@/lib/auth/session"
import { publicSiteUrl } from "@/lib/config"
import { sessionProvider } from "@/lib/data"

export const metadata: Metadata = {
  title: "Reconnect authenticator",
  robots: { follow: false, index: false },
}

export default async function TwoFactorReconnectPage() {
  const [identity, rawSession] = await Promise.all([
    sessionProvider.getCurrentIdentity(),
    getRawAuthSession(),
  ])
  if (!identity || !rawSession) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  const protectedAccount = identity.role === "platform_admin"
    || (identity.role === "coach"
      && getCoachAccessProfile(identity.subjectId)?.accessLevel === "head_admin")
  if (!protectedAccount) redirect(identity.role === "coach" ? "/coach" : "/player")
  if (!rawSession.user.twoFactorEnabled) redirect("/auth/two-factor/setup")

  return (
    <main className="login-page">
      <section className="login-card totp-card" aria-labelledby="totp-reconnect-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">Authenticator recovery</p>
          <h1 id="totp-reconnect-title">Connect this account again.</h1>
          <p>Confirm two existing credentials before replacing the authenticator connection.</p>
        </div>
        <TwoFactorReconnectForm />
        <Link className="login-back" href="/account/security">← Back to account security</Link>
      </section>
    </main>
  )
}
