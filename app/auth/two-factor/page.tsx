import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { TwoFactorVerificationForm } from "@/components/two-factor-verification-form"
import {
  latestAuthenticatorResetOutcome,
  type AuthenticatorResetOutcome,
} from "@/lib/auth/authenticator-reset-service"
import { challengeStartedWithPin, challengedAccountId } from "@/lib/auth/two-factor-challenge"
import { sessionProvider } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"
import { formatAcademyDate } from "@/lib/format"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Verify sign in",
  robots: { follow: false, index: false },
}

// Tells a locked-out coach whether their reset request is waiting, declined or lapsed.
function resetOutcomeNotice(outcome: AuthenticatorResetOutcome) {
  const on = formatAcademyDate(outcome.at)
  switch (outcome.state) {
    case "pending":
      return `Your request to reset the authenticator, sent on ${on}, is waiting for the platform admin. Until it is approved, your current authenticator and recovery codes still work here. Signing in does not cancel it; if you have your authenticator back, cancel it from Account security.`
    case "declined":
      return `The platform admin did not approve your authenticator reset request on ${on}. If you still cannot sign in, speak to them or send a new request below.`
    case "lapsed":
      return `Your authenticator reset request ran out on ${on} before it was approved. Send a new request below if you still need one.`
  }
}

async function pendingResetNotice() {
  try {
    const accountId = await challengedAccountId(await headers())
    if (!accountId) return null
    const outcome = latestAuthenticatorResetOutcome(accountId)
    return outcome ? resetOutcomeNotice(outcome) : null
  } catch {
    return null
  }
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
  const resetNotice = await pendingResetNotice()
  const pinSignIn = await challengeStartedWithPin(await headers())

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="two-factor-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Portal</em></span>
        </Link>
        <div className="login-copy">
          <p className="eyebrow">Authenticator verification</p>
          <h1 id="two-factor-title">Verify it’s you.</h1>
          <p>Your authenticator is already connected. Enter its current code or use a saved recovery code.</p>
        </div>
        {resetNotice ? <p className="login-helper" role="status">{resetNotice}</p> : null}
        <TwoFactorVerificationForm canTrustDevice={!pinSignIn} />
        <Link className="login-back" href="/login">← Back to sign in</Link>
      </section>
    </main>
  )
}
