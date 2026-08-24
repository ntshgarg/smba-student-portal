import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { redirect } from "next/navigation"

import { RegistrationForm } from "@/components/registration-form"
import { publicSiteUrl } from "@/lib/config"
import { sessionProvider } from "@/lib/data"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Request registration",
  description: "Request access to the SMBA private portal.",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function RegisterPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity) redirect(postAuthenticationDestination({
    accountId: identity.subjectId,
    role: identity.role,
    twoFactorEnabled: true,
  }))

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="registration-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>SMBA <em>Portal</em></span>
        </Link>

        <div className="login-copy registration-copy">
          <p className="eyebrow">Request access</p>
          <h1 id="registration-title">Join the portal.</h1>
          <p>Tell us who you are. Your coach will review the request before access is opened.</p>
        </div>

        <RegistrationForm />

        <Link className="login-back" href="/login">
          <ArrowLeft aria-hidden="true" /> Back to login
        </Link>
      </section>
    </main>
  )
}
