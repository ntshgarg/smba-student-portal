import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"

import { PlatformAdminSetupForm } from "@/components/platform-admin-setup-form"
import {
  PLATFORM_ADMIN_SETUP_COOKIE,
  platformAdminSetupAvailable,
  validPlatformAdminSetupToken,
} from "@/lib/auth/initial-setup"

export const metadata: Metadata = {
  title: "Set up platform owner",
  robots: { follow: false, index: false },
}

export default async function PlatformAdminSetupPage() {
  const cookieStore = await cookies()
  const setupToken = cookieStore.get(PLATFORM_ADMIN_SETUP_COOKIE)?.value
  const authorized = platformAdminSetupAvailable()
    && validPlatformAdminSetupToken(setupToken)

  return (
    <main className="login-page">
      <section className="login-card head-coach-setup-card" aria-labelledby="admin-setup-title">
        <div className="login-brand" aria-label="Sathiya Moorthy Badminton Academy">
          <Image
            src="/images/smba-logo.jpeg"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            priority
          />
          <span>SMBA <em>Oversight</em></span>
        </div>
        <div className="login-copy">
          <p className="eyebrow">One-time platform setup</p>
          <h1 id="admin-setup-title">Create your owner access.</h1>
          <p>
            Your reserved username is <strong>SMBA-ADMIN-0001</strong>. Choose your
            password and mandatory PIN, then connect a fresh authenticator.
          </p>
        </div>
        {authorized ? <PlatformAdminSetupForm /> : (
          <div className="login-empty-state" role="status">
            <p>This setup session is unavailable, expired, or has already been completed.</p>
            <Link href="/login">Return to login</Link>
          </div>
        )}
      </section>
    </main>
  )
}
