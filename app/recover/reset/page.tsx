import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"

import {
  RecoveryPasswordForm,
  RecoverySecondFactorForm,
} from "@/components/recovery-reset-forms"
import {
  getPasswordRecoveryStatus,
  protectedResetUnavailableCopy,
  RECOVERY_SESSION_COOKIE,
} from "@/lib/auth/recovery-service"
import { publicSiteUrl } from "@/lib/config"

export const metadata: Metadata = {
  title: "Complete account recovery",
  robots: { follow: false, index: false },
}

export default async function RecoveryResetPage() {
  const token = (await cookies()).get(RECOVERY_SESSION_COOKIE)?.value ?? ""
  const status = getPasswordRecoveryStatus(token)
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="recovery-reset-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Account recovery</p>
          <h1 id="recovery-reset-title">
            {status.state === "missing"
              ? "This recovery link is unavailable."
              : status.state === "unavailable"
                ? "This reset needs the platform admin."
                : status.requiresSecondFactor && !status.secondFactorVerified
                  ? "Verify it’s you."
                  : "Create a new password."}
          </h1>
          <p>{status.state === "missing"
            ? "Request a new email from the recovery page."
            : status.state === "unavailable"
              ? protectedResetUnavailableCopy(status.academyId)
              : status.requiresSecondFactor && !status.secondFactorVerified
                ? "This protected account also requires its existing authenticator."
                : `Resetting ${status.academyId} will log out every device and remove its old PIN.`}</p>
        </div>
        {status.state === "missing" ? (
          <div className="login-empty-state"><Link href="/recover">Request another link</Link></div>
        ) : status.state === "unavailable" ? (
          <div className="login-empty-state"><Link href="/login">Back to sign-in</Link></div>
        ) : status.requiresSecondFactor && !status.secondFactorVerified
          ? (
            <>
              <RecoverySecondFactorForm />
              <p className="login-helper">
                Lost your authenticator and every recovery code?{" "}
                <Link href="/auth/two-factor/recovery">Ask the platform admin to reset the authenticator</Link>.
                Once they approve, use “Forgot password?” again within 24 hours and no code will be asked for.
              </p>
            </>
          )
          : <RecoveryPasswordForm />}
        <Link className="login-back" href="/login">← Back to login</Link>
      </section>
    </main>
  )
}
