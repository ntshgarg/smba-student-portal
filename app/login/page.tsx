import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { sessionProvider } from "@/lib/data"
import { publicSiteUrl } from "@/lib/config"

export const metadata: Metadata = {
  title: "Portal login",
  description: "Open your SMBA player journal or coach workspace.",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function LoginPage() {
  const identity = await sessionProvider.getCurrentIdentity()
  if (identity) redirect(identity.role === "coach" ? "/coach" : "/player")

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="login-brand" href={publicSiteUrl} aria-label="SMBA homepage">
          <Image
            src="/images/smba-logo.jpeg"
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
          <p>Enter the Academy ID shared with you by your coach.</p>
        </div>

        <LoginForm />

        <Link className="login-back" href={publicSiteUrl}>
          <ArrowLeft aria-hidden="true" />
          Back to the academy
        </Link>
      </section>
    </main>
  )
}
