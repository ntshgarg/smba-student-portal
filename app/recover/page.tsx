import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { redirect } from "next/navigation"

import { RecoveryForm } from "@/components/recovery-form"
import { publicSiteUrl } from "@/lib/config"
import { sessionProvider } from "@/lib/data"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Recover portal account",
  robots: { follow: false, index: false },
}

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string }>
}) {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity) redirect(postAuthenticationDestination({
    accountId: identity.subjectId,
    role: identity.role,
    twoFactorEnabled: true,
  }))
  const query = await searchParams
  const expired = query.expired === "1" || query.error === "invalid"
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="recovery-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image src="/images/smba-logo.png" alt="Sathiya Moorthy Badminton Academy" width={720} height={488} priority />
          <span>SMBA <em>Portal</em></span>
        </Link>
        <div className="login-copy activation-copy">
          <p className="eyebrow">Account recovery</p>
          <h1 id="recovery-title">Reset your password.</h1>
          <p>Enter the Academy ID and its verified recovery email. Protected accounts will also verify their authenticator.</p>
        </div>
        {expired ? <p className="login-error" role="alert">That recovery link is invalid or expired. Request a new one.</p> : null}
        <RecoveryForm />
        <Link className="login-back" href="/login"><ArrowLeft aria-hidden="true" /> Back to login</Link>
      </section>
    </main>
  )
}
