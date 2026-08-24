import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { sessionProvider } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"
import { postAuthenticationDestination } from "@/lib/auth/post-auth-destination"

export const metadata: Metadata = {
  title: "Portal login",
  description: "Open your SMBA player journal or coach workspace.",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ recovered?: string }>
}) {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity) {
    redirect(postAuthenticationDestination({
      accountId: identity.subjectId,
      role: identity.role,
      twoFactorEnabled: true,
    }))
  }
  const recovered = (await searchParams).recovered === "1"

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>
            Player <em>Journal</em>
          </span>
        </Link>

        <div className="login-copy">
          <p className="eyebrow">SMBA portal</p>
          <h1 id="login-title">Welcome back.</h1>
          <p>Choose password or PIN to continue.</p>
        </div>

        {recovered ? (
          <p className="security-success login-recovery-success" role="status">
            Password reset complete. Sign in with the new password.
          </p>
        ) : null}
        <LoginForm />

        <Link className="login-back" href={publicSiteUrl}>
          <ArrowLeft aria-hidden="true" />
          Back to the academy
        </Link>
      </section>
    </main>
  )
}
