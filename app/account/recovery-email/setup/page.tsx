import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import {
  confirmCurrentRecoveryEmail,
  requestCurrentRecoveryEmail,
} from "@/app/account/recovery-email/actions"
import { InterstitialSignOut } from "@/components/interstitial-sign-out"
import { RecoveryEmailEnrollmentForm } from "@/components/recovery-email-enrollment-form"
import { getRecoveryEmail } from "@/lib/auth/recovery-service"
import { publicSiteUrl } from "@/lib/config"
import { sessionProvider } from "@/lib/data"

export const metadata: Metadata = {
  title: "Secure recovery email",
  robots: { follow: false, index: false },
}

export default async function RecoveryEmailSetupPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity) redirect("/login")
  if (identity.previewMode) redirect("/admin")
  if (getRecoveryEmail(identity.subjectId)) redirect("/account/security")

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="recovery-email-setup-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Required account security</p>
          <h1 id="recovery-email-setup-title">Add a recovery email.</h1>
          <p>Verify an address before opening protected workspace records.</p>
        </div>
        <RecoveryEmailEnrollmentForm
          requestAction={requestCurrentRecoveryEmail}
          confirmAction={confirmCurrentRecoveryEmail}
        />
        <InterstitialSignOut />
      </section>
    </main>
  )
}
