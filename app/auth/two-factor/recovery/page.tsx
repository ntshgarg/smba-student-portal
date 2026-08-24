import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"

import {
  AuthenticatorRecoveryApprovalForm,
  AuthenticatorRecoveryRequestForm,
} from "@/components/authenticator-recovery-form"
import {
  AUTHENTICATOR_RECOVERY_COOKIE,
  getAuthenticatorRecoveryStatus,
} from "@/lib/auth/recovery-service"
import { publicSiteUrl } from "@/lib/config"

export const metadata: Metadata = {
  title: "Recover authenticator access",
  robots: { follow: false, index: false },
}

export default async function AuthenticatorRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; requested?: string; verified?: string }>
}) {
  const query = await searchParams
  const token = (await cookies()).get(AUTHENTICATOR_RECOVERY_COOKIE)?.value ?? ""
  const status = getAuthenticatorRecoveryStatus(token)
  const requested = query.requested === "1"
  const invalid = query.error === "invalid" || (query.verified === "1" && status.state === "missing")

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="authenticator-recovery-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Secure access</em></span>
        </Link>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Authenticator recovery</p>
          <h1 id="authenticator-recovery-title">
            {requested ? "Request sent for approval."
              : status.state === "verified" ? "Ask the platform admin."
                : "Recover protected access."}
          </h1>
          <p>{requested
            ? "Your authenticator remains unchanged until the platform admin approves the request."
            : status.state === "verified"
              ? "Email ownership is confirmed. One final approval protects the coach account from an email-only takeover."
              : "Use this only when both the authenticator entry and every saved recovery code are unavailable."}</p>
        </div>
        {invalid ? <p className="login-error" role="alert">That verification link is invalid or expired.</p> : null}
        {requested ? (
          <div className="registration-confirmation" role="status">
            <h2>Wait for platform-admin approval.</h2>
            <p>After approval, sign in with the existing password or PIN. SMBA will force a fresh authenticator setup.</p>
          </div>
        ) : status.state === "verified"
          ? <AuthenticatorRecoveryApprovalForm academyId={status.academyId} />
          : <AuthenticatorRecoveryRequestForm />}
        <Link className="login-back" href="/auth/two-factor">← Back to authenticator verification</Link>
      </section>
    </main>
  )
}
