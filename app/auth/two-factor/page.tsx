import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { TwoFactorVerificationForm } from "@/components/two-factor-verification-form"
import { sessionProvider } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Verify sign in",
  robots: { follow: false, index: false },
}

export default async function TwoFactorPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity) {
    redirect(postAuthenticationDestination({
      accountId: identity.subjectId,
      role: identity.role,
      twoFactorEnabled: true,
    }))
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="two-factor-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.jpeg" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Portal</em></span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">Authenticator verification</p>
          <h1 id="two-factor-title">Verify it’s you.</h1>
          <p>Your authenticator is already connected. Enter its current code or use a saved recovery code.</p>
        </div>
        <TwoFactorVerificationForm />
      </section>
    </main>
  )
}
