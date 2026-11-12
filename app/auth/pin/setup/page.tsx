import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { InterstitialSignOut } from "@/components/interstitial-sign-out"
import { PinSetupForm } from "@/components/pin-setup-form"
import { hasPinCredential } from "@/lib/auth/credential-service"
import { sessionProvider } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"
import { getCoachAccessProfile } from "@/lib/auth/coach-access"
import { sessionFreshEnoughForPinSetup } from "@/lib/auth/pin-setup-freshness"

export const metadata: Metadata = {
  title: "Set up quick login",
  robots: { follow: false, index: false },
}

export default async function PinSetupPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  const access = identity.role === "coach" ? getCoachAccessProfile(identity.subjectId) : null
  if (hasPinCredential(identity.subjectId)) {
    redirect(identity.role === "platform_admin"
      ? "/admin"
      : identity.role === "coach" ? "/coach" : "/player")
  }
  const mandatory = identity.role === "platform_admin" || access?.accessLevel === "head_admin"
  // The action refuses a sign-in older than a few minutes, so offering the form
  // to one only set up a refusal -- with no Skip for a head coach, a dead end.
  const canSetPin = await sessionFreshEnoughForPinSetup()
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="pin-setup-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>Player <em>Journal</em></span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">Quick login</p>
          <h1 id="pin-setup-title">Set up a 6-digit PIN.</h1>
          <p>{mandatory
            ? "This account needs a PIN for quick sign-in. Your password will always continue to work."
            : "Use it for faster sign-in. Your password will always continue to work."}</p>
        </div>
        {canSetPin ? <PinSetupForm allowSkip={!mandatory} /> : (
          <p className="login-error" role="status">
            For your security, a PIN can only be set within a few minutes of signing in.
            Sign out below, then sign in again to set it.
          </p>
        )}
        <InterstitialSignOut />
      </section>
    </main>
  )
}
